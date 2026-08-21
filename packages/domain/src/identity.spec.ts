import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AuditEventId,
  type AuthorizationScopeId,
  createInvitationValidity,
  createOtpChallenge,
  createSessionValidity,
  type DeviceId,
  evaluateSessionValidity,
  type IdentityId,
  type InvitationId,
  isInvitationExpired,
  isOtpChallengeExpired,
  isStepUpFresh,
  type MembershipId,
  type SessionId,
  type UserId,
} from "./identity.js";

const fixedNow = new Date("2026-08-20T12:00:00.000Z");
const clock = { now: () => fixedNow };

describe("identity identifiers", () => {
  it("keeps every identity identifier nominally distinct", () => {
    expectTypeOf<UserId>().not.toEqualTypeOf<IdentityId>();
    expectTypeOf<SessionId>().not.toEqualTypeOf<DeviceId>();
    expectTypeOf<MembershipId>().not.toEqualTypeOf<InvitationId>();
    expectTypeOf<AuthorizationScopeId>().not.toEqualTypeOf<AuditEventId>();
  });
});

describe("identity temporal policies", () => {
  it("creates an eight-digit OTP challenge valid for ten minutes and five attempts", () => {
    const challenge = createOtpChallenge(clock);

    expect(challenge).toEqual({
      issuedAt: fixedNow,
      expiresAt: new Date("2026-08-20T12:10:00.000Z"),
      codeLength: 8,
      attemptsRemaining: 5,
    });
    expect(isOtpChallengeExpired(challenge, clock)).toBe(false);
    expect(
      isOtpChallengeExpired(challenge, {
        now: () => new Date("2026-08-20T12:10:00.000Z"),
      }),
    ).toBe(true);
  });

  it("creates invitations that expire after seven days", () => {
    const invitation = createInvitationValidity(clock);

    expect(invitation.expiresAt).toEqual(new Date("2026-08-27T12:00:00.000Z"));
    expect(isInvitationExpired(invitation, clock)).toBe(false);
    expect(
      isInvitationExpired(invitation, {
        now: () => new Date("2026-08-27T12:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("accepts step-up only during the ten-minute window", () => {
    expect(isStepUpFresh(new Date("2026-08-20T11:50:00.001Z"), clock)).toBe(true);
    expect(isStepUpFresh(new Date("2026-08-20T11:50:00.000Z"), clock)).toBe(false);
    expect(isStepUpFresh(new Date("2026-08-20T12:00:00.001Z"), clock)).toBe(false);
    expect(isStepUpFresh(null, clock)).toBe(false);
  });

  it("enforces a 30-day idle timeout and a 90-day absolute ceiling", () => {
    const validity = createSessionValidity(clock);

    expect(validity.idleExpiresAt).toEqual(new Date("2026-09-19T12:00:00.000Z"));
    expect(validity.absoluteExpiresAt).toEqual(new Date("2026-11-18T12:00:00.000Z"));
    expect(evaluateSessionValidity(validity, clock)).toBe("active");
    expect(
      evaluateSessionValidity(validity, {
        now: () => new Date("2026-09-19T12:00:00.000Z"),
      }),
    ).toBe("idle-expired");
    expect(
      evaluateSessionValidity(validity, {
        now: () => new Date("2026-11-18T12:00:00.000Z"),
      }),
    ).toBe("absolute-expired");
  });
});
