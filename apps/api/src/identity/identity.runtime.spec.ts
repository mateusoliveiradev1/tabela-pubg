import { describe, expect, it, vi } from "vitest";
import {
  buildIdentitySecurityChangeApplication,
  buildOtpNotificationDelivery,
  projectOAuthTransaction,
} from "./identity.runtime.js";

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
});
