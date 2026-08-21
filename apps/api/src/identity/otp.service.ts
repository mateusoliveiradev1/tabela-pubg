import { Injectable } from "@nestjs/common";
import type { AuthRateLimiter } from "./ports/auth-rate-limiter.js";
import type { TokenGenerator } from "./ports/token-generator.js";

export type OtpPurpose = "sign-in" | "link-email" | "change-email" | "step-up";

export interface OtpChallengeRecord {
  id: string;
  emailDigest: string;
  purpose: OtpPurpose;
  codeDigest: string;
  attemptsRemaining: number;
  expiresAt: Date;
}

export interface OtpRepository {
  replace(challenge: OtpChallengeRecord): Promise<void>;
  findActive(challengeId: string, purpose: OtpPurpose): Promise<OtpChallengeRecord | null>;
  recordFailure(challengeId: string, now: Date): Promise<number>;
  consumeIfActive(input: {
    challengeId: string;
    codeDigest: string;
    now: Date;
  }): Promise<{ consumed: boolean }>;
}

export interface SecureOtpDeliveryPort {
  enqueue(input: {
    deliveryId: string;
    challengeId: string;
    recipient: string;
    code: string;
    expiresAt: Date;
    correlationId: string;
  }): Promise<void>;
}

export interface AuthSecurityLog {
  record(event: {
    correlationId: string;
    category:
      | "otp-request-limited"
      | "otp-verify-limited"
      | "otp-limiter-unavailable"
      | "otp-invalid";
  }): void;
}

export interface OtpClock {
  now(): Date;
}

export interface OtpRequestResult {
  response: { status: "accepted"; retryAfterSeconds: 60 };
  challengeId?: string;
}

export type OtpVerifyResult =
  | { status: "authenticated" }
  | { status: "identity-link-ready" }
  | { status: "email-change-ready" }
  | { status: "step-up-confirmed"; validUntil: Date }
  | { status: "rejected" };

@Injectable()
export class OtpService {
  constructor(
    private readonly repository: OtpRepository,
    private readonly limiter: AuthRateLimiter,
    private readonly delivery: SecureOtpDeliveryPort,
    private readonly securityLog: AuthSecurityLog,
    private readonly tokens: TokenGenerator,
    private readonly clock: OtpClock,
    private readonly hmacPepper: Uint8Array,
  ) {}

  async request(_input: {
    email: string;
    purpose: OtpPurpose;
    trustedIp: string;
    correlationId: string;
  }): Promise<OtpRequestResult> {
    throw new Error("not implemented");
  }

  async verify(_input: {
    challengeId: string;
    email: string;
    purpose: OtpPurpose;
    code: string;
    trustedIp: string;
    correlationId: string;
  }): Promise<OtpVerifyResult> {
    throw new Error("not implemented");
  }
}
