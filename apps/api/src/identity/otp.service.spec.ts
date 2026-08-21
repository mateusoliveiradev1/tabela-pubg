import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type OtpChallengeRecord,
  type OtpRepository,
  OtpService,
  type SecureOtpDeliveryPort,
} from "./otp.service.js";
import type { AuthRateLimiter } from "./ports/auth-rate-limiter.js";
import type { TokenGenerator } from "./ports/token-generator.js";

const now = new Date("2026-08-21T12:00:00.000Z");
const pepper = new TextEncoder().encode("test-pepper-with-enough-entropy");

function hmac(email: string, purpose: string, code: string): string {
  return createHmac("sha256", pepper)
    .update(`${purpose}\0${email.trim().toLowerCase()}\0${code}`, "utf8")
    .digest("hex");
}

function setup(options?: { limiterBlocked?: boolean; limiterUnavailable?: boolean }) {
  const challenges = new Map<string, OtpChallengeRecord & { consumed?: boolean }>();
  const repository: OtpRepository = {
    replace: vi.fn(async (challenge) => {
      for (const stored of challenges.values()) {
        if (
          stored.emailDigest === challenge.emailDigest &&
          stored.purpose === challenge.purpose &&
          stored.consumed !== true
        ) {
          stored.consumed = true;
        }
      }
      challenges.set(challenge.id, { ...challenge });
    }),
    findActive: vi.fn(async (id, purpose) => {
      const found = challenges.get(id);
      return found && found.purpose === purpose && found.consumed !== true ? found : null;
    }),
    recordFailure: vi.fn(async (id) => {
      const found = challenges.get(id);
      if (!found || found.consumed === true || found.attemptsRemaining === 0) {
        return 0;
      }
      found.attemptsRemaining -= 1;
      return found.attemptsRemaining;
    }),
    consumeIfActive: vi.fn(async ({ challengeId, codeDigest, now: consumedAt }) => {
      const found = challenges.get(challengeId);
      if (
        !found ||
        found.consumed === true ||
        found.codeDigest !== codeDigest ||
        found.attemptsRemaining === 0 ||
        found.expiresAt <= consumedAt
      ) {
        return { consumed: false };
      }
      found.consumed = true;
      return { consumed: true };
    }),
  };
  const limiter: AuthRateLimiter = {
    consume: vi.fn(async () => {
      if (options?.limiterUnavailable) {
        throw new Error("redis unavailable");
      }
      return options?.limiterBlocked
        ? { allowed: false as const, retryAfterSeconds: 120 }
        : { allowed: true as const };
    }),
  };
  const delivery: SecureOtpDeliveryPort = {
    enqueue: vi.fn(async () => undefined),
  };
  const securityLog = { record: vi.fn() };
  let sequence = 0;
  const tokens: TokenGenerator = {
    id: vi.fn(() => `id-${++sequence}`),
    opaque: vi.fn(() => "opaque"),
    numericCode: vi.fn(() => "12345678"),
    digest: vi.fn((value) => `digest:${value}`),
  };
  return {
    service: new OtpService(
      repository,
      limiter,
      delivery,
      securityLog,
      tokens,
      { now: () => now },
      pepper,
    ),
    repository,
    limiter,
    delivery,
    securityLog,
    tokens,
    challenges,
  };
}

const request = {
  email: " Player@Example.com ",
  purpose: "sign-in" as const,
  trustedIp: "203.0.113.8",
  correlationId: "corr-1",
};

describe("OtpService", () => {
  it("returns the same public response for every email and queues an eight digit challenge", async () => {
    const first = setup();
    const second = setup();

    const existing = await first.service.request(request);
    const unknown = await second.service.request({ ...request, email: "unknown@example.com" });

    expect(existing.response).toEqual(unknown.response);
    expect(existing.response).toEqual({ status: "accepted", retryAfterSeconds: 60 });
    expect(first.tokens.numericCode).toHaveBeenCalledWith(8);
    expect(first.repository.replace).toHaveBeenCalledWith({
      id: "id-1",
      emailDigest: "digest:player@example.com",
      purpose: "sign-in",
      codeDigest: hmac("player@example.com", "sign-in", "12345678"),
      attemptsRemaining: 5,
      expiresAt: new Date("2026-08-21T12:10:00.000Z"),
    });
    expect(first.delivery.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "id-2",
        challengeId: "id-1",
        recipient: "player@example.com",
        code: "12345678",
      }),
    );
  });

  it("uses only digests for email, trusted IP and combined limiter dimensions", async () => {
    const { service, limiter } = setup();

    await service.request(request);

    expect(limiter.consume).toHaveBeenCalledWith({
      operation: "otp-request",
      now,
      keys: [
        { dimension: "email", digest: "digest:player@example.com" },
        { dimension: "ip", digest: "digest:203.0.113.8" },
        {
          dimension: "email-ip",
          digest: "digest:digest:player@example.com\0digest:203.0.113.8",
        },
        { dimension: "cooldown", digest: "digest:player@example.com" },
      ],
    });
    expect(JSON.stringify(vi.mocked(limiter.consume).mock.calls)).not.toContain(
      "Player@Example.com",
    );
  });

  it("fails closed with a uniform response when limiter blocks or is unavailable", async () => {
    const blocked = setup({ limiterBlocked: true });
    const unavailable = setup({ limiterUnavailable: true });

    const blockedResult = await blocked.service.request(request);
    const unavailableResult = await unavailable.service.request(request);

    expect(blockedResult.response).toEqual(unavailableResult.response);
    expect(blocked.repository.replace).not.toHaveBeenCalled();
    expect(unavailable.repository.replace).not.toHaveBeenCalled();
    expect(blocked.delivery.enqueue).not.toHaveBeenCalled();
    expect(unavailable.securityLog.record).toHaveBeenCalledWith({
      correlationId: "corr-1",
      category: "otp-limiter-unavailable",
    });
    expect(JSON.stringify(unavailable.securityLog.record.mock.calls)).not.toContain("example.com");
  });

  it("supersedes the previous challenge on resend", async () => {
    const { service, challenges } = setup();

    const first = await service.request(request);
    const second = await service.request(request);

    expect(challenges.get(first.challengeId ?? "")?.consumed).toBe(true);
    expect(challenges.get(second.challengeId ?? "")?.consumed).not.toBe(true);
  });

  it("consumes a correct challenge once and rejects replay", async () => {
    const { service } = setup();
    const issued = await service.request(request);
    const input = {
      challengeId: issued.challengeId ?? "",
      email: request.email,
      purpose: request.purpose,
      code: "12345678",
      trustedIp: request.trustedIp,
      correlationId: "corr-verify",
    };

    await expect(service.verify(input)).resolves.toEqual({ status: "authenticated" });
    await expect(service.verify(input)).resolves.toEqual({ status: "rejected" });
  });

  it("rejects expiry and locks the challenge after five wrong attempts", async () => {
    const { service, challenges } = setup();
    const issued = await service.request(request);
    const challenge = challenges.get(issued.challengeId ?? "");
    if (challenge) {
      challenge.expiresAt = new Date("2026-08-21T11:59:59.000Z");
    }
    await expect(
      service.verify({
        challengeId: issued.challengeId ?? "",
        email: request.email,
        purpose: request.purpose,
        code: "12345678",
        trustedIp: request.trustedIp,
        correlationId: "corr-expired",
      }),
    ).resolves.toEqual({ status: "rejected" });

    const fresh = await service.request(request);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.verify({
        challengeId: fresh.challengeId ?? "",
        email: request.email,
        purpose: request.purpose,
        code: "00000000",
        trustedIp: request.trustedIp,
        correlationId: `corr-wrong-${attempt}`,
      });
    }
    await expect(
      service.verify({
        challengeId: fresh.challengeId ?? "",
        email: request.email,
        purpose: request.purpose,
        code: "12345678",
        trustedIp: request.trustedIp,
        correlationId: "corr-after-lock",
      }),
    ).resolves.toEqual({ status: "rejected" });
  });
});
