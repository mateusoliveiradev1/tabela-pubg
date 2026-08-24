import { Injectable } from "@nestjs/common";
import type { SessionTrust } from "./identity.service.js";
import type { TokenGenerator } from "./ports/token-generator.js";

export interface SessionRecord {
  id: string;
  userId: string;
  device: {
    label: string;
    browser: string;
    operatingSystem: string;
    approximateLocation?: string;
  };
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date;
  reauthenticatedAt?: Date;
}

export type SensitiveSessionChange = "identity-link" | "email-change" | "ownership-transfer";

export interface SessionRepositoryPort {
  issue(input: {
    id: string;
    userId: string;
    token: string;
    trust: SessionTrust;
    issuedAt: Date;
    expiresAt?: Date;
  }): Promise<{ sessionId: string }>;
  issueForDevice(input: {
    id: string;
    userId: string;
    token: string;
    alertToken: string;
    deviceFingerprint: string;
    device: SessionRecord["device"] & { summarizedUserAgent?: string };
    issuedAt: Date;
    newDeviceNotification: {
      recipient: string;
      correlationId: string;
    };
  }): Promise<{ sessionId: string; isNewDevice: boolean; notificationScheduled: boolean }>;
  list(userId: string): Promise<readonly SessionRecord[]>;
  revoke(input: { userId: string; sessionId: string; reason: string; now: Date }): Promise<boolean>;
  revokeOthers(input: {
    userId: string;
    preservedSessionId: string;
    reason: string;
    now: Date;
  }): Promise<number>;
  rotate(input: {
    userId: string;
    sessionId: string;
    token: string;
    reauthenticatedAt: Date;
  }): Promise<{ sessionId: string } | null>;
  findForStepUp(userId: string, sessionId: string): Promise<SessionRecord | null>;
  markStepUp(input: {
    userId: string;
    sessionId: string;
    method: "discord" | "email";
    confirmedAt: Date;
  }): Promise<boolean>;
  resolveAlertContextReadOnly(input: {
    actorId: string;
    contextDigest: string;
    now: Date;
  }): Promise<
    | { status: "active"; sessionId: string }
    | { status: "already-revoked"; sessionId: string }
    | { status: "expired" }
    | { status: "not-found" }
  >;
}

export interface SessionClock {
  now(): Date;
}

export interface SessionSummary {
  id: string;
  device: {
    label: string;
    browser: string;
    operatingSystem: string;
  };
  approximateLocation: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  isCurrent: boolean;
  status: "active" | "revoked" | "expired";
}

const STEP_UP_LIFETIME_MS = 10 * 60_000;

@Injectable()
export class SessionService {
  constructor(
    private readonly repository: SessionRepositoryPort,
    private readonly tokens: TokenGenerator,
    private readonly clock: SessionClock,
  ) {}

  async issue(input: {
    userId: string;
    trust: SessionTrust;
    expiresAt?: Date;
  }): Promise<{ sessionId: string; token: string }> {
    const issuedAt = this.clock.now();
    const token = this.tokens.opaque(32);
    const issued = await this.repository.issue({
      id: this.tokens.id(),
      userId: input.userId,
      token,
      trust: input.trust,
      issuedAt,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
    return { ...issued, token };
  }

  async startDeviceSession(input: {
    userId: string;
    deviceFingerprint: string;
    device: SessionRecord["device"] & { summarizedUserAgent?: string };
    newDeviceNotification: { recipient: string; correlationId: string };
  }): Promise<{
    sessionId: string;
    token: string;
    isNewDevice: boolean;
    notificationScheduled: boolean;
  }> {
    const token = this.tokens.opaque(32);
    const issued = await this.repository.issueForDevice({
      id: this.tokens.id(),
      userId: input.userId,
      token,
      alertToken: this.tokens.opaque(32),
      deviceFingerprint: input.deviceFingerprint,
      device: input.device,
      issuedAt: this.clock.now(),
      newDeviceNotification: input.newDeviceNotification,
    });
    return { ...issued, token };
  }

  async list(userId: string, currentSessionId: string): Promise<readonly SessionSummary[]> {
    const sessions = await this.repository.list(userId);
    if (sessions.length === 0) {
      throw new Error("authenticated user has no sessions");
    }
    const now = this.clock.now();
    return sessions.map((session) => ({
      id: session.id,
      device: {
        label: session.device.label,
        browser: session.device.browser,
        operatingSystem: session.device.operatingSystem,
      },
      approximateLocation: session.device.approximateLocation ?? null,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      isCurrent: session.id === currentSessionId,
      status: sessionStatus(session, now),
    }));
  }

  async revoke(userId: string, sessionId: string): Promise<void> {
    const revoked = await this.repository.revoke({
      userId,
      sessionId,
      reason: "user-revoked",
      now: this.clock.now(),
    });
    if (!revoked) {
      throw new Error("session not found");
    }
  }

  async revokeOthers(userId: string, currentSessionId: string): Promise<number> {
    return this.repository.revokeOthers({
      userId,
      preservedSessionId: currentSessionId,
      reason: "user-revoked-others",
      now: this.clock.now(),
    });
  }

  async logout(userId: string, currentSessionId: string): Promise<void> {
    const revoked = await this.repository.revoke({
      userId,
      sessionId: currentSessionId,
      reason: "logout",
      now: this.clock.now(),
    });
    if (!revoked) {
      throw new Error("session not found");
    }
  }

  async hasFreshStepUp(userId: string, sessionId: string, now: Date): Promise<boolean> {
    const session = await this.repository.findForStepUp(userId, sessionId);
    if (
      session === null ||
      session.revokedAt !== undefined ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      session.reauthenticatedAt === undefined
    ) {
      return false;
    }
    const age = now.getTime() - session.reauthenticatedAt.getTime();
    return age >= 0 && age < STEP_UP_LIFETIME_MS;
  }

  async requireFreshStepUp(userId: string, sessionId: string): Promise<void> {
    if (!(await this.hasFreshStepUp(userId, sessionId, this.clock.now()))) {
      throw new Error("recent authentication required");
    }
  }

  requireRecentReauthentication(userId: string, sessionId: string): Promise<void> {
    return this.requireFreshStepUp(userId, sessionId);
  }

  async confirmStepUp(input: {
    userId: string;
    sessionId: string;
    method: "discord" | "email";
    confirmedAt: Date;
  }): Promise<void> {
    if (!(await this.repository.markStepUp(input))) {
      throw new Error("session not found");
    }
  }

  async rotateCurrentAndRevokeOthers(input: {
    userId: string;
    sessionId: string;
    reason: SensitiveSessionChange;
  }): Promise<{ sessionId: string; token: string; otherSessionsRevoked: number }> {
    await this.requireFreshStepUp(input.userId, input.sessionId);
    const token = this.tokens.opaque(32);
    const rotated = await this.repository.rotate({
      userId: input.userId,
      sessionId: input.sessionId,
      token,
      reauthenticatedAt: this.clock.now(),
    });
    if (rotated === null) {
      throw new Error("session not found");
    }
    const otherSessionsRevoked = await this.repository.revokeOthers({
      userId: input.userId,
      preservedSessionId: rotated.sessionId,
      reason: input.reason,
      now: this.clock.now(),
    });
    return { sessionId: rotated.sessionId, token, otherSessionsRevoked };
  }

  async resolveAlertContext(
    actorId: string,
    rawContext: string,
  ): Promise<{ status: "active" | "revoked" | "expired" | "not-found" }> {
    const resolved = await this.repository.resolveAlertContextReadOnly({
      actorId,
      contextDigest: this.tokens.digest(rawContext),
      now: this.clock.now(),
    });
    switch (resolved.status) {
      case "active":
        return { status: "active" };
      case "already-revoked":
        return { status: "revoked" };
      case "expired":
        return { status: "expired" };
      case "not-found":
        return { status: "not-found" };
    }
  }
}

function sessionStatus(session: SessionRecord, now: Date): "active" | "revoked" | "expired" {
  if (session.revokedAt !== undefined) {
    return "revoked";
  }
  if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
    return "expired";
  }
  return "active";
}
