import { randomBytes } from "node:crypto";
import { createRedisConnection } from "@pubg-camp/queue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveIdentityRedisPrefixes } from "../identity.runtime.js";
import { RedisAuthRateLimiter, RedisDiscordOAuthVerifierStore } from "./redis-auth-rate-limiter.js";

const redisUrl = resolveTestRedisUrl(process.env);
const firstRunScopeId = canonicalRunScopeId();
const secondRunScopeId = canonicalRunScopeId();
const firstPrefixes = resolveIdentityRedisPrefixes({ mode: "run", runScopeId: firstRunScopeId });
const secondPrefixes = resolveIdentityRedisPrefixes({ mode: "run", runScopeId: secondRunScopeId });
const productionSentinelKey = "pubg-camp:auth:02-41-production-sentinel";
const foreignSentinelKey = `pubg-camp:${secondRunScopeId}:foreign-sentinel`;

describe("RedisAuthRateLimiter integration", () => {
  const clients: ReturnType<typeof createRedisConnection>[] = [];
  let fixtureClient: ReturnType<typeof createRedisConnection>;

  beforeAll(async () => {
    fixtureClient = createRedisConnection(redisUrl);
    clients.push(fixtureClient);
    await fixtureClient.connect();
    await fixtureClient.ping();
    await fixtureClient.set(productionSentinelKey, "production-owned");
    await fixtureClient.set(foreignSentinelKey, "foreign-owned");
  });

  afterAll(async () => {
    try {
      await cleanupExactRunScope(fixtureClient, firstRunScopeId);
      expect(await fixtureClient.get(foreignSentinelKey)).toBe("foreign-owned");
      expect(await fixtureClient.get(productionSentinelKey)).toBe("production-owned");
      await cleanupExactRunScope(fixtureClient, secondRunScopeId);
      expect(await fixtureClient.get(foreignSentinelKey)).toBeNull();
      await fixtureClient.unlink(productionSentinelKey);
    } finally {
      await Promise.all(clients.map((client) => client.quit().catch(() => undefined)));
    }
  });

  function createAdapter(keyPrefix: string): RedisAuthRateLimiter {
    const client = createRedisConnection(redisUrl);
    clients.push(client);
    return new RedisAuthRateLimiter(client, {
      keyPrefix,
      policies: {
        "otp-request": {
          email: { points: 4, durationSeconds: 2 },
          ip: { points: 4, durationSeconds: 2 },
          "email-ip": { points: 4, durationSeconds: 2 },
          cooldown: { points: 1, durationSeconds: 1 },
        },
        "otp-verify": {
          email: { points: 2, durationSeconds: 1 },
          ip: { points: 2, durationSeconds: 1 },
          "email-ip": { points: 2, durationSeconds: 1 },
        },
      },
    });
  }

  it("isolates limiter counters between two independent run scopes", async () => {
    const first = createAdapter(firstPrefixes.authKeyPrefix);
    const sameRun = createAdapter(firstPrefixes.authKeyPrefix);
    const foreignRun = createAdapter(secondPrefixes.authKeyPrefix);
    const now = new Date();
    const verifyInput = {
      operation: "otp-verify" as const,
      now,
      keys: [{ dimension: "email" as const, digest: "same-email-digest" }],
    };

    await expect(first.consume(verifyInput)).resolves.toEqual({ allowed: true });
    await expect(sameRun.consume(verifyInput)).resolves.toEqual({ allowed: true });
    await expect(first.consume(verifyInput)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    await expect(foreignRun.consume(verifyInput)).resolves.toEqual({ allowed: true });

    const requestInput = {
      operation: "otp-request" as const,
      now,
      keys: [{ dimension: "cooldown" as const, digest: "cooldown-email-digest" }],
    };
    await expect(first.consume(requestInput)).resolves.toEqual({ allowed: true });
    await expect(sameRun.consume(requestInput)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    await expect(foreignRun.consume(requestInput)).resolves.toEqual({ allowed: true });

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(sameRun.consume(verifyInput)).resolves.toEqual({ allowed: true });
    await expect(sameRun.consume(requestInput)).resolves.toEqual({ allowed: true });
  });

  it("keeps the production OTP cooldown at sixty seconds on real Redis", async () => {
    const client = createRedisConnection(redisUrl);
    clients.push(client);
    const adapter = new RedisAuthRateLimiter(client, { keyPrefix: firstPrefixes.authKeyPrefix });
    const input = {
      operation: "otp-request" as const,
      now: new Date(),
      keys: [{ dimension: "cooldown" as const, digest: "production-cooldown-digest" }],
    };

    await expect(adapter.consume(input)).resolves.toEqual({ allowed: true });
    await expect(adapter.consume(input)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("fails closed immediately when Redis is unavailable", async () => {
    const adapter = createAdapter(firstPrefixes.authKeyPrefix);
    const client = clients.at(-1);
    await client?.disconnect();

    await expect(
      adapter.consume({
        operation: "otp-verify",
        now: new Date(),
        keys: [{ dimension: "email" as const, digest: "fail-closed-digest" }],
      }),
    ).rejects.toThrow("auth limiter unavailable");
  });

  it("rejects blank, broad and separator-escaping adapter prefixes", () => {
    for (const keyPrefix of [
      "",
      "pubg-camp",
      ["pubg-camp:", "*"].join(""),
      "pubg-camp:run-shared-012345678901:auth",
      `pubg-camp:${firstRunScopeId}/escaped:auth`,
    ]) {
      expect(() => new RedisAuthRateLimiter(fixtureClient, { keyPrefix })).toThrow(
        "invalid identity Redis key prefix",
      );
    }
    for (const keyPrefix of [
      "",
      "pubg-camp:oauth",
      ["pubg-camp:oauth:", "*"].join(""),
      "pubg-camp:run-global-012345678901:oauth:pkce",
      `pubg-camp:${firstRunScopeId}\\escaped:oauth:pkce`,
    ]) {
      expect(() => new RedisDiscordOAuthVerifierStore(fixtureClient, keyPrefix)).toThrow(
        "invalid identity Redis key prefix",
      );
    }
  });

  it("keeps PKCE one-use inside its owning run and denies cross-run consume", async () => {
    const firstStore = new RedisDiscordOAuthVerifierStore(
      fixtureClient,
      firstPrefixes.oauthPkceKeyPrefix,
    );
    const foreignStore = new RedisDiscordOAuthVerifierStore(
      fixtureClient,
      secondPrefixes.oauthPkceKeyPrefix,
    );
    const state = "raw-oauth-state-must-not-be-a-redis-key";
    const record = {
      mode: "required" as const,
      codeVerifier: "verifier-with-sufficient-entropy-for-pkce-1234567890",
      expiresAt: new Date(Date.now() + 5_000),
    };

    await firstStore.save(state, record);
    const keys = await scanKeys(fixtureClient, `${firstPrefixes.oauthPkceKeyPrefix}:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(state);
    await expect(foreignStore.consume(state)).resolves.toBeNull();
    await expect(firstStore.consume(state)).resolves.toEqual(record);
    await expect(firstStore.consume(state)).resolves.toBeNull();
  });

  it("cleans exactly one validated scope and preserves foreign and production sentinels", async () => {
    await fixtureClient.set(`pubg-camp:${firstRunScopeId}:owned-one`, "owned");
    await fixtureClient.set(`pubg-camp:${firstRunScopeId}:owned-two`, "owned");

    await expect(cleanupExactRunScope(fixtureClient, "run-shared-012345678901")).rejects.toThrow(
      "identity Redis run scope is invalid",
    );
    expect(await fixtureClient.get(`pubg-camp:${firstRunScopeId}:owned-one`)).toBe("owned");

    await cleanupExactRunScope(fixtureClient, firstRunScopeId);

    expect(await scanKeys(fixtureClient, `pubg-camp:${firstRunScopeId}:*`)).toEqual([]);
    expect(await fixtureClient.get(foreignSentinelKey)).toBe("foreign-owned");
    expect(await fixtureClient.get(productionSentinelKey)).toBe("production-owned");
  });
});

function canonicalRunScopeId(): string {
  return `run-${randomBytes(12).toString("hex")}`;
}

function resolveTestRedisUrl(environment: NodeJS.ProcessEnv): string {
  const selected = Object.hasOwn(environment, "TEST_REDIS_URL")
    ? environment.TEST_REDIS_URL
    : environment.REDIS_URL;
  if (!selected || selected.trim() !== selected) {
    throw new Error("TEST_REDIS_URL or REDIS_URL must select a non-blank Redis endpoint");
  }
  let parsed: URL;
  try {
    parsed = new URL(selected);
  } catch {
    throw new Error("selected test Redis endpoint must be a valid URL");
  }
  if (
    !["redis:", "rediss:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    /(?:example|placeholder|change-me)/i.test(parsed.hostname)
  ) {
    throw new Error("selected test Redis endpoint must target a real Redis service");
  }
  return selected;
}

async function scanKeys(
  client: ReturnType<typeof createRedisConnection>,
  pattern: string,
): Promise<string[]> {
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [nextCursor, page] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    keys.push(...page);
  } while (cursor !== "0");
  return keys.toSorted();
}

async function cleanupExactRunScope(
  client: ReturnType<typeof createRedisConnection>,
  runScopeId: string,
): Promise<void> {
  resolveIdentityRedisPrefixes({ mode: "run", runScopeId });
  const keys = await scanKeys(client, `pubg-camp:${runScopeId}:*`);
  if (keys.length > 0) await client.unlink(...keys);
}
