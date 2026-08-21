import { randomUUID } from "node:crypto";
import { createRedisConnection } from "@pubg-camp/queue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisAuthRateLimiter, RedisDiscordOAuthVerifierStore } from "./redis-auth-rate-limiter.js";

const redisUrl = process.env.TEST_REDIS_URL;

describe.runIf(Boolean(redisUrl))("RedisAuthRateLimiter integration", () => {
  const clients: ReturnType<typeof createRedisConnection>[] = [];
  const prefix = `phase2-auth-${randomUUID()}`;

  beforeAll(async () => {
    if (!redisUrl) throw new Error("TEST_REDIS_URL is required");
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.quit().catch(() => undefined)));
  });

  function createAdapter(): RedisAuthRateLimiter {
    if (!redisUrl) throw new Error("TEST_REDIS_URL is required");
    const client = createRedisConnection(redisUrl);
    clients.push(client);
    return new RedisAuthRateLimiter(client, {
      keyPrefix: prefix,
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

  it("shares counters, cooldown and TTL between two independent instances", async () => {
    const first = createAdapter();
    const second = createAdapter();
    const now = new Date();
    const verifyInput = {
      operation: "otp-verify" as const,
      now,
      keys: [{ dimension: "email" as const, digest: "same-email-digest" }],
    };

    await expect(first.consume(verifyInput)).resolves.toEqual({ allowed: true });
    await expect(second.consume(verifyInput)).resolves.toEqual({ allowed: true });
    await expect(first.consume(verifyInput)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });

    const requestInput = {
      operation: "otp-request" as const,
      now,
      keys: [{ dimension: "cooldown" as const, digest: "cooldown-email-digest" }],
    };
    await expect(first.consume(requestInput)).resolves.toEqual({ allowed: true });
    await expect(second.consume(requestInput)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(second.consume(verifyInput)).resolves.toEqual({ allowed: true });
    await expect(second.consume(requestInput)).resolves.toEqual({ allowed: true });
  });

  it("fails closed immediately when Redis is unavailable", async () => {
    const adapter = createAdapter();
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

  it("stores the PKCE verifier behind a state digest and consumes it once", async () => {
    if (!redisUrl) throw new Error("TEST_REDIS_URL is required");
    const client = createRedisConnection(redisUrl);
    clients.push(client);
    await client.connect();
    const store = new RedisDiscordOAuthVerifierStore(client, `${prefix}:pkce`);
    const state = "raw-oauth-state-must-not-be-a-redis-key";
    const record = {
      mode: "required" as const,
      codeVerifier: "verifier-with-sufficient-entropy-for-pkce-1234567890",
      expiresAt: new Date(Date.now() + 5_000),
    };

    await store.save(state, record);
    const keys = await client.keys(`${prefix}:pkce:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(state);
    await expect(store.consume(state)).resolves.toEqual(record);
    await expect(store.consume(state)).resolves.toBeNull();
  });
});
