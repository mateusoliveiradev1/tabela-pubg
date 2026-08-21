import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CsrfService,
  type CsrfServiceOptions,
  registerCsrfPlugins,
} from "../src/security/csrf.service.js";

const options: CsrfServiceOptions = {
  appOrigin: "https://camp.test",
  csrfSecret: "csrf-key-that-is-long-enough-for-tests-0123456789",
  cookieSigningKey: "cookie-key-that-is-long-enough-for-tests-012345",
  secureCookies: true,
};

type CookieJar = Map<string, string>;

function absorbCookies(jar: CookieJar, response: LightMyRequestResponse): void {
  const values = response.headers["set-cookie"];
  for (const value of Array.isArray(values) ? values : values ? [values] : []) {
    const [pair, ...attributes] = value.split(";");
    const separator = pair?.indexOf("=") ?? -1;
    if (separator < 1) continue;
    const name = pair?.slice(0, separator);
    const cookieValue = pair?.slice(separator + 1) ?? "";
    if (!name) continue;
    const expired = attributes.some((attribute) =>
      /^(?:\s*max-age=0|\s*expires=Thu, 01 Jan 1970)/i.test(attribute),
    );
    if (expired || cookieValue.length === 0) jar.delete(name);
    else jar.set(name, cookieValue);
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function createServer(onUnsafe = vi.fn()): Promise<FastifyInstance> {
  const server = fastify();
  const csrf = new CsrfService(options);
  await registerCsrfPlugins(server, csrf, { cookie, csrfProtection });

  server.get("/security/csrf", async (request, reply) => csrf.acquire(request, reply));
  server.post(
    "/login",
    { preHandler: csrf.protectHook() },
    async (request, reply) => csrf.rotateToSession(request, reply, "session-a"),
  );
  server.post("/unsafe", { preHandler: csrf.protectHook() }, async () => {
    onUnsafe();
    return { status: "ok" };
  });
  server.post(
    "/rotate",
    { preHandler: csrf.protectHook() },
    async (request, reply) => csrf.rotateToSession(request, reply, "session-a-rotated"),
  );
  server.post("/logout", { preHandler: csrf.protectHook() }, async (request, reply) => {
    csrf.invalidate(request, reply);
    return { status: "logged-out" };
  });
  await server.ready();
  return server;
}

async function acquire(server: FastifyInstance, jar: CookieJar) {
  const response = await server.inject({
    method: "GET",
    url: "/security/csrf",
    headers: jar.size === 0 ? {} : { cookie: cookieHeader(jar) },
  });
  absorbCookies(jar, response);
  return { response, token: response.json<{ csrfToken: string }>().csrfToken };
}

async function unsafe(
  server: FastifyInstance,
  jar: CookieJar,
  token: string | undefined,
  url = "/unsafe",
  origin: string | undefined = options.appOrigin,
) {
  return server.inject({
    method: "POST",
    url,
    headers: {
      cookie: cookieHeader(jar),
      ...(token === undefined ? {} : { "x-csrf-token": token }),
      ...(origin === undefined ? {} : { origin }),
    },
  });
}

describe("CSRF lifecycle through Fastify inject", () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("issues an opaque HttpOnly pre-auth context without creating a session", async () => {
    const server = await createServer();
    servers.push(server);
    const jar: CookieJar = new Map();

    const { response, token } = await acquire(server, jar);

    expect(response.statusCode).toBe(200);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(jar.has("__Host-preauth")).toBe(true);
    expect(jar.has("__Host-session")).toBe(false);
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringMatching(/__Host-preauth=.*HttpOnly.*Secure/i)]),
    );
  });

  it("rotates pre-auth to session-bound CSRF and rejects stale and cross-session tokens", async () => {
    const server = await createServer();
    servers.push(server);
    const firstJar: CookieJar = new Map();
    const secondJar: CookieJar = new Map();
    const preauth = await acquire(server, firstJar);

    const login = await unsafe(server, firstJar, preauth.token, "/login");
    expect(login.statusCode).toBe(200);
    absorbCookies(firstJar, login);
    const sessionToken = login.json<{ csrfToken: string }>().csrfToken;
    expect(sessionToken).not.toBe(preauth.token);
    expect(firstJar.has("__Host-preauth")).toBe(false);
    expect(firstJar.has("__Host-session")).toBe(true);

    expect((await unsafe(server, firstJar, preauth.token)).statusCode).toBe(403);
    expect((await unsafe(server, firstJar, sessionToken)).statusCode).toBe(200);

    const second = await acquire(server, secondJar);
    const secondLogin = await unsafe(server, secondJar, second.token, "/login");
    absorbCookies(secondJar, secondLogin);
    expect((await unsafe(server, secondJar, sessionToken)).statusCode).toBe(403);
  });

  it("rejects missing token and untrusted/null/missing origin before the use case", async () => {
    const onUnsafe = vi.fn();
    const server = await createServer(onUnsafe);
    servers.push(server);
    const jar: CookieJar = new Map();
    const { token } = await acquire(server, jar);

    expect((await unsafe(server, jar, undefined)).statusCode).toBe(403);
    expect((await unsafe(server, jar, token, "/unsafe", "https://evil.test")).statusCode).toBe(403);
    expect((await unsafe(server, jar, token, "/unsafe", "null")).statusCode).toBe(403);
    expect((await unsafe(server, jar, token, "/unsafe", undefined)).statusCode).toBe(403);
    expect(onUnsafe).not.toHaveBeenCalled();
  });

  it("rotates on session rotation and clears every auth/CSRF cookie on logout", async () => {
    const server = await createServer();
    servers.push(server);
    const jar: CookieJar = new Map();
    const preauth = await acquire(server, jar);
    const login = await unsafe(server, jar, preauth.token, "/login");
    absorbCookies(jar, login);
    const session = login.json<{ csrfToken: string }>().csrfToken;

    const rotated = await unsafe(server, jar, session, "/rotate");
    expect(rotated.statusCode).toBe(200);
    absorbCookies(jar, rotated);
    const rotatedToken = rotated.json<{ csrfToken: string }>().csrfToken;
    expect(rotatedToken).not.toBe(session);
    expect((await unsafe(server, jar, session)).statusCode).toBe(403);

    const logout = await unsafe(server, jar, rotatedToken, "/logout");
    expect(logout.statusCode).toBe(200);
    absorbCookies(jar, logout);
    expect([...jar.keys()].filter((name) => name.startsWith("__Host-"))).toEqual([]);
    expect((await unsafe(server, jar, rotatedToken)).statusCode).toBe(403);
  });
});
