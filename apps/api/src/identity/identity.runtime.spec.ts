import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentitySecurityChangeReauthenticationRequiredError } from "@pubg-camp/database";
import { ReauthenticationRequiredException } from "./identity.service.js";

const runtimeSpies = vi.hoisted(() => ({
  authConstructor: vi.fn(),
  createRedisConnection: vi.fn(),
  pingRedis: vi.fn(),
  pkceConstructor: vi.fn(),
  quit: vi.fn(),
}));

vi.mock("@pubg-camp/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pubg-camp/queue")>()),
  createRedisConnection: runtimeSpies.createRedisConnection,
  pingRedis: runtimeSpies.pingRedis,
}));

vi.mock("./adapters/redis-auth-rate-limiter.js", () => ({
  RedisAuthRateLimiter: class {
    constructor(client: unknown, options: unknown) {
      runtimeSpies.authConstructor(client, options);
    }

    async consume() {
      return { allowed: true as const };
    }
  },
  RedisDiscordOAuthVerifierStore: class {
    constructor(client: unknown, keyPrefix: unknown) {
      runtimeSpies.pkceConstructor(client, keyPrefix);
    }

    async save() {}

    async consume() {
      return null;
    }
  },
}));

import {
  buildIdentitySecurityChangeApplication,
  buildOtpNotificationDelivery,
  createIdentityRuntime,
  projectOAuthTransaction,
  resolveIdentityRedisPrefixes,
} from "./identity.runtime.js";

const validRunScopeId = "run-0123456789abcdef01234567";

function runtimeOptions() {
  return {
    database: {} as never,
    redisUrl: "redis://127.0.0.1:6379",
    discord: {
      clientId: "123456789012345678",
      clientSecret: "discord-client-credential-with-strong-entropy",
      redirectUri: "https://camp.test/identity/oauth/discord/callback",
      pkceMode: "required" as const,
    },
    csrf: {} as never,
    tokens: {
      id: vi.fn(() => "generated-id"),
      opaque: vi.fn(() => Buffer.alloc(32, 7).toString("base64url")),
      numericCode: vi.fn(() => "12345678"),
      digest: vi.fn((value: string) => `digest:${value}`),
    },
    otpPepper: new Uint8Array(32),
    encryptionKey: {} as never,
    policies: {
      session: { idleMs: 300_000, absoluteMs: 3_600_000, activityWriteIntervalMs: 30_000 },
      otp: { lifetimeMs: 120_000, maxAttempts: 2, cooldownSeconds: 17 },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const redis = { quit: runtimeSpies.quit };
  runtimeSpies.createRedisConnection.mockReturnValue(redis);
  runtimeSpies.pingRedis.mockResolvedValue(undefined);
  runtimeSpies.quit.mockResolvedValue(undefined);
});

describe("identity runtime Redis scope contract", () => {
  it("keeps production prefixes byte-for-byte stable and injects both explicitly", async () => {
    expect(resolveIdentityRedisPrefixes({ mode: "production" })).toEqual({
      authKeyPrefix: "pubg-camp:auth",
      oauthPkceKeyPrefix: "pubg-camp:oauth:pkce",
    });

    const runtime = await createIdentityRuntime(runtimeOptions());
    const redis = runtimeSpies.createRedisConnection.mock.results[0]?.value;

    expect(runtimeSpies.authConstructor).toHaveBeenCalledWith(redis, {
      keyPrefix: "pubg-camp:auth",
      policies: { "otp-request": { cooldown: { points: 1, durationSeconds: 17 } } },
    });
    expect(runtimeSpies.pkceConstructor).toHaveBeenCalledWith(redis, "pubg-camp:oauth:pkce");
    await runtime.close();
  });

  it("derives both adapter prefixes from the same validated run scope exactly once", async () => {
    expect(resolveIdentityRedisPrefixes({ mode: "run", runScopeId: validRunScopeId })).toEqual({
      authKeyPrefix: `pubg-camp:${validRunScopeId}:auth`,
      oauthPkceKeyPrefix: `pubg-camp:${validRunScopeId}:oauth:pkce`,
    });

    const runtime = await createIdentityRuntime({
      ...runtimeOptions(),
      redisScope: { mode: "run", runScopeId: validRunScopeId },
    });
    const redis = runtimeSpies.createRedisConnection.mock.results[0]?.value;

    expect(runtimeSpies.authConstructor).toHaveBeenCalledWith(redis, {
      keyPrefix: `pubg-camp:${validRunScopeId}:auth`,
      policies: { "otp-request": { cooldown: { points: 1, durationSeconds: 17 } } },
    });
    expect(runtimeSpies.pkceConstructor).toHaveBeenCalledWith(
      redis,
      `pubg-camp:${validRunScopeId}:oauth:pkce`,
    );
    await runtime.close();
  });

  it.each([
    ["absent", { mode: "run" }],
    ["empty", { mode: "run", runScopeId: "" }],
    ["broad", { mode: "run", runScopeId: "run-shared-012345678901" }],
    ["whitespace", { mode: "run", runScopeId: ` ${validRunScopeId}` }],
    ["path-bearing", { mode: "run", runScopeId: "run-0123456789/abcdef012345" }],
    ["under-length", { mode: "run", runScopeId: "run-01234567890123" }],
    ["over-length", { mode: "run", runScopeId: `run-${"a".repeat(64)}` }],
  ])("rejects %s run scope before opening Redis", async (_case, redisScope) => {
    expect(() => resolveIdentityRedisPrefixes(redisScope as never)).toThrow(
      "identity Redis run scope is invalid",
    );
    await expect(
      createIdentityRuntime({ ...runtimeOptions(), redisScope: redisScope as never }),
    ).rejects.toThrow("identity Redis run scope is invalid");
    expect(runtimeSpies.createRedisConnection).not.toHaveBeenCalled();
    expect(runtimeSpies.authConstructor).not.toHaveBeenCalled();
    expect(runtimeSpies.pkceConstructor).not.toHaveBeenCalled();
  });
});

describe("identity runtime OTP delivery contract", () => {
  it("uses the worker-supported template and expiry payload without persisting the challenge id", () => {
    const expiresAt = new Date("2026-08-24T04:15:00.000Z");

    const delivery = buildOtpNotificationDelivery({
      deliveryId: "b7f79d9d-8547-4d91-8989-f86e2edb7614",
      challengeId: "35a1f6df-7eac-4bc1-a485-39e4ae063570",
      recipient: "player@example.com",
      code: "12345678",
      expiresAt,
      correlationId: "corr-otp-contract",
    });

    expect(delivery).toEqual({
      id: "b7f79d9d-8547-4d91-8989-f86e2edb7614",
      template: "otp",
      recipient: "player@example.com",
      idempotencyKey: "otp:35a1f6df-7eac-4bc1-a485-39e4ae063570",
      payload: {
        recipient: "player@example.com",
        code: "12345678",
        expiresAt: "2026-08-24T04:15:00.000Z",
      },
      payloadExpiresAt: expiresAt,
      availableAt: expect.any(Date),
      occurredAt: expect.any(Date),
      correlationId: "corr-otp-contract",
    });
    expect(JSON.stringify(delivery.payload)).not.toContain("35a1f6df-7eac-4bc1-a485-39e4ae063570");
  });
});

describe("identity runtime OAuth transaction projection", () => {
  it("preserves purpose, server-derived actor/session and the current-method timestamp", () => {
    const currentMethodConfirmedAt = new Date("2026-08-24T15:00:00.000Z");

    expect(
      projectOAuthTransaction({
        purpose: "link-identity",
        returnPath: "/account/identities",
        userId: "actor-1",
        sessionId: "session-1",
        currentMethodConfirmedAt,
      }),
    ).toEqual({
      purpose: "link-identity",
      returnPath: "/account/identities",
      actorId: "actor-1",
      sessionId: "session-1",
      currentMethodConfirmedAt,
    });
  });

  it("does not invent protected authority for sign-in", () => {
    expect(
      projectOAuthTransaction({
        purpose: "sign-in",
        returnPath: null,
        userId: null,
        sessionId: null,
        currentMethodConfirmedAt: null,
      }),
    ).toEqual({ purpose: "sign-in" });
  });
});

describe("identity runtime D-08 adapter", () => {
  it("supplies database, time and server generators to the single atomic command", async () => {
    const database = { transaction: vi.fn() } as never;
    const now = new Date("2026-08-24T12:00:00.000Z");
    const execute = vi.fn(async () => ({
      sessionId: "session-1",
      newSessionToken: "replacement-token",
      revokedOtherSessions: 3,
    }));
    const tokens = {
      id: vi.fn(() => "generated-id"),
      opaque: vi.fn(() => Buffer.alloc(32, 7).toString("base64url")),
      numericCode: vi.fn(() => "12345678"),
      digest: vi.fn((value: string) => `digest:${value}`),
    };
    const adapter = buildIdentitySecurityChangeApplication({
      database,
      tokens,
      clock: { now: () => now },
      execute,
    });

    const result = await adapter.execute({
      actorId: "actor-1",
      currentSessionId: "session-1",
      proofId: "proof-1",
      change: { type: "link-identity", provider: "email", email: "player@example.com" },
      now,
      correlationId: "corr-1",
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        database,
        actorId: "actor-1",
        currentSessionId: "session-1",
        proofId: "proof-1",
        change: { type: "link-identity", provider: "email", email: "player@example.com" },
        now,
        generateId: expect.any(Function),
        generateCorrelationId: expect.any(Function),
        generateOpaqueToken: expect.any(Function),
      }),
    );
    expect(result).toEqual({
      sessionId: "session-1",
      sessionToken: "replacement-token",
      otherSessionsRevoked: 3,
    });
  });

  it("maps only the transactional freshness rejection to typed HTTP 428", async () => {
    const adapter = buildIdentitySecurityChangeApplication({
      database: { transaction: vi.fn() } as never,
      tokens: {
        id: vi.fn(() => "generated-id"),
        opaque: vi.fn(() => Buffer.alloc(32, 7).toString("base64url")),
        numericCode: vi.fn(() => "12345678"),
        digest: vi.fn((value: string) => `digest:${value}`),
      },
      clock: { now: () => new Date("2026-08-25T05:00:00.000Z") },
      execute: vi.fn(async () => {
        throw new IdentitySecurityChangeReauthenticationRequiredError();
      }),
    });

    await expect(
      adapter.execute({
        actorId: "actor-1",
        currentSessionId: "session-1",
        proofId: "proof-1",
        change: { type: "link-identity", provider: "email", email: "player@example.com" },
        now: new Date("2026-08-25T05:00:00.000Z"),
        correlationId: "corr-reauth",
      }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredException);
  });
});
