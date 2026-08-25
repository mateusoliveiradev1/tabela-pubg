import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type OtpChallengeRecord,
  type OtpDeliveryRequest,
  type OtpRepository,
  OtpService,
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
  const delivery = { enqueue: vi.fn(async (_input: OtpDeliveryRequest) => undefined) };
  const repository: OtpRepository = {
    replaceAndEnqueue: vi.fn(async ({ challenge, delivery: request }) => {
      for (const stored of challenges.values()) {
        if (
          stored.emailDigest === challenge.emailDigest &&
          stored.purpose === challenge.purpose &&
          stored.actorId === challenge.actorId &&
          stored.sessionId === challenge.sessionId &&
          stored.consumed !== true
        ) {
          stored.consumed = true;
        }
      }
      challenges.set(challenge.id, { ...challenge });
      await delivery.enqueue(request);
    }),
    findActive: vi.fn(async (input) => {
      const found = challenges.get(input.challengeId);
      return found &&
        found.purpose === input.purpose &&
        found.actorId === input.actorId &&
        found.sessionId === input.sessionId &&
        found.consumed !== true
        ? found
        : null;
    }),
    recordFailure: vi.fn(async (input) => {
      const found = challenges.get(input.challengeId);
      if (
        !found ||
        found.consumed === true ||
        found.actorId !== input.actorId ||
        found.sessionId !== input.sessionId ||
        found.attemptsRemaining === 0
      ) {
        return 0;
      }
      found.attemptsRemaining -= 1;
      return found.attemptsRemaining;
    }),
    complete: vi.fn(async (input) => {
      const found = challenges.get(input.challengeId);
      if (
        !found ||
        found.consumed === true ||
        found.codeDigest !== input.codeDigest ||
        found.actorId !== input.actorId ||
        found.sessionId !== input.sessionId
      ) {
        return { status: "rejected" } as const;
      }
      found.consumed = true;
      switch (input.purpose) {
        case "sign-in":
          return { status: "authenticated", userId: "email-user" } as const;
        case "link-email":
          return {
            status: "identity-link-ready",
            proofId: input.proofId,
            actorId: input.actorId ?? "",
            sessionId: input.sessionId ?? "",
          } as const;
        case "change-email":
          return {
            status: "email-change-ready",
            proofId: input.proofId,
            actorId: input.actorId ?? "",
            sessionId: input.sessionId ?? "",
          } as const;
        case "step-up":
          return {
            status: "step-up-confirmed",
            actorId: input.actorId ?? "",
            sessionId: input.sessionId ?? "",
            confirmedAt: input.now,
          } as const;
        case "verify-provisional-email":
          return {
            status: "provisional-email-verified",
            userId: input.actorId ?? "",
            sessionId: input.sessionId ?? "",
            sessionToken: input.replacementSessionToken,
            trust: "trusted",
          } as const;
        default:
          return { status: "rejected" } as const;
      }
    }),
  };
  const limiter: AuthRateLimiter = {
    consume: vi.fn(async () => {
      if (options?.limiterUnavailable) throw new Error("redis unavailable");
      return options?.limiterBlocked
        ? { allowed: false as const, retryAfterSeconds: 120 }
        : { allowed: true as const };
    }),
  };
  const securityLog = { record: vi.fn() };
  let sequence = 0;
  const tokens: TokenGenerator = {
    id: vi.fn(() => `id-${++sequence}`),
    opaque: vi.fn(() => "replacement-session-token"),
    numericCode: vi.fn(() => "12345678"),
    digest: vi.fn((value) => `digest:${value}`),
  };
  return {
    service: new OtpService(
      repository,
      limiter,
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

const publicRequest = {
  email: " Player@Example.com ",
  purpose: "sign-in" as const,
  trustedIp: "203.0.113.8",
  correlationId: "corr-1",
};
const binding = { actorId: "actor-1", sessionId: "session-1" };

describe("OtpService", () => {
  it("keeps sign-in unbound and persists server-derived binding for protected purposes", async () => {
    const { service, repository } = setup();

    await service.request(publicRequest);
    await service.request({ ...publicRequest, purpose: "step-up", ...binding });

    expect(repository.replaceAndEnqueue).toHaveBeenNthCalledWith(1, {
      challenge: {
        id: "id-1",
        emailDigest: "digest:player@example.com",
        purpose: "sign-in",
        codeDigest: hmac("player@example.com", "sign-in", "12345678"),
        attemptsRemaining: 5,
        expiresAt: new Date("2026-08-21T12:10:00.000Z"),
      },
      delivery: expect.objectContaining({ challengeId: "id-1", deliveryId: "id-2" }),
    });
    expect(repository.replaceAndEnqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        challenge: expect.objectContaining({ purpose: "step-up", ...binding }),
      }),
    );
  });

  it("fails closed without persistence when a protected request lacks actor/session", async () => {
    const { service, repository, delivery } = setup();

    await expect(service.request({ ...publicRequest, purpose: "link-email" })).resolves.toEqual({
      response: { status: "accepted", retryAfterSeconds: 60 },
    });
    expect(repository.replaceAndEnqueue).not.toHaveBeenCalled();
    expect(delivery.enqueue).not.toHaveBeenCalled();
  });

  it("returns a private email account result for sign-in and rejects replay", async () => {
    const { service } = setup();
    const issued = await service.request(publicRequest);
    const input = {
      challengeId: issued.challengeId ?? "",
      email: publicRequest.email,
      purpose: "sign-in" as const,
      code: "12345678",
      trustedIp: publicRequest.trustedIp,
      correlationId: "corr-verify",
    };

    await expect(service.verify(input)).resolves.toEqual({
      status: "authenticated",
      userId: "email-user",
    });
    await expect(service.verify(input)).resolves.toEqual({ status: "rejected" });
  });

  it("returns purpose-specific bound proof and persisted step-up results", async () => {
    for (const purpose of ["link-email", "change-email", "step-up"] as const) {
      const { service } = setup();
      const issued = await service.request({ ...publicRequest, purpose, ...binding });
      const result = await service.verify({
        challengeId: issued.challengeId ?? "",
        email: publicRequest.email,
        purpose,
        code: "12345678",
        trustedIp: publicRequest.trustedIp,
        correlationId: `corr-${purpose}`,
        ...binding,
      });

      expect(result).toMatchObject(
        purpose === "step-up"
          ? { status: "step-up-confirmed", ...binding, confirmedAt: now }
          : {
              status: purpose === "link-email" ? "identity-link-ready" : "email-change-ready",
              ...binding,
            },
      );
    }
  });

  it("promotes only the bound provisional session and returns its replacement token", async () => {
    const { service, tokens } = setup();
    const purpose = "verify-provisional-email" as const;
    const issued = await service.request({ ...publicRequest, purpose, ...binding });

    await expect(
      service.verify({
        challengeId: issued.challengeId ?? "",
        email: publicRequest.email,
        purpose,
        code: "12345678",
        trustedIp: publicRequest.trustedIp,
        correlationId: "corr-promote",
        ...binding,
      }),
    ).resolves.toEqual({
      status: "provisional-email-verified",
      userId: binding.actorId,
      sessionId: binding.sessionId,
      sessionToken: "replacement-session-token",
      trust: "trusted",
    });
    expect(tokens.opaque).toHaveBeenCalledWith(32);
  });

  it("does not consume or decrement a challenge for the wrong actor/session", async () => {
    const { service, repository } = setup();
    const issued = await service.request({ ...publicRequest, purpose: "step-up", ...binding });

    await expect(
      service.verify({
        challengeId: issued.challengeId ?? "",
        email: publicRequest.email,
        purpose: "step-up",
        code: "12345678",
        trustedIp: publicRequest.trustedIp,
        correlationId: "corr-cross-session",
        actorId: binding.actorId,
        sessionId: "session-2",
      }),
    ).resolves.toEqual({ status: "rejected" });

    expect(repository.recordFailure).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    await expect(
      service.verify({
        challengeId: issued.challengeId ?? "",
        email: publicRequest.email,
        purpose: "step-up",
        code: "12345678",
        trustedIp: publicRequest.trustedIp,
        correlationId: "corr-owner",
        ...binding,
      }),
    ).resolves.toMatchObject({ status: "step-up-confirmed", ...binding });
  });

  it("uses only digests for limiter dimensions and keeps public responses uniform", async () => {
    const allowed = setup();
    const blocked = setup({ limiterBlocked: true });
    const unavailable = setup({ limiterUnavailable: true });

    const accepted = await allowed.service.request(publicRequest);
    const blockedResult = await blocked.service.request(publicRequest);
    const unavailableResult = await unavailable.service.request(publicRequest);

    expect(accepted.response).toEqual(blockedResult.response);
    expect(blockedResult.response).toEqual(unavailableResult.response);
    expect(allowed.limiter.consume).toHaveBeenCalledWith({
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
    expect(blocked.repository.replaceAndEnqueue).not.toHaveBeenCalled();
    expect(unavailable.repository.replaceAndEnqueue).not.toHaveBeenCalled();
    expect(JSON.stringify(unavailable.securityLog.record.mock.calls)).not.toContain("example.com");
  });

  it("expires and locks a challenge after five wrong attempts", async () => {
    const { service, challenges } = setup();
    const issued = await service.request(publicRequest);
    const challenge = challenges.get(issued.challengeId ?? "");
    if (challenge) challenge.expiresAt = new Date("2026-08-21T11:59:59.000Z");

    await expect(
      service.verify({
        challengeId: issued.challengeId ?? "",
        email: publicRequest.email,
        purpose: "sign-in",
        code: "12345678",
        trustedIp: publicRequest.trustedIp,
        correlationId: "corr-expired",
      }),
    ).resolves.toEqual({ status: "rejected" });

    const fresh = await service.request(publicRequest);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.verify({
        challengeId: fresh.challengeId ?? "",
        email: publicRequest.email,
        purpose: "sign-in",
        code: "00000000",
        trustedIp: publicRequest.trustedIp,
        correlationId: `corr-wrong-${attempt}`,
      });
    }
    await expect(
      service.verify({
        challengeId: fresh.challengeId ?? "",
        email: publicRequest.email,
        purpose: "sign-in",
        code: "12345678",
        trustedIp: publicRequest.trustedIp,
        correlationId: "corr-after-lock",
      }),
    ).resolves.toEqual({ status: "rejected" });
  });
});
