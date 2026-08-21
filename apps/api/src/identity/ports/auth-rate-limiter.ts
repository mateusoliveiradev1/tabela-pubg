export type AuthRateLimitOperation = "otp-request" | "otp-verify";
export type AuthRateLimitDimension = "email" | "ip" | "email-ip" | "cooldown";

export interface AuthRateLimitKey {
  dimension: AuthRateLimitDimension;
  digest: string;
}

export interface AuthRateLimiter {
  consume(input: {
    operation: AuthRateLimitOperation;
    keys: readonly AuthRateLimitKey[];
    now: Date;
  }): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
}
