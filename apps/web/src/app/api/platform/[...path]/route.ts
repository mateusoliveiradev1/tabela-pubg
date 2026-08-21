export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlatformRouteContext = {
  params: Promise<{ path: string[] }>;
};

type SupportedMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RouteRule = {
  pattern: RegExp;
  methods: readonly SupportedMethod[];
  upstream: "root" | "platform";
  bodyLimit?: number;
  csrfRotation?: "reacquire" | "clear";
  noReferrer?: boolean;
};

const JSON_BODY_LIMIT = 64 * 1024;
const MULTIPART_BODY_LIMIT = 2 * 1024 * 1024 + 64 * 1024;
const HEADER_LIMIT = 32 * 1024;
const HEADER_COUNT_LIMIT = 64;
const UPSTREAM_TIMEOUT_MS = 10_000;
const INVITATION_CONTEXT_COOKIE = "__Host-invitation-context";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const ROUTES: readonly RouteRule[] = [
  { pattern: /^security\/csrf$/, methods: ["GET"], upstream: "root" },
  {
    pattern: /^identity\/oauth\/discord\/start$/,
    methods: ["POST"],
    upstream: "root",
    noReferrer: true,
  },
  {
    pattern: /^identity\/oauth\/discord\/callback$/,
    methods: ["POST"],
    upstream: "root",
    csrfRotation: "reacquire",
    noReferrer: true,
  },
  {
    pattern: /^identity\/email\/otp\/request$/,
    methods: ["POST"],
    upstream: "root",
    noReferrer: true,
  },
  {
    pattern: /^identity\/email\/otp\/verify$/,
    methods: ["POST"],
    upstream: "root",
    csrfRotation: "reacquire",
    noReferrer: true,
  },
  {
    pattern: /^identity\/session-alerts\/resolve$/,
    methods: ["GET"],
    upstream: "root",
    noReferrer: true,
  },
  { pattern: /^identity\/sessions$/, methods: ["GET"], upstream: "root" },
  {
    pattern: /^identity\/sessions\/logout$/,
    methods: ["POST"],
    upstream: "root",
    csrfRotation: "clear",
  },
  {
    pattern: /^identity\/sessions\/revoke-others$/,
    methods: ["POST"],
    upstream: "root",
  },
  {
    pattern: new RegExp(`^identity/sessions/${UUID}/revoke$`, "i"),
    methods: ["POST"],
    upstream: "root",
  },
  { pattern: /^identity\/identities$/, methods: ["GET"], upstream: "root" },
  {
    pattern: /^identity\/identities\/link\/confirm$/,
    methods: ["POST"],
    upstream: "root",
    csrfRotation: "reacquire",
  },
  {
    pattern: new RegExp(`^identity/identities/${UUID}/remove$`, "i"),
    methods: ["POST"],
    upstream: "root",
    csrfRotation: "reacquire",
  },
  { pattern: /^organizations$/, methods: ["GET", "POST"], upstream: "platform" },
  {
    pattern: new RegExp(`^organizations/${UUID}/members$`, "i"),
    methods: ["GET"],
    upstream: "platform",
  },
  {
    pattern: new RegExp(`^organizations/${UUID}/members/${UUID}$`, "i"),
    methods: ["PATCH"],
    upstream: "platform",
  },
  {
    pattern: new RegExp(`^organizations/${UUID}/members/${UUID}/revoke$`, "i"),
    methods: ["POST"],
    upstream: "platform",
  },
  {
    pattern: new RegExp(`^organizations/${UUID}/ownership/transfer$`, "i"),
    methods: ["POST"],
    upstream: "platform",
    csrfRotation: "reacquire",
  },
  {
    pattern: new RegExp(`^organizations/${UUID}/invitations$`, "i"),
    methods: ["GET", "POST"],
    upstream: "platform",
    noReferrer: true,
  },
  {
    pattern: new RegExp(`^organizations/${UUID}/invitations/${UUID}/(?:revoke|resend)$`, "i"),
    methods: ["POST"],
    upstream: "platform",
    noReferrer: true,
  },
  {
    pattern: new RegExp(`^organizations/${UUID}/audit$`, "i"),
    methods: ["GET"],
    upstream: "platform",
  },
  {
    pattern: new RegExp(`^organizations/${UUID}/logo$`, "i"),
    methods: ["PUT"],
    upstream: "platform",
    bodyLimit: MULTIPART_BODY_LIMIT,
  },
  {
    pattern: /^invitations\/(?:preview|accept)$/,
    methods: ["POST"],
    upstream: "platform",
    noReferrer: true,
  },
];

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "x-auth-browser-binding",
  "x-correlation-id",
  "x-csrf-token",
  "x-invitation-context",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-language",
  "content-type",
  "location",
  "retry-after",
  "x-correlation-id",
  "x-otp-challenge-id",
]);

async function proxy(request: Request, context: PlatformRouteContext): Promise<Response> {
  const method = request.method.toUpperCase() as SupportedMethod;
  const resolved = await resolveRoute(context, method);
  if (resolved instanceof Response) return resolved;

  const requestUrl = new URL(request.url);
  if (!isAuthorizedSameOriginRequest(request, requestUrl, method, resolved.path)) {
    return unavailable(403);
  }
  if (!headersWithinLimit(request.headers)) return unavailable(431);

  const apiOrigin = resolveApiOrigin();
  if (!apiOrigin) return unavailable(503);

  const body = await readBoundedBody(request, resolved.rule.bodyLimit ?? JSON_BODY_LIMIT);
  if (body instanceof Response) return body;

  const invitationContext =
    resolved.path === "invitations/preview" ? readInvitationContext(body) : undefined;
  if (resolved.path === "invitations/preview" && !invitationContext) return unavailable(400);

  const target = new URL(
    resolved.rule.upstream === "platform" ? `/platform/${resolved.path}` : `/${resolved.path}`,
    apiOrigin,
  );
  target.search = requestUrl.search;

  let upstream: Response;
  try {
    const upstreamHeaders = forwardRequestHeaders(request.headers);
    if (resolved.path === "invitations/accept") {
      const storedContext = readCookie(request.headers.get("cookie"), INVITATION_CONTEXT_COOKIE);
      if (!storedContext) return unavailable(400);
      upstreamHeaders.set("x-invitation-context", storedContext);
      const remainingCookies = removeCookie(
        request.headers.get("cookie"),
        INVITATION_CONTEXT_COOKIE,
      );
      if (remainingCookies) upstreamHeaders.set("cookie", remainingCookies);
      else upstreamHeaders.delete("cookie");
    }
    upstream = await fetch(target, {
      method,
      headers: upstreamHeaders,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return unavailable(502);
  }

  const upstreamCookies = getSetCookies(upstream.headers);
  const responseHeaders = forwardResponseHeaders(upstream.headers, resolved.rule);

  if (resolved.path === "invitations/preview" && upstream.ok && invitationContext) {
    responseHeaders.append("set-cookie", invitationContextCookie(invitationContext));
  }
  if (
    resolved.path === "invitations/accept" &&
    (upstream.ok || upstream.status === 409 || upstream.status === 410)
  ) {
    responseHeaders.append("set-cookie", clearInvitationContextCookie());
  }

  if (resolved.path === "security/csrf" && upstream.ok) {
    const token = await readCsrfToken(upstream.clone());
    if (!token) return unavailable(502);
    responseHeaders.set("x-csrf-token", token);
  }

  if (resolved.rule.csrfRotation === "reacquire" && upstream.ok) {
    const csrf = await reacquireCsrf(apiOrigin, request, requestUrl.origin, upstreamCookies);
    if (!csrf) return unavailable(502);
    responseHeaders.set("x-csrf-token", csrf.token);
    for (const cookie of csrf.cookies) responseHeaders.append("set-cookie", cookie);
  } else if (resolved.rule.csrfRotation === "clear" && upstream.ok) {
    responseHeaders.set("x-csrf-token", "");
    responseHeaders.set("x-csrf-token-state", "cleared");
  }

  const bodyAllowed = upstream.status !== 204 && upstream.status !== 304;
  return new Response(bodyAllowed ? upstream.body : null, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function resolveRoute(
  context: PlatformRouteContext,
  method: SupportedMethod,
): Promise<{ path: string; rule: RouteRule } | Response> {
  const { path: segments } = await context.params;
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > 8) {
    return unavailable(404);
  }
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("%"),
    )
  ) {
    return unavailable(404);
  }

  const path = segments.join("/");
  const pathRules = ROUTES.filter((rule) => rule.pattern.test(path));
  if (pathRules.length === 0) return unavailable(404);
  const rule = pathRules.find((candidate) => candidate.methods.includes(method));
  return rule ? { path, rule } : unavailable(405);
}

function isAuthorizedSameOriginRequest(
  request: Request,
  requestUrl: URL,
  method: SupportedMethod,
  path: string,
): boolean {
  const requiresProof = method !== "GET" || path === "security/csrf";
  if (!requiresProof) return true;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  if (origin) return normalizeOrigin(origin) === requestUrl.origin;
  if (referer) return normalizeOrigin(referer) === requestUrl.origin;
  return false;
}

function normalizeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function resolveApiOrigin(): URL | undefined {
  const configured = process.env.API_INTERNAL_ORIGIN;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function headersWithinLimit(headers: Headers): boolean {
  let count = 0;
  let size = 0;
  for (const [name, value] of headers) {
    count += 1;
    size += name.length + value.length;
    if (count > HEADER_COUNT_LIMIT || size > HEADER_LIMIT) return false;
  }
  return true;
}

function forwardRequestHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (REQUEST_HEADER_ALLOWLIST.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

function forwardResponseHeaders(source: Headers, rule: RouteRule): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase())) headers.set(name, value);
  }
  for (const cookie of getSetCookies(source)) headers.append("set-cookie", cookie);
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  headers.set("x-content-type-options", "nosniff");
  if (rule.noReferrer) headers.set("referrer-policy", "no-referrer");
  return headers;
}

async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<ArrayBuffer | null | Response> {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const declared = request.headers.get("content-length");
  if (declared) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) return unavailable(400);
    if (length > limit) return unavailable(413);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > limit) return unavailable(413);
  return body.byteLength === 0 ? null : body;
}

async function reacquireCsrf(
  apiOrigin: URL,
  request: Request,
  webOrigin: string,
  rotatedCookies: readonly string[],
): Promise<{ token: string; cookies: string[] } | undefined> {
  const headers = new Headers({ accept: "application/json", origin: webOrigin });
  const cookie = mergeCookies(request.headers.get("cookie"), rotatedCookies);
  if (cookie) headers.set("cookie", cookie);
  const browserBinding = request.headers.get("x-auth-browser-binding");
  if (browserBinding) headers.set("x-auth-browser-binding", browserBinding);

  try {
    const response = await fetch(new URL("/security/csrf", apiOrigin), {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const token = await readCsrfToken(response);
    return token ? { token, cookies: getSetCookies(response.headers) } : undefined;
  } catch {
    return undefined;
  }
}

async function readCsrfToken(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { csrfToken?: unknown };
    return typeof body.csrfToken === "string" &&
      body.csrfToken.length >= 16 &&
      body.csrfToken.length <= 2_048
      ? body.csrfToken
      : undefined;
  } catch {
    return undefined;
  }
}

function getSetCookies(headers: Headers): string[] {
  const enhanced = headers as Headers & { getSetCookie?: () => string[] };
  const values = enhanced.getSetCookie?.();
  if (values && values.length > 0) return values;
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function mergeCookies(incoming: string | null, setCookies: readonly string[]): string {
  const cookies = new Map<string, string>();
  for (const pair of incoming?.split(";") ?? []) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";", 1)[0] ?? "";
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(setCookie)) cookies.delete(name);
    else cookies.set(name, value);
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function readInvitationContext(body: ArrayBuffer | null): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { context?: unknown };
    return typeof parsed.context === "string" &&
      parsed.context.length >= 16 &&
      parsed.context.length <= 1024
      ? parsed.context
      : undefined;
  } catch {
    return undefined;
  }
}

function invitationContextCookie(context: string): string {
  return `${INVITATION_CONTEXT_COOKIE}=${encodeURIComponent(context)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600`;
}

function clearInvitationContextCookie(): string {
  return `${INVITATION_CONTEXT_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(header: string | null, name: string): string | undefined {
  const encoded = header
    ?.split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function removeCookie(header: string | null, name: string): string {
  return (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair && !pair.startsWith(`${name}=`))
    .join("; ");
}

function unavailable(status: number): Response {
  return Response.json(
    { status: "unavailable" },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
