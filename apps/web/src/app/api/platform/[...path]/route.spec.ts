import { PlatformRouteInventory } from "@pubg-camp/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH, POST, PUT } from "./route.js";

const WEB_ORIGIN = "https://camp.test";
const API_ORIGIN = "http://api.internal:3001";

function context(...path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function request(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Request {
  return new Request(`${WEB_ORIGIN}/api/platform/${path}`, {
    ...init,
    headers: {
      origin: WEB_ORIGIN,
      "sec-fetch-site": "same-origin",
      ...init.headers,
    },
  });
}

function jsonResponse(
  body: unknown,
  init: ResponseInit & { cookies?: readonly string[] } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  for (const cookie of init.cookies ?? []) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
}

describe("same-origin platform BFF", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    process.env.API_INTERNAL_ORIGIN = API_ORIGIN;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.API_INTERNAL_ORIGIN;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects absolute URLs, traversal and method/path combinations outside the exact allowlist", async () => {
    const absolute = await GET(
      request("https://evil.test/steal"),
      context("https:", "evil.test", "steal"),
    );
    const traversal = await GET(
      request("organizations/%2e%2e/security/csrf"),
      context("organizations", "..", "security", "csrf"),
    );
    const wrongMethod = await POST(
      request("security/csrf", { method: "POST" }),
      context("security", "csrf"),
    );

    expect(absolute.status).toBe(404);
    expect(traversal.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects the removed synthetic logo handler and keeps production routes manifest-backed", async () => {
    const synthetic = await GET(
      request("__e2e/logos/run-000000000000000/logo.png"),
      context("__e2e", "logos", "run-000000000000000", "logo.png"),
    );

    expect(synthetic.status).toBe(404);
    expect(PlatformRouteInventory.some(({ path }) => path.includes("__e2e"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin unsafe calls before contacting the API", async () => {
    const response = await POST(
      request("identity/email/otp/sign-in/request", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          "sec-fetch-site": "cross-site",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "person@example.test" }),
      }),
      context("identity", "email", "otp", "sign-in", "request"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])(
    "passes upstream %s without interpreting authorization",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: "denied", capabilities: ["server-owned"] }, { status }),
      );

      const response = await GET(
        request("identity/session-alerts/resolve?context=opaque", { method: "GET" }),
        context("identity", "session-alerts", "resolve"),
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ status: "denied", capabilities: ["server-owned"] });
    },
  );

  it("forwards only bounded first-party headers, cookies, CSRF and body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { status: "accepted" },
        {
          status: 202,
          headers: {
            server: "internal-api",
            "x-otp-challenge-id": "66323e38-bb3e-4c19-b23a-821b355c06e3",
            "x-provider-token": "provider-response-secret",
          },
        },
      ),
    );

    const response = await POST(
      request("identity/email/otp/sign-in/request", {
        method: "POST",
        headers: {
          authorization: "Bearer browser-secret",
          connection: "keep-alive",
          cookie: "__Host-preauth=browser-context",
          "content-type": "application/json",
          "x-correlation-id": "00000000-0000-4000-8000-000000000000",
          "x-csrf-token": "csrf-token",
          "x-provider-token": "provider-secret",
        },
        body: JSON.stringify({ email: "person@example.test" }),
      }),
      context("identity", "email", "otp", "sign-in", "request"),
    );

    expect(response.status).toBe(202);
    const [target, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(target)).toBe(`${API_ORIGIN}/identity/email/otp/sign-in/request`);
    const headers = new Headers(init?.headers);
    expect(headers.get("cookie")).toBe("__Host-preauth=browser-context");
    expect(headers.get("x-csrf-token")).toBe("csrf-token");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("x-provider-token")).toBeNull();
    expect(response.headers.get("server")).toBeNull();
    expect(response.headers.get("x-provider-token")).toBeNull();
    expect(response.headers.get("x-otp-challenge-id")).toBe("66323e38-bb3e-4c19-b23a-821b355c06e3");
  });

  it.each([
    {
      name: "members",
      handler: GET,
      method: "GET",
      path: "members",
    },
    {
      name: "invitations",
      handler: GET,
      method: "GET",
      path: "invitations",
    },
    {
      name: "ownership",
      handler: POST,
      method: "POST",
      path: "ownership/transfer",
    },
    {
      name: "audit",
      handler: GET,
      method: "GET",
      path: "audit",
    },
    {
      name: "logo",
      handler: PUT,
      method: "PUT",
      path: "logo",
    },
  ] as const)(
    "derives the organization header from the validated $name route and drops spoofed tenant headers",
    async ({ handler, method, path }) => {
      const organizationId = "11111111-1111-4111-8111-111111111111";
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
        .mockResolvedValueOnce(jsonResponse({ csrfToken: "rotated-csrf-token-123" }));

      const response = await handler(
        request(`organizations/${organizationId}/${path}`, {
          method,
          headers: {
            "x-organization-id": "22222222-2222-4222-8222-222222222222",
            "x-authorization-scope-id": "33333333-3333-4333-8333-333333333333",
          },
        }),
        context("organizations", organizationId, ...path.split("/")),
      );

      expect(response.status).toBe(200);
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(Object.fromEntries(headers.entries())).toEqual({
        origin: WEB_ORIGIN,
        "x-organization-id": organizationId,
      });
    },
  );

  it("does not fabricate tenant context for root identity or invitation routes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "ok" }));

    await GET(
      request("identity/sessions", {
        headers: {
          "x-organization-id": "22222222-2222-4222-8222-222222222222",
          "x-authorization-scope-id": "33333333-3333-4333-8333-333333333333",
        },
      }),
      context("identity", "sessions"),
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-organization-id")).toBeNull();
    expect(headers.get("x-authorization-scope-id")).toBeNull();
  });

  it("acquires a pre-auth CSRF token and preserves every secure Set-Cookie", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { csrfToken: "preauth-csrf-token-123" },
        {
          cookies: [
            "__Host-preauth=opaque; Path=/; Secure; HttpOnly; SameSite=Lax",
            "__Host-csrf=secret; Path=/; Secure; HttpOnly; SameSite=Lax",
          ],
        },
      ),
    );

    const response = await GET(
      request("security/csrf", { method: "GET" }),
      context("security", "csrf"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-csrf-token")).toBe("preauth-csrf-token-123");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(setCookies(response).join(";")).toContain("__Host-preauth=opaque");
    expect(setCookies(response).join(";")).toContain("__Host-csrf=secret");
  });

  it("translates a native OAuth form navigation into a bounded JSON API request", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://discord.com/oauth2/authorize?opaque=provider-state" },
      }),
    );
    const body = new URLSearchParams({
      csrfToken: "csrf-token-with-safe-length",
      purpose: "sign-in",
      returnPath: "/primeiro-acesso",
    });

    const response = await POST(
      request("identity/oauth/discord/sign-in/start", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
      context("identity", "oauth", "discord", "sign-in", "start"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^https:\/\/discord\.com\/oauth2\/authorize/);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-csrf-token")).toBe("csrf-token-with-safe-length");
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
      JSON.stringify({ purpose: "sign-in", returnPath: "/primeiro-acesso" }),
    );
    expect(await response.text()).toBe("");
  });

  it.each(["link-identity", "step-up"] as const)(
    "forwards protected Discord %s starts only to the exact guarded upstream path",
    async (purpose) => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://discord.com/oauth2/authorize?opaque=provider-state" },
        }),
      );

      const response = await POST(
        request(`identity/oauth/discord/${purpose}/start`, {
          method: "POST",
          headers: {
            cookie: "__Host-session=opaque-session",
            "content-type": "application/json",
            "x-csrf-token": "authenticated-csrf-token",
          },
          body: JSON.stringify({ purpose, returnPath: "/account/identities" }),
        }),
        context("identity", "oauth", "discord", purpose, "start"),
      );

      expect(response.status).toBe(302);
      const [target, init] = fetchMock.mock.calls[0] ?? [];
      expect(String(target)).toBe(`${API_ORIGIN}/identity/oauth/discord/${purpose}/start`);
      const headers = new Headers(init?.headers);
      expect(headers.get("cookie")).toBe("__Host-session=opaque-session");
      expect(headers.get("x-csrf-token")).toBe("authenticated-csrf-token");
    },
  );

  it.each([
    "link-email/request",
    "change-email/request",
    "step-up/request",
    "verify-provisional-email/request",
  ])("forwards protected OTP %s only to its purpose-specific upstream path", async (suffix) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "accepted" }));

    const response = await POST(
      request(`identity/email/otp/${suffix}`, {
        method: "POST",
        headers: {
          cookie: "__Host-session=opaque-session",
          "content-type": "application/json",
          "x-csrf-token": "authenticated-csrf-token",
        },
        body: JSON.stringify({ email: "person@example.test" }),
      }),
      context("identity", "email", "otp", ...suffix.split("/")),
    );

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${API_ORIGIN}/identity/email/otp/${suffix}`);
    fetchMock.mockClear();
  });

  it("rejects OAuth purpose escalation and all browser authority fields before fetch", async () => {
    const purposeMismatch = await POST(
      request("identity/oauth/discord/sign-in/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "step-up" }),
      }),
      context("identity", "oauth", "discord", "sign-in", "start"),
    );
    const authoritySmuggling = await POST(
      request("identity/email/otp/step-up/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "person@example.test",
          actorId: "attacker",
          userId: "attacker",
          sessionId: "other",
          trust: "trusted",
        }),
      }),
      context("identity", "email", "otp", "step-up", "request"),
    );

    expect(purposeMismatch.status).toBe(400);
    expect(authoritySmuggling.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not keep generic identity routes that could select a weaker purpose", async () => {
    const oauth = await POST(
      request("identity/oauth/discord/start", { method: "POST" }),
      context("identity", "oauth", "discord", "start"),
    );
    const otp = await POST(
      request("identity/email/otp/request", { method: "POST" }),
      context("identity", "email", "otp", "request"),
    );

    expect(oauth.status).toBe(404);
    expect(otp.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts browser-owned same-origin metadata across a trusted dev host normalization", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: "metadata-csrf-token-123" }));
    const browserRequest = new Request("http://localhost:3000/api/platform/security/csrf", {
      headers: {
        referer: "http://127.0.0.1:3000/entrar",
        "sec-fetch-site": "same-origin",
      },
    });

    const response = await GET(browserRequest, context("security", "csrf"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-csrf-token")).toBe("metadata-csrf-token-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reacquires CSRF with rotated cookies after authentication", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { status: "authenticated", nextPath: "/" },
          {
            cookies: [
              "__Host-session=new-session; Path=/; Secure; HttpOnly; SameSite=Lax",
              "__Host-csrf=rotated-secret; Path=/; Secure; HttpOnly; SameSite=Lax",
            ],
          },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { csrfToken: "authenticated-csrf-token-123" },
          {
            cookies: ["__Host-csrf=confirmed-secret; Path=/; Secure; HttpOnly; SameSite=Lax"],
          },
        ),
      );

    const response = await POST(
      request("identity/email/otp/sign-in/verify", {
        method: "POST",
        headers: {
          cookie: "__Host-preauth=old-context; __Host-csrf=old-secret",
          "content-type": "application/json",
          "x-csrf-token": "preauth-csrf-token-123",
        },
        body: JSON.stringify({ code: "12345678" }),
      }),
      context("identity", "email", "otp", "sign-in", "verify"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [csrfTarget, csrfInit] = fetchMock.mock.calls[1] ?? [];
    expect(String(csrfTarget)).toBe(`${API_ORIGIN}/security/csrf`);
    const cookie = new Headers(csrfInit?.headers).get("cookie") ?? "";
    expect(cookie).toContain("__Host-session=new-session");
    expect(cookie).toContain("__Host-csrf=rotated-secret");
    expect(response.headers.get("x-csrf-token")).toBe("authenticated-csrf-token-123");
    expect(setCookies(response).join(";")).toContain("__Host-csrf=confirmed-secret");
  });

  it("clears client CSRF state on logout while preserving cookie invalidation", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 204,
        headers: {
          "set-cookie": "__Host-session=; Path=/; Secure; HttpOnly; Max-Age=0",
        },
      }),
    );

    const response = await POST(
      request("identity/sessions/logout", {
        method: "POST",
        headers: { cookie: "__Host-session=current", "x-csrf-token": "authenticated-csrf" },
      }),
      context("identity", "sessions", "logout"),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("x-csrf-token")).toBe("");
    expect(response.headers.get("x-csrf-token-state")).toBe("cleared");
    expect(setCookies(response).join(";")).toContain("__Host-session=");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses no-store and no-referrer for invitation traffic", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "valid" }));

    const response = await POST(
      request("invitations/preview", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": "csrf" },
        body: JSON.stringify({ context: "opaque-invitation-context" }),
      }),
      context("invitations", "preview"),
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(setCookies(response).join(";")).toContain("__Host-invitation-context=");
    expect(setCookies(response).join(";")).toContain("HttpOnly");
  });

  it("keeps OAuth callback GET read-only and forwards callback POST with CSRF", async () => {
    const getResponse = await GET(
      request(
        "identity/oauth/discord/sign-in/callback?code=secret&state=opaque-state-with-safe-length",
      ),
      context("identity", "oauth", "discord", "sign-in", "callback"),
    );
    expect(getResponse.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "authenticated", nextPath: "/" }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "rotated-csrf-token-with-safe-length" }));
    const postResponse = await POST(
      request("identity/oauth/discord/sign-in/callback", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": "csrf" },
        body: JSON.stringify({
          code: "provider-secret",
          state: "opaque-state-with-safe-length",
          purpose: "sign-in",
        }),
      }),
      context("identity", "oauth", "discord", "sign-in", "callback"),
    );

    expect(postResponse.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${API_ORIGIN}/identity/oauth/discord/sign-in/callback`,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("injects invitation context from HttpOnly custody only on explicit acceptance", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "accepted" }));
    const stored = encodeURIComponent("opaque-invitation-context");
    const response = await POST(
      request("invitations/accept", {
        method: "POST",
        headers: {
          cookie: `__Host-preauth=browser; __Host-invitation-context=${stored}`,
          "content-type": "application/json",
          "x-csrf-token": "csrf",
        },
        body: JSON.stringify({ confirmation: true }),
      }),
      context("invitations", "accept"),
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-invitation-context")).toBe("opaque-invitation-context");
    expect(headers.get("cookie")).toBe("__Host-preauth=browser");
    expect(setCookies(response).join(";")).toContain("__Host-invitation-context=");
    expect(setCookies(response).join(";")).toContain("Max-Age=0");
  });

  it("enforces body limits before fetch and returns uniform errors without config secrets", async () => {
    const oversized = await PATCH(
      request(
        "organizations/00000000-0000-4000-8000-000000000001/members/00000000-0000-4000-8000-000000000002",
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-csrf-token": "csrf" },
          body: "x".repeat(70 * 1024),
        },
      ),
      context(
        "organizations",
        "00000000-0000-4000-8000-000000000001",
        "members",
        "00000000-0000-4000-8000-000000000002",
      ),
    );
    expect(oversized.status).toBe(413);

    process.env.API_INTERNAL_ORIGIN = "http://internal-user:internal-password@api.internal";
    const invalidConfig = await GET(
      request("organizations", { method: "GET" }),
      context("organizations"),
    );
    const body = await invalidConfig.text();
    expect(invalidConfig.status).toBe(503);
    expect(body).toBe('{"status":"unavailable"}');
    expect(body).not.toContain("internal-password");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
