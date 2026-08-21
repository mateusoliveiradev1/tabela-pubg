import { createHmac, timingSafeEqual } from "node:crypto";
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

const OTP_CODE_LENGTH = 8;
const OTP_ATTEMPTS = 5;
const OTP_LIFETIME_MS = 10 * 60_000;
const STEP_UP_LIFETIME_MS = 10 * 60_000;
const ACCEPTED_RESPONSE = { status: "accepted", retryAfterSeconds: 60 } as const;

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

  async request(input: {
    email: string;
    purpose: OtpPurpose;
    trustedIp: string;
    correlationId: string;
  }): Promise<OtpRequestResult> {
    const normalizedEmail = normalizeEmail(input.email);
    const emailDigest = this.tokens.digest(normalizedEmail);
    const decision = await this.consumeLimit(
      "otp-request",
      emailDigest,
      input.trustedIp,
      input.correlationId,
    );
    if (!decision) {
      return { response: ACCEPTED_RESPONSE };
    }

    const code = this.tokens.numericCode(OTP_CODE_LENGTH);
    if (!/^\d{8}$/.test(code)) {
      throw new Error("token generator returned an invalid OTP");
    }
    const challengeId = this.tokens.id();
    const expiresAt = new Date(this.clock.now().getTime() + OTP_LIFETIME_MS);
    await this.repository.replace({
      id: challengeId,
      emailDigest,
      purpose: input.purpose,
      codeDigest: this.codeDigest(normalizedEmail, input.purpose, code),
      attemptsRemaining: OTP_ATTEMPTS,
      expiresAt,
    });
    await this.delivery.enqueue({
      deliveryId: this.tokens.id(),
      challengeId,
      recipient: normalizedEmail,
      code,
      expiresAt,
      correlationId: input.correlationId,
    });
    return { response: ACCEPTED_RESPONSE, challengeId };
  }

  async verify(input: {
    challengeId: string;
    email: string;
    purpose: OtpPurpose;
    code: string;
    trustedIp: string;
    correlationId: string;
  }): Promise<OtpVerifyResult> {
    const normalizedEmail = normalizeEmail(input.email);
    const emailDigest = this.tokens.digest(normalizedEmail);
    if (
      !(await this.consumeLimit("otp-verify", emailDigest, input.trustedIp, input.correlationId))
    ) {
      return { status: "rejected" };
    }

    const challenge = await this.repository.findActive(input.challengeId, input.purpose);
    const now = this.clock.now();
    if (
      challenge === null ||
      challenge.emailDigest !== emailDigest ||
      challenge.attemptsRemaining <= 0 ||
      challenge.expiresAt <= now
    ) {
      this.invalid(input.correlationId);
      return { status: "rejected" };
    }

    const candidateDigest = this.codeDigest(normalizedEmail, input.purpose, input.code);
    if (!safeEqualHex(challenge.codeDigest, candidateDigest)) {
      await this.repository.recordFailure(challenge.id, now);
      this.invalid(input.correlationId);
      return { status: "rejected" };
    }

    const consumed = await this.repository.consumeIfActive({
      challengeId: challenge.id,
      codeDigest: candidateDigest,
      now,
    });
    if (!consumed.consumed) {
      this.invalid(input.correlationId);
      return { status: "rejected" };
    }

    switch (input.purpose) {
      case "sign-in":
        return { status: "authenticated" };
      case "link-email":
        return { status: "identity-link-ready" };
      case "change-email":
        return { status: "email-change-ready" };
      case "step-up":
        return {
          status: "step-up-confirmed",
          validUntil: new Date(now.getTime() + STEP_UP_LIFETIME_MS),
        };
    }
  }

  private async consumeLimit(
    operation: "otp-request" | "otp-verify",
    emailDigest: string,
    trustedIp: string,
    correlationId: string,
  ): Promise<boolean> {
    const ipDigest = this.tokens.digest(trustedIp);
    try {
      const decision = await this.limiter.consume({
        operation,
        now: this.clock.now(),
        keys: [
          { dimension: "email", digest: emailDigest },
          { dimension: "ip", digest: ipDigest },
          {
            dimension: "email-ip",
            digest: this.tokens.digest(`${emailDigest}\0${ipDigest}`),
          },
          ...(operation === "otp-request"
            ? [{ dimension: "cooldown" as const, digest: emailDigest }]
            : []),
        ],
      });
      if (!decision.allowed) {
        this.securityLog.record({
          correlationId,
          category: operation === "otp-request" ? "otp-request-limited" : "otp-verify-limited",
        });
        return false;
      }
      return true;
    } catch {
      this.securityLog.record({ correlationId, category: "otp-limiter-unavailable" });
      return false;
    }
  }

  private codeDigest(email: string, purpose: OtpPurpose, code: string): string {
    return createHmac("sha256", this.hmacPepper)
      .update(`${purpose}\0${email}\0${code}`, "utf8")
      .digest("hex");
  }

  private invalid(correlationId: string): void {
    this.securityLog.record({ correlationId, category: "otp-invalid" });
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeEqualHex(expected: string, candidate: string): boolean {
  const expectedBytes = Buffer.from(expected, "hex");
  const candidateBytes = Buffer.from(candidate, "hex");
  return (
    expectedBytes.byteLength === candidateBytes.byteLength &&
    timingSafeEqual(expectedBytes, candidateBytes)
  );
}
