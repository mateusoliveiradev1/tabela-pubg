import { describe, expect, it, vi } from "vitest";
import {
  DiscordOAuthAdapter,
  type DiscordOAuthVerifierRecord,
  type DiscordOAuthVerifierStore,
} from "./discord-oauth.js";

function createVerifierStore(): DiscordOAuthVerifierStore {
  const records = new Map<string, DiscordOAuthVerifierRecord>();
  return {
    save: vi.fn(async (state, record) => {
      records.set(state, record);
    }),
    consume: vi.fn(async (state) => {
      const record = records.get(state) ?? null;
      records.delete(state);
      return record;
    }),
  };
}

function createCapturedFetch() {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);

    if (request.url.endsWith("/oauth2/token")) {
      return new Response(
        JSON.stringify({ access_token: "discord-access-secret", token_type: "Bearer" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url.endsWith("/users/@me")) {
      return new Response(
        JSON.stringify({
          id: "123456789012345678",
          username: "organizer",
          email: "organizer@example.com",
          verified: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url.endsWith("/oauth2/token/revoke")) {
      return new Response(null, { status: 200 });
    }
    throw new Error("unexpected provider request");
  });
  return { fetch, requests };
}

const config = {
  clientId: "123456789012345678",
  clientSecret: "discord-client-credential-with-strong-entropy",
  redirectUri: "https://camp.test/identity/oauth/discord/callback",
  pkceMode: "required" as const,
};

describe("DiscordOAuthAdapter PKCE", () => {
  it("uses S256 and consumes the server-side verifier once during a captured token exchange", async () => {
    const verifierStore = createVerifierStore();
    const captured = createCapturedFetch();
    const adapter = new DiscordOAuthAdapter(config, verifierStore, {
      fetch: captured.fetch,
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });

    const started = await adapter.start({ state: "state-bound-to-browser", purpose: "sign-in" });
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(authorization.searchParams.get("scope")).toBe("identify email");
    expect(authorization.searchParams.get("state")).toBe("state-bound-to-browser");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await expect(
      adapter.exchange({ code: "provider-code", state: "state-bound-to-browser" }),
    ).resolves.toEqual({ accessToken: "discord-access-secret" });
    const tokenRequest = captured.requests.find((request) => request.url.endsWith("/oauth2/token"));
    expect(tokenRequest).toBeDefined();
    const tokenBody = new URLSearchParams(await tokenRequest?.clone().text());
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("redirect_uri")).toBe(config.redirectUri);
    expect(tokenBody.get("code_verifier")).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);

    await expect(
      adapter.exchange({ code: "provider-code", state: "state-bound-to-browser" }),
    ).rejects.toThrow("oauth transaction unavailable");
    expect(captured.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the exact redirect URI persisted with the one-shot verifier during exchange", async () => {
    const verifierStore = createVerifierStore();
    const captured = createCapturedFetch();
    const mutableConfig = { ...config };
    const adapter = new DiscordOAuthAdapter(mutableConfig, verifierStore, {
      fetch: captured.fetch,
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });

    const started = await adapter.start({ state: "deployment-bound-state", purpose: "step-up" });
    const exactRedirectUri = new URL(started.authorizationUrl).searchParams.get("redirect_uri");
    mutableConfig.redirectUri = "https://new-deployment.test/identity/oauth/discord/callback";

    await adapter.exchange({ code: "provider-code", state: "deployment-bound-state" });
    const tokenRequest = captured.requests.find((request) => request.url.endsWith("/oauth2/token"));
    const tokenBody = new URLSearchParams(await tokenRequest?.clone().text());
    expect(tokenBody.get("redirect_uri")).toBe(exactRedirectUri);
  });

  it("supports only an evidenced exception and repairs to required without changing the store", async () => {
    const verifierStore = createVerifierStore();
    const captured = createCapturedFetch();

    expect(
      () =>
        new DiscordOAuthAdapter({ ...config, pkceMode: "documented-exception" }, verifierStore, {
          fetch: captured.fetch,
        }),
    ).toThrow("documented PKCE exception requires evidence");

    const exceptionAdapter = new DiscordOAuthAdapter(
      {
        ...config,
        pkceMode: "documented-exception",
        pkceExceptionId: "SEC-2026-0042",
      },
      verifierStore,
      { fetch: captured.fetch },
    );
    const exceptionStart = new URL(
      (await exceptionAdapter.start({ state: "exception-state", purpose: "sign-in" }))
        .authorizationUrl,
    );
    expect(exceptionStart.searchParams.has("code_challenge")).toBe(false);
    expect(exceptionAdapter.securityWarning()).toBe("Discord PKCE documented exception is active.");
    expect(exceptionAdapter.securityWarning()).not.toContain("SEC-2026-0042");

    await exceptionAdapter.exchange({ code: "exception-code", state: "exception-state" });
    const exceptionTokenRequest = captured.requests.find((request) =>
      request.url.endsWith("/oauth2/token"),
    );
    expect(
      new URLSearchParams(await exceptionTokenRequest?.clone().text()).has("code_verifier"),
    ).toBe(false);

    const repairedAdapter = new DiscordOAuthAdapter(config, verifierStore, {
      fetch: captured.fetch,
    });
    const repairedStart = new URL(
      (await repairedAdapter.start({ state: "repaired-state", purpose: "sign-in" }))
        .authorizationUrl,
    );
    expect(repairedStart.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("uses the access token only at Discord boundaries and returns a validated public profile", async () => {
    const captured = createCapturedFetch();
    const adapter = new DiscordOAuthAdapter(config, createVerifierStore(), {
      fetch: captured.fetch,
    });

    const profile = await adapter.fetchUser("discord-access-secret");
    expect(profile).toEqual({
      id: "123456789012345678",
      username: "organizer",
      email: "organizer@example.com",
      emailVerified: true,
    });
    await adapter.revoke("discord-access-secret");

    expect(JSON.stringify(profile)).not.toContain("discord-access-secret");
    const userRequest = captured.requests.find((request) => request.url.endsWith("/users/@me"));
    expect(userRequest?.headers.get("authorization")).toBe("Bearer discord-access-secret");
    const revokeRequest = captured.requests.find((request) =>
      request.url.endsWith("/oauth2/token/revoke"),
    );
    expect(await revokeRequest?.clone().text()).toContain("discord-access-secret");
  });
});
