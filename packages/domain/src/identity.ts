import type { Brand, Clock } from "./index.js";

const MINUTE_IN_MS = 60 * 1_000;
const DAY_IN_MS = 24 * 60 * MINUTE_IN_MS;

export const OTP_CODE_LENGTH = 8;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LIFETIME_MS = 10 * MINUTE_IN_MS;
export const INVITATION_LIFETIME_MS = 7 * DAY_IN_MS;
export const STEP_UP_LIFETIME_MS = 10 * MINUTE_IN_MS;
export const SESSION_IDLE_LIFETIME_MS = 30 * DAY_IN_MS;
export const SESSION_ABSOLUTE_LIFETIME_MS = 90 * DAY_IN_MS;

export type UserId = Brand<string, "UserId">;
export type IdentityId = Brand<string, "IdentityId">;
export type SessionId = Brand<string, "SessionId">;
export type DeviceId = Brand<string, "DeviceId">;
export type MembershipId = Brand<string, "MembershipId">;
export type InvitationId = Brand<string, "InvitationId">;
export type AuthorizationScopeId = Brand<string, "AuthorizationScopeId">;
export type AuditEventId = Brand<string, "AuditEventId">;

export type UserStatus = "active" | "suspended";
export type IdentityProvider = "discord" | "email";
export type IdentityStatus = "pending" | "verified" | "revoked";
export type SessionStatus = "active" | "revoked";

export interface OtpChallengePolicy {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly codeLength: typeof OTP_CODE_LENGTH;
  readonly attemptsRemaining: typeof OTP_MAX_ATTEMPTS;
}

export interface InvitationValidity {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface SessionValidity {
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export type SessionValidityState = "active" | "idle-expired" | "absolute-expired";

function expiresAfter(now: Date, lifetimeMs: number): Date {
  return new Date(now.getTime() + lifetimeMs);
}

export function createOtpChallenge(clock: Clock): OtpChallengePolicy {
  const issuedAt = clock.now();

  return {
    issuedAt,
    expiresAt: expiresAfter(issuedAt, OTP_LIFETIME_MS),
    codeLength: OTP_CODE_LENGTH,
    attemptsRemaining: OTP_MAX_ATTEMPTS,
  };
}

export function isOtpChallengeExpired(
  challenge: Pick<OtpChallengePolicy, "expiresAt">,
  clock: Clock,
): boolean {
  return clock.now().getTime() >= challenge.expiresAt.getTime();
}

export function createInvitationValidity(clock: Clock): InvitationValidity {
  const issuedAt = clock.now();

  return {
    issuedAt,
    expiresAt: expiresAfter(issuedAt, INVITATION_LIFETIME_MS),
  };
}

export function isInvitationExpired(
  invitation: Pick<InvitationValidity, "expiresAt">,
  clock: Clock,
): boolean {
  return clock.now().getTime() >= invitation.expiresAt.getTime();
}

export function isStepUpFresh(performedAt: Date | null, clock: Clock): boolean {
  if (performedAt === null) {
    return false;
  }

  const ageMs = clock.now().getTime() - performedAt.getTime();
  return ageMs >= 0 && ageMs < STEP_UP_LIFETIME_MS;
}

export function createSessionValidity(clock: Clock): SessionValidity {
  const createdAt = clock.now();

  return {
    createdAt,
    lastSeenAt: createdAt,
    idleExpiresAt: expiresAfter(createdAt, SESSION_IDLE_LIFETIME_MS),
    absoluteExpiresAt: expiresAfter(createdAt, SESSION_ABSOLUTE_LIFETIME_MS),
  };
}

export function evaluateSessionValidity(
  validity: Pick<SessionValidity, "idleExpiresAt" | "absoluteExpiresAt">,
  clock: Clock,
): SessionValidityState {
  const now = clock.now().getTime();

  if (now >= validity.absoluteExpiresAt.getTime()) {
    return "absolute-expired";
  }

  if (now >= validity.idleExpiresAt.getTime()) {
    return "idle-expired";
  }

  return "active";
}
