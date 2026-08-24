import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import { Controller, Get, Module, NotFoundException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  ALL_PERMISSIONS,
  type AuthorizationSnapshot,
  type Permission,
} from "@pubg-camp/authorization";
import fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationModule,
  type AuthorizationModulePorts,
} from "../src/authorization/authorization.module.js";
import {
  AllowProvisional,
  Public,
  RequirePermission,
} from "../src/authorization/decorators.js";
import {
  CsrfService,
  type CsrfServiceOptions,
  registerCsrfPlugins,
} from "../src/security/csrf.service.js";
import { HttpExceptionFilter } from "../src/security/http-exception.filter.js";

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
  server.post("/login", { preHandler: csrf.protectHook() }, async (request, reply) =>
    csrf.rotateToSession(request, reply, "session-a"),
  );
  server.post("/unsafe", { preHandler: csrf.protectHook() }, async () => {
    onUnsafe();
    return { status: "ok" };
  });
  server.post("/rotate", { preHandler: csrf.protectHook() }, async (request, reply) =>
    csrf.rotateToSession(request, reply, "session-a-rotated"),
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
  origin: string | null = options.appOrigin,
) {
  return server.inject({
    method: "POST",
    url,
    headers: {
      cookie: cookieHeader(jar),
      ...(token === undefined ? {} : { "x-csrf-token": token }),
      ...(origin === null ? {} : { origin }),
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
    expect(token).toMatch(/^[A-Za-z0-9_-]{64,}$/);
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
    expect((await unsafe(server, jar, token, "/unsafe", null)).statusCode).toBe(403);
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

class AuthorizationTestController {
  publicRoute() {
    return { status: "public" };
  }

  unmarkedRoute() {
    return { status: "must-not-run" };
  }

  broadcastRoute() {
    return { status: "allowed" };
  }

  createOrganizationRoute() {
    return { status: "created" };
  }

  acceptInvitationRoute() {
    return { status: "accepted" };
  }

  resolveSessionAlertRoute() {
    return { status: "resolved" };
  }

  verifyProvisionalEmailRoute() {
    return { status: "verified" };
  }

  logoutRoute() {
    return { status: "logged-out" };
  }

  missingRoute(): never {
    throw new NotFoundException();
  }
}

Controller("authorization-test")(AuthorizationTestController);
for (const [method, path, decorators] of [
  ["publicRoute", "public", [Public()]],
  ["unmarkedRoute", "unmarked", []],
  ["broadcastRoute", "broadcast", [RequirePermission("tournament:broadcast:manage")]],
  ["createOrganizationRoute", "organizations", [RequirePermission("authenticated")]],
  ["acceptInvitationRoute", "invitations/accept", [RequirePermission("authenticated")]],
  [
    "resolveSessionAlertRoute",
    "session-alerts/resolve",
    [RequirePermission("identity:session-alerts:resolve")],
  ],
  [
    "verifyProvisionalEmailRoute",
    "onboarding/email/verify",
    [RequirePermission("authenticated"), AllowProvisional()],
  ],
  ["logoutRoute", "logout", [RequirePermission("authenticated"), AllowProvisional()]],
  ["missingRoute", "missing", [Public()]],
] as const) {
  const descriptor = Object.getOwnPropertyDescriptor(AuthorizationTestController.prototype, method);
  if (!descriptor) throw new Error(`missing test controller descriptor: ${method}`);
  Get(path)(AuthorizationTestController.prototype, method, descriptor);
  for (const decorator of decorators) {
    decorator(AuthorizationTestController.prototype, method, descriptor);
  }
}

function snapshot(overrides: Partial<AuthorizationSnapshot> = {}): AuthorizationSnapshot {
  return {
    actorId: "018f0ce7-98e3-7b27-bf2d-6eeac51d2301" as AuthorizationSnapshot["actorId"],
    organizationId:
      "018f0ce7-98e3-7b27-bf2d-6eeac51d2302" as AuthorizationSnapshot["organizationId"],
    membershipStatus: "active",
    organizationRole: null,
    assignments: [
      {
        organizationId:
          "018f0ce7-98e3-7b27-bf2d-6eeac51d2302" as AuthorizationSnapshot["organizationId"],
        authorizationScopeId:
          "018f0ce7-98e3-7b27-bf2d-6eeac51d2303" as AuthorizationSnapshot["assignments"][number]["authorizationScopeId"],
        role: "broadcast",
        status: "active",
      },
    ],
    ...overrides,
  };
}

async function createAuthorizationApp(ports: AuthorizationModulePorts) {
  class AuthorizationTestModule {}
  Module({
    controllers: [AuthorizationTestController],
    imports: [AuthorizationModule.register(ports)],
  })(AuthorizationTestModule);

  const adapter = new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: false });
  const app = await NestFactory.create<NestFastifyApplication>(AuthorizationTestModule, adapter, {
    logger: false,
    abortOnError: false,
  });
  await app.register(cookie);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await adapter.getInstance().ready();
  return { app, server: adapter.getInstance() };
}

async function createPermissionMatrixApp(
  permission: Permission,
  ports: AuthorizationModulePorts,
) {
  class PermissionMatrixController {
    route() {
      return { status: "allowed" };
    }
  }
  Controller("permission-matrix")(PermissionMatrixController);
  const descriptor = Object.getOwnPropertyDescriptor(PermissionMatrixController.prototype, "route");
  if (!descriptor) throw new Error("missing permission matrix descriptor");
  Get("check")(PermissionMatrixController.prototype, "route", descriptor);
  RequirePermission(permission)(PermissionMatrixController.prototype, "route", descriptor);

  class PermissionMatrixModule {}
  Module({
    controllers: [PermissionMatrixController],
    imports: [AuthorizationModule.register(ports)],
  })(PermissionMatrixModule);

  const adapter = new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: false });
  const app = await NestFactory.create<NestFastifyApplication>(PermissionMatrixModule, adapter, {
    logger: false,
    abortOnError: false,
  });
  await app.register(cookie);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await adapter.getInstance().ready();
  return { app, server: adapter.getInstance() };
}

describe("global default-deny authorization through Nest Fastify inject", () => {
  const apps: NestFastifyApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function ports(
    currentSnapshot = snapshot(),
    trust: "trusted" | "provisional" | "missing" = "trusted",
    securityLog = { record: vi.fn() },
  ): AuthorizationModulePorts & {
    loadSnapshot: ReturnType<typeof vi.fn>;
    securityLog: { record: ReturnType<typeof vi.fn> };
  } {
    const loadSnapshot = vi.fn(async () => currentSnapshot);
    return {
      authenticate: vi.fn(async (token: string) =>
        token === "session-a"
          ? {
              actorId: "018f0ce7-98e3-7b27-bf2d-6eeac51d2301",
              sessionId: "018f0ce7-98e3-7b27-bf2d-6eeac51d2304",
              ...(trust === "missing" ? {} : { trust }),
            }
          : null,
      ),
      loadSnapshot,
      securityLog,
    };
  }

  it("allows only @Public to skip session and denies protected routes without permission metadata", async () => {
    const harness = await createAuthorizationApp(ports());
    apps.push(harness.app);

    expect(
      (await harness.server.inject({ method: "GET", url: "/authorization-test/public" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await harness.server.inject({ method: "GET", url: "/authorization-test/unmarked" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await harness.server.inject({
          method: "GET",
          url: "/authorization-test/unmarked",
          headers: { cookie: "__Host-session=session-a" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("ignores request roles and denies the right role in the wrong organization or scope", async () => {
    const harness = await createAuthorizationApp(ports());
    apps.push(harness.app);

    const response = await harness.server.inject({
      method: "GET",
      url: "/authorization-test/broadcast",
      headers: {
        cookie: "__Host-session=session-a",
        "x-role": "owner",
        "x-organization-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2399",
        "x-authorization-scope-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2303",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("owner");
  });

  it("loads a live snapshot on every request so revocation takes effect immediately", async () => {
    let current = snapshot();
    const livePorts = ports();
    livePorts.loadSnapshot.mockImplementation(async () => current);
    const harness = await createAuthorizationApp(livePorts);
    apps.push(harness.app);
    const request = {
      method: "GET" as const,
      url: "/authorization-test/broadcast",
      headers: {
        cookie: "__Host-session=session-a",
        "x-organization-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2302",
        "x-authorization-scope-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2303",
      },
    };

    expect((await harness.server.inject(request)).statusCode).toBe(200);
    current = snapshot({ membershipStatus: "revoked", assignments: [] });
    expect((await harness.server.inject(request)).statusCode).toBe(403);
    expect(livePorts.loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it("keeps trusted session behavior for authenticated and RBAC-protected handlers", async () => {
    const trustedPorts = ports(snapshot({ organizationRole: "owner", assignments: [] }));
    const harness = await createAuthorizationApp(trustedPorts);
    apps.push(harness.app);

    const authenticated = await harness.server.inject({
      method: "GET",
      url: "/authorization-test/organizations",
      headers: { cookie: "__Host-session=session-a" },
    });
    const permission = await harness.server.inject({
      method: "GET",
      url: "/authorization-test/broadcast",
      headers: {
        cookie: "__Host-session=session-a",
        "x-organization-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2302",
        "x-authorization-scope-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2303",
      },
    });

    expect(authenticated.statusCode).toBe(200);
    expect(permission.statusCode).toBe(200);
    expect(trustedPorts.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(trustedPorts.securityLog.record).not.toHaveBeenCalled();
  });

  it("denies provisional sessions before every product permission reaches RBAC", async () => {
    const provisionalPorts = ports(snapshot({ organizationRole: "owner", assignments: [] }), "provisional");

    for (const permission of ALL_PERMISSIONS) {
      const harness = await createPermissionMatrixApp(permission, provisionalPorts);
      apps.push(harness.app);
      const response = await harness.server.inject({
        method: "GET",
        url: "/permission-matrix/check",
        headers: {
          cookie: "__Host-session=session-a",
          "x-correlation-id": "55555555-5555-4555-8555-555555555555",
          "x-organization-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2302",
          "x-authorization-scope-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2303",
        },
      });
      expect(response.statusCode, permission).toBe(403);
    }

    expect(provisionalPorts.loadSnapshot).not.toHaveBeenCalled();
    expect(provisionalPorts.securityLog.record).toHaveBeenCalledTimes(ALL_PERMISSIONS.length);
  });

  it("denies provisional organization mutations and session-alert resolution before handlers", async () => {
    const provisionalPorts = ports(snapshot(), "provisional");
    const harness = await createAuthorizationApp(provisionalPorts);
    apps.push(harness.app);
    const headers = {
      cookie: "__Host-session=session-a",
      "x-correlation-id": "55555555-5555-4555-8555-555555555555",
    };

    for (const path of ["organizations", "invitations/accept", "session-alerts/resolve"]) {
      const response = await harness.server.inject({
        method: "GET",
        url: `/authorization-test/${path}`,
        headers,
      });
      expect(response.statusCode, path).toBe(403);
      expect(response.body, path).not.toContain("created");
      expect(response.body, path).not.toContain("accepted");
      expect(response.body, path).not.toContain("resolved");
    }

    expect(provisionalPorts.loadSnapshot).not.toHaveBeenCalled();
  });

  it("allows provisional access only with explicit onboarding or logout metadata", async () => {
    const provisionalPorts = ports(snapshot(), "provisional");
    const harness = await createAuthorizationApp(provisionalPorts);
    apps.push(harness.app);
    const headers = { cookie: "__Host-session=session-a" };

    expect(
      (
        await harness.server.inject({
          method: "GET",
          url: "/authorization-test/onboarding/email/verify",
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await harness.server.inject({
          method: "GET",
          url: "/authorization-test/logout",
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(provisionalPorts.loadSnapshot).not.toHaveBeenCalled();
    expect(provisionalPorts.securityLog.record).not.toHaveBeenCalled();
  });

  it("fails closed when authenticated session trust is missing", async () => {
    const missingTrustPorts = ports(snapshot({ organizationRole: "owner" }), "missing");
    const harness = await createAuthorizationApp(missingTrustPorts);
    apps.push(harness.app);
    const headers = {
      cookie: "__Host-session=session-a",
      "x-organization-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2302",
      "x-authorization-scope-id": "018f0ce7-98e3-7b27-bf2d-6eeac51d2303",
    };

    for (const path of [
      "organizations",
      "invitations/accept",
      "session-alerts/resolve",
      "broadcast",
      "onboarding/email/verify",
      "logout",
    ]) {
      expect(
        (
          await harness.server.inject({
            method: "GET",
            url: `/authorization-test/${path}`,
            headers,
          })
        ).statusCode,
        path,
      ).toBe(403);
    }

    expect(missingTrustPorts.loadSnapshot).not.toHaveBeenCalled();
  });

  it("records one stable redacted event for each provisional denial", async () => {
    const securityLog = { record: vi.fn() };
    const provisionalPorts = ports(snapshot(), "provisional", securityLog);
    const harness = await createAuthorizationApp(provisionalPorts);
    apps.push(harness.app);

    const response = await harness.server.inject({
      method: "GET",
      url: "/authorization-test/organizations",
      headers: {
        cookie: "__Host-session=session-a; private-device=fingerprint-secret",
        authorization: "Bearer token-must-not-leak",
        "x-correlation-id": "55555555-5555-4555-8555-555555555555",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(securityLog.record).toHaveBeenCalledOnce();
    expect(securityLog.record).toHaveBeenCalledWith({
      category: "authorization-provisional-denied",
      correlationId: "55555555-5555-4555-8555-555555555555",
      actorId: "018f0ce7-98e3-7b27-bf2d-6eeac51d2301",
      sessionId: "018f0ce7-98e3-7b27-bf2d-6eeac51d2304",
    });
    const recorded = JSON.stringify(securityLog.record.mock.calls);
    expect(recorded).not.toContain("fingerprint-secret");
    expect(recorded).not.toContain("token-must-not-leak");
    expect(recorded).not.toContain("session-a");
  });

  it("returns uniform support-coded errors without infrastructure secrets or stacks", async () => {
    const secret = "database-password-must-never-leak";
    const harness = await createAuthorizationApp({
      authenticate: vi.fn(async () => {
        throw new Error(secret);
      }),
      loadSnapshot: vi.fn(async () => snapshot()),
      securityLog: { record: vi.fn() },
    });
    apps.push(harness.app);

    const response = await harness.server.inject({
      method: "GET",
      url: "/authorization-test/broadcast",
      headers: { cookie: "__Host-session=session-a" },
    });
    const body = response.json<Record<string, unknown>>();

    expect(response.statusCode).toBe(503);
    expect(body).toEqual({
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
      supportCode: expect.stringMatching(/^SUP-[A-Z0-9]{12}$/),
    });
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain("stack");

    const missing = await harness.server.inject({
      method: "GET",
      url: "/authorization-test/missing",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
      supportCode: expect.stringMatching(/^SUP-[A-Z0-9]{12}$/),
    });
  });
});
