import { createHash } from "node:crypto";
import { RateLimiterRedis, type RateLimiterRes } from "rate-limiter-flexible";
import type {
  AuthRateLimitDimension,
  AuthRateLimiter,
  AuthRateLimitKey,
  AuthRateLimitOperation,
} from "../ports/auth-rate-limiter.js";
import type { DiscordOAuthVerifierRecord, DiscordOAuthVerifierStore } from "./discord-oauth.js";

export interface RedisStoreClient {
  readonly status?: string;
  connect?(): Promise<unknown>;
  set(key: string, value: string, mode: "PX", ttlMs: number, condition: "NX"): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}

export interface RateLimitPolicy {
  points: number;
  durationSeconds: number;
  blockDurationSeconds?: number;
}

type OperationPolicies = Partial<Record<AuthRateLimitDimension, RateLimitPolicy>>;

export interface RedisAuthRateLimiterOptions {
  keyPrefix?: string;
  policies?: Partial<Record<AuthRateLimitOperation, OperationPolicies>>;
}

const defaultPolicies: Record<AuthRateLimitOperation, OperationPolicies> = {
  "otp-request": {
    email: { points: 5, durationSeconds: 3_600 },
    ip: { points: 20, durationSeconds: 3_600 },
    "email-ip": { points: 5, durationSeconds: 3_600 },
    cooldown: { points: 1, durationSeconds: 60 },
  },
  "otp-verify": {
    email: { points: 10, durationSeconds: 600, blockDurationSeconds: 600 },
    ip: { points: 50, durationSeconds: 600, blockDurationSeconds: 600 },
    "email-ip": { points: 10, durationSeconds: 600, blockDurationSeconds: 600 },
  },
};

export class RedisAuthRateLimiter implements AuthRateLimiter {
  private readonly policies: Record<AuthRateLimitOperation, OperationPolicies>;
  private readonly limiters = new Map<string, RateLimiterRedis>();
  private readonly keyPrefix: string;

  constructor(
    private readonly client: RedisStoreClient,
    options: RedisAuthRateLimiterOptions = {},
  ) {
    this.keyPrefix = validateRedisKeyPrefix(
      options.keyPrefix ?? "pubg-camp:auth",
      /^(?:pubg-camp:auth|pubg-camp:run-[a-z0-9][a-z0-9-]{14,62}:auth)$/,
    );
    this.policies = {
      "otp-request": { ...defaultPolicies["otp-request"], ...options.policies?.["otp-request"] },
      "otp-verify": { ...defaultPolicies["otp-verify"], ...options.policies?.["otp-verify"] },
    };
    validatePolicies(this.policies);
  }

  async consume(input: {
    operation: AuthRateLimitOperation;
    keys: readonly AuthRateLimitKey[];
    now: Date;
  }): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    if (!Number.isFinite(input.now.getTime()) || input.keys.length === 0) {
      throw new Error("auth limiter unavailable");
    }
    await this.ensureReady();

    let retryAfterSeconds = 0;
    for (const key of input.keys) {
      const policy = this.policies[input.operation][key.dimension];
      if (!policy || key.digest.trim().length === 0) {
        throw new Error("auth limiter unavailable");
      }
      try {
        await this.limiter(input.operation, key.dimension, policy).consume(key.digest);
      } catch (error) {
        if (!isRateLimitRejection(error)) throw new Error("auth limiter unavailable");
        retryAfterSeconds = Math.max(
          retryAfterSeconds,
          Math.max(1, Math.ceil(error.msBeforeNext / 1_000)),
        );
      }
    }

    return retryAfterSeconds > 0 ? { allowed: false, retryAfterSeconds } : { allowed: true };
  }

  private limiter(
    operation: AuthRateLimitOperation,
    dimension: AuthRateLimitDimension,
    policy: RateLimitPolicy,
  ): RateLimiterRedis {
    const id = `${operation}:${dimension}`;
    const existing = this.limiters.get(id);
    if (existing) return existing;
    const limiter = new RateLimiterRedis({
      storeClient: this.client,
      keyPrefix: `${this.keyPrefix}:${operation}:${dimension}`,
      points: policy.points,
      duration: policy.durationSeconds,
      blockDuration: policy.blockDurationSeconds ?? 0,
      rejectIfRedisNotReady: true,
    });
    this.limiters.set(id, limiter);
    return limiter;
  }

  private async ensureReady(): Promise<void> {
    if (this.client.status === "wait" && this.client.connect) {
      try {
        await this.client.connect();
      } catch {
        throw new Error("auth limiter unavailable");
      }
    }
    if (this.client.status !== undefined && this.client.status !== "ready") {
      throw new Error("auth limiter unavailable");
    }
  }
}

export class RedisDiscordOAuthVerifierStore implements DiscordOAuthVerifierStore {
  private readonly keyPrefix: string;

  constructor(
    private readonly client: RedisStoreClient,
    keyPrefix = "pubg-camp:oauth:pkce",
  ) {
    this.keyPrefix = validateRedisKeyPrefix(
      keyPrefix,
      /^(?:pubg-camp:oauth:pkce|pubg-camp:run-[a-z0-9][a-z0-9-]{14,62}:oauth:pkce)$/,
    );
  }

  async save(state: string, record: DiscordOAuthVerifierRecord): Promise<void> {
    const ttlMs = record.expiresAt.getTime() - Date.now();
    if (state.trim().length === 0 || ttlMs <= 0) throw new Error("oauth transaction unavailable");
    const saved = await this.client.set(
      this.key(state),
      JSON.stringify({
        mode: record.mode,
        codeVerifier: record.codeVerifier,
        expiresAt: record.expiresAt.toISOString(),
      }),
      "PX",
      ttlMs,
      "NX",
    );
    if (saved !== "OK") throw new Error("oauth transaction unavailable");
  }

  async consume(state: string): Promise<DiscordOAuthVerifierRecord | null> {
    if (state.trim().length === 0) return null;
    const encoded = await this.client.getdel(this.key(state));
    if (encoded === null) return null;
    try {
      const value = JSON.parse(encoded) as Record<string, unknown>;
      if (
        (value.mode !== "required" && value.mode !== "documented-exception") ||
        typeof value.expiresAt !== "string" ||
        (value.codeVerifier !== undefined && typeof value.codeVerifier !== "string")
      ) {
        return null;
      }
      const expiresAt = new Date(value.expiresAt);
      if (!Number.isFinite(expiresAt.getTime())) return null;
      return {
        mode: value.mode,
        ...(typeof value.codeVerifier === "string" ? { codeVerifier: value.codeVerifier } : {}),
        expiresAt,
      };
    } catch {
      return null;
    }
  }

  private key(state: string): string {
    return `${this.keyPrefix}:${createHash("sha256").update(state, "utf8").digest("hex")}`;
  }
}

function isRateLimitRejection(value: unknown): value is RateLimiterRes {
  return (
    typeof value === "object" &&
    value !== null &&
    "msBeforeNext" in value &&
    typeof value.msBeforeNext === "number" &&
    Number.isFinite(value.msBeforeNext)
  );
}

function validatePolicies(policies: Record<AuthRateLimitOperation, OperationPolicies>): void {
  for (const operation of Object.values(policies)) {
    for (const policy of Object.values(operation)) {
      if (
        policy.points < 1 ||
        !Number.isInteger(policy.points) ||
        policy.durationSeconds < 1 ||
        !Number.isInteger(policy.durationSeconds)
      ) {
        throw new Error("invalid auth limiter policy");
      }
    }
  }
}

function validateRedisKeyPrefix(value: string, allowed: RegExp): string {
  const scopedRun = /^pubg-camp:(run-[^:]+):/.exec(value)?.[1];
  if (
    !allowed.test(value) ||
    (scopedRun !== undefined &&
      /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/.test(scopedRun))
  ) {
    throw new Error("invalid identity Redis key prefix");
  }
  return value;
}
