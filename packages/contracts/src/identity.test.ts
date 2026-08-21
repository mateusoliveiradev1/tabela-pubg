import { describe, expect, it } from "vitest";
import {
  EmailOtpRequestSchema,
  EmailOtpResponseSchema,
  IdentityListResponseSchema,
  SessionAlertContextRequestSchema,
  SessionAlertContextResponseSchema,
  SessionListResponseSchema,
  VerifyEmailOtpRequestSchema,
} from "./identity.js";

const sessionId = "018f0ce7-98e3-7b27-bf2d-6eeac51d2311";

describe("identity contracts", () => {
  it("accepts an email OTP request and returns a uniform response", () => {
    expect(EmailOtpRequestSchema.safeParse({ email: "organizador@example.com" }).success).toBe(
      true,
    );

    const existingAccount = EmailOtpResponseSchema.parse({
      status: "accepted",
      retryAfterSeconds: 60,
    });
    const unknownAccount = EmailOtpResponseSchema.parse({
      status: "accepted",
      retryAfterSeconds: 60,
    });

    expect(existingAccount).toEqual(unknownAccount);
    expect(
      EmailOtpResponseSchema.safeParse({
        status: "accepted",
        retryAfterSeconds: 60,
        accountExists: true,
      }).success,
    ).toBe(false);
  });

  it("binds OTP verification to the normalized email supplied by the browser", () => {
    expect(
      VerifyEmailOtpRequestSchema.safeParse({
        challengeId: sessionId,
        email: "Organizer@Example.com",
        code: "12345678",
        purpose: "sign-in",
      }).success,
    ).toBe(true);
    expect(
      VerifyEmailOtpRequestSchema.safeParse({
        challengeId: sessionId,
        code: "12345678",
        purpose: "sign-in",
      }).success,
    ).toBe(false);
  });

  it("exposes only public, approximate session data", () => {
    const result = SessionListResponseSchema.safeParse({
      sessions: [
        {
          id: sessionId,
          device: {
            label: "Chrome no Windows",
            browser: "Chrome",
            operatingSystem: "Windows",
          },
          approximateLocation: "São Paulo, BR",
          createdAt: "2026-08-20T12:00:00.000Z",
          lastSeenAt: "2026-08-20T12:05:00.000Z",
          idleExpiresAt: "2026-09-19T12:05:00.000Z",
          absoluteExpiresAt: "2026-11-18T12:00:00.000Z",
          isCurrent: true,
          status: "active",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(
      SessionListResponseSchema.safeParse({
        sessions: [
          {
            id: sessionId,
            device: {
              label: "Chrome no Windows",
              browser: "Chrome",
              operatingSystem: "Windows",
              fingerprint: "private-fingerprint",
            },
            approximateLocation: "São Paulo, BR",
            createdAt: "2026-08-20T12:00:00.000Z",
            lastSeenAt: "2026-08-20T12:05:00.000Z",
            idleExpiresAt: "2026-09-19T12:05:00.000Z",
            absoluteExpiresAt: "2026-11-18T12:00:00.000Z",
            isCurrent: true,
            status: "active",
            tokenDigest: "private-digest",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps the opaque alert context only in the server-side request", () => {
    expect(
      SessionAlertContextRequestSchema.safeParse({ context: "opaque-alert-context" }).success,
    ).toBe(true);

    for (const status of ["active", "revoked", "expired", "not-found"] as const) {
      const result = SessionAlertContextResponseSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }

    expect(
      SessionAlertContextResponseSchema.safeParse({
        status: "active",
        sessionId,
        context: "opaque-alert-context",
      }).success,
    ).toBe(false);
  });

  it("rejects secret-bearing identity outputs", () => {
    const result = IdentityListResponseSchema.safeParse({
      identities: [
        {
          id: "018f0ce7-98e3-7b27-bf2d-6eeac51d2312",
          provider: "discord",
          status: "verified",
          displayIdentifier: "mateus",
          linkedAt: "2026-08-20T12:00:00.000Z",
          providerToken: "should-never-leave-the-server",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
