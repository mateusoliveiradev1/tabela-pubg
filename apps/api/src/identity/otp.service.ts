import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { AuthRateLimiter } from "./ports/auth-rate-limiter.js";
import type { TokenGenerator } from "./ports/token-generator.js";

export type OtpPurpose =
  | "sign-in"
  | "link-email"
  | "change-email"
  | "step-up"
  | "verify-provisional-email";

export interface OtpChallengeRecord {
  id: string;
  emailDigest: string;
  purpose: OtpPurpose;
  codeDigest: string;
  attemptsRemaining: number;
  expiresAt: Date;
  actorId?: string;
  sessionId?: string;
}

export interface OtpChallengeBinding {
  actorId?: string;
  sessionId?: string;
}

export interface CompleteOtpInput extends OtpChallengeBinding {
  challengeId: string;
  email: string;
  purpose: OtpPurpose;
  codeDigest: string;
  now: Date;
  ids: {
    userId: string;
    identityId: string;
    verifiedEmailId: string;
    proofId: string;
  };
  replacementSessionToken?: string;
}

export type OtpCompletionResult =
  | { status: "authenticated"; userId: string }
  | { status: "identity-link-ready"; proofId: string; actorId: string; sessionId: string }
  | { status: "email-change-ready"; proofId: string; actorId: string; sessionId: string }
  | {
      status: "step-up-confirmed";
      actorId: string;
      sessionId: string;
      confirmedAt: Date;
    }
  | {
      status: "provisional-email-verified";
      userId: string;
      sessionId: string;
      sessionToken: string;
      trust: "trusted";
    }
  | { status: "rejected" };

export interface OtpRepository {
  replace(challenge: OtpChallengeRecord): Promise<void>;
  findActive(input: {
    challengeId: string;
    purpose: OtpPurpose;
    actorId?: string;
    sessionId?: string;
  }): Promise<OtpChallengeRecord | null>;
  recordFailure(input: {
    challengeId: string;
    purpose: OtpPurpose;
    actorId?: string;
    sessionId?: string;
    now: Date;
  }): Promise<number>;
  complete(input: CompleteOtpInput): Promise<OtpCompletionResult>;
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
  | Exclude<OtpCompletionResult, { status: "step-up-confirmed" } | { status: "rejected" }>
  | {
      status: "step-up-confirmed";
      actorId: string;
      sessionId: string;
      confirmedAt: Date;
      validUntil: Date;
    }
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
    actorId?: string;
    sessionId?: string;
  }): Promise<OtpRequestResult> {
    if (!hasValidPurposeBinding(input)) {
      return { response: ACCEPTED_RESPONSE };
    }
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
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
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
    actorId?: string;
    sessionId?: string;
  }): Promise<OtpVerifyResult> {
    if (!hasValidPurposeBinding(input)) {
      this.invalid(input.correlationId);
      return { status: "rejected" };
    }
    const normalizedEmail = normalizeEmail(input.email);
    const emailDigest = this.tokens.digest(normalizedEmail);
    if (
      !(await this.consumeLimit("otp-verify", emailDigest, input.trustedIp, input.correlationId))
    ) {
      return { status: "rejected" };
    }

    const challenge = await this.repository.findActive({
      challengeId: input.challengeId,
      purpose: input.purpose,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    });
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
      await this.repository.recordFailure({
        challengeId: challenge.id,
        purpose: input.purpose,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        now,
      });
      this.invalid(input.correlationId);
      return { status: "rejected" };
    }

    const completed = await this.repository.complete({
      challengeId: challenge.id,
      email: normalizedEmail,
      purpose: input.purpose,
      codeDigest: candidateDigest,
      now,
      ids: {
        userId: this.tokens.id(),
        identityId: this.tokens.id(),
        verifiedEmailId: this.tokens.id(),
        proofId: this.tokens.id(),
      },
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.purpose === "verify-provisional-email"
        ? { replacementSessionToken: this.tokens.opaque(32) }
        : {}),
    });
    if (completed.status === "rejected") {
      this.invalid(input.correlationId);
      return { status: "rejected" };
    }
    if (completed.status === "step-up-confirmed") {
      return {
        ...completed,
        validUntil: new Date(completed.confirmedAt.getTime() + STEP_UP_LIFETIME_MS),
      };
    }
    return completed;
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

function hasValidPurposeBinding(input: OtpChallengeBinding & { purpose: OtpPurpose }): boolean {
  return input.purpose === "sign-in"
    ? input.actorId === undefined && input.sessionId === undefined
    : Boolean(input.actorId && input.sessionId);
}
