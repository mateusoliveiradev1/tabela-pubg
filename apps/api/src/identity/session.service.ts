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
  revoke(input: {
    userId: string;
    sessionId: string;
    reason: string;
    now: Date;
  }): Promise<boolean>;
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

@Injectable()
export class SessionService {
  constructor(
    private readonly repository: SessionRepositoryPort,
    private readonly tokens: TokenGenerator,
    private readonly clock: SessionClock,
  ) {}

  async issue(_input: {
    userId: string;
    trust: SessionTrust;
    expiresAt?: Date;
  }): Promise<{ sessionId: string }> {
    throw new Error("not implemented");
  }

  async startDeviceSession(_input: {
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
    throw new Error("not implemented");
  }

  async list(_userId: string, _currentSessionId: string): Promise<readonly SessionSummary[]> {
    throw new Error("not implemented");
  }

  async revoke(_userId: string, _sessionId: string): Promise<void> {
    throw new Error("not implemented");
  }

  async revokeOthers(_userId: string, _currentSessionId: string): Promise<number> {
    throw new Error("not implemented");
  }

  async logout(_userId: string, _currentSessionId: string): Promise<void> {
    throw new Error("not implemented");
  }

  async hasFreshStepUp(_userId: string, _sessionId: string, _now: Date): Promise<boolean> {
    throw new Error("not implemented");
  }

  async requireFreshStepUp(_userId: string, _sessionId: string): Promise<void> {
    throw new Error("not implemented");
  }

  async confirmStepUp(_input: {
    userId: string;
    sessionId: string;
    method: "discord" | "email";
    confirmedAt: Date;
  }): Promise<void> {
    throw new Error("not implemented");
  }

  async rotateCurrentAndRevokeOthers(_input: {
    userId: string;
    sessionId: string;
    reason: SensitiveSessionChange;
  }): Promise<{ sessionId: string; otherSessionsRevoked: number }> {
    throw new Error("not implemented");
  }

  async resolveAlertContext(
    _actorId: string,
    _rawContext: string,
  ): Promise<{ status: "active" | "revoked" | "expired" | "not-found" }> {
    throw new Error("not implemented");
  }
}
