import { HttpException, Injectable } from "@nestjs/common";
import type { DiscordUserProfile } from "./ports/discord-identity-provider.js";
import type { TokenGenerator } from "./ports/token-generator.js";

export type SessionTrust = "provisional" | "trusted";

export class ReauthenticationRequiredException extends HttpException {
  constructor() {
    super({ status: "reauthentication-required" }, 428);
  }
}

export interface IdentityRepository {
  findDiscordIdentity(subject: string): Promise<{ userId: string; emailVerified: boolean } | null>;
  createDiscordAccount(input: {
    identityId: string;
    userId: string;
    subject: string;
    displayName: string;
    verifiedEmail?: string;
  }): Promise<{ status: "created"; userId: string } | { status: "conflict" }>;
  link(input: {
    identityId: string;
    userId: string;
    provider: "discord" | "email";
    subject: string;
    displayName?: string;
    verifiedAt: Date;
  }): Promise<{ status: "linked" } | { status: "conflict" }>;
  listForUser(userId: string): Promise<readonly IdentityManagementSummary[]>;
  findPendingLinkForSession(input: {
    actorId: string;
    sessionId: string;
    now: Date;
  }): Promise<{ id: string; provider: "discord"; displayIdentifier: string } | null>;
  findPendingLink(input: {
    actorId: string;
    sessionId: string;
    proofId: string;
    now: Date;
  }): Promise<PendingIdentityLink | null>;
  removeOwned(input: {
    actorId: string;
    currentSessionId: string;
    identityId: string;
    replacementSessionToken: string;
    now: Date;
  }): Promise<
    | { status: "removed"; sessionId: string; otherSessionsRevoked: number }
    | { status: "not-found" }
    | { status: "last-verified" }
  >;
}

export interface IdentityManagementSummary {
  id: string;
  provider: "discord" | "email";
  status: "pending" | "verified" | "revoked";
  displayIdentifier: string;
  linkedAt: Date;
}

export interface PendingIdentityLink {
  proofId: string;
  provider: "discord";
  providerSubject: string;
  displayName?: string;
}

export interface IdentitySessionPort {
  issue(input: {
    userId: string;
    trust: SessionTrust;
    expiresAt?: Date;
  }): Promise<{ sessionId: string; token: string }>;
  startDeviceSession(input: {
    userId: string;
    trust: SessionTrust;
    deviceFingerprint: string;
    device: {
      label: string;
      browser: string;
      operatingSystem: string;
      approximateLocation?: string;
      summarizedUserAgent?: string;
    };
    newDeviceNotification: { recipient: string; correlationId: string };
  }): Promise<{
    sessionId: string;
    token: string;
    isNewDevice: boolean;
    notificationScheduled: boolean;
  }>;
  hasFreshStepUp(userId: string, sessionId: string, now: Date): Promise<boolean>;
  rotateCurrentAndRevokeOthers(input: {
    userId: string;
    sessionId: string;
    reason: "identity-link" | "email-change";
  }): Promise<{ sessionId: string; token: string; otherSessionsRevoked: number }>;
  confirmStepUp(input: {
    userId: string;
    sessionId: string;
    method: "discord" | "email";
    confirmedAt: Date;
  }): Promise<void>;
}

export interface IdentitySecurityChangeApplicationPort {
  execute(input: {
    actorId: string;
    currentSessionId: string;
    proofId: string;
    change:
      | {
          type: "link-identity";
          provider: "discord";
          providerSubject: string;
          displayName?: string;
        }
      | { type: "link-identity"; provider: "email"; email: string }
      | { type: "change-email"; identityId: string; email: string };
    now: Date;
    correlationId: string;
  }): Promise<{
    sessionId: string;
    sessionToken: string;
    otherSessionsRevoked: number;
  }>;
}

export interface Clock {
  now(): Date;
}

export interface DiscordSignInResult {
  status: "authenticated";
  userId: string;
  sessionId: string;
  sessionToken: string;
  trust: SessionTrust;
}

const PROVISIONAL_SESSION_LIFETIME_MS = 15 * 60_000;

function normalizeUsableEmail(profile: DiscordUserProfile): string | undefined {
  if (!profile.emailVerified || profile.email === undefined) {
    return undefined;
  }

  const normalized = profile.email.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

@Injectable()
export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly sessions: IdentitySessionPort,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
    private readonly securityChanges: IdentitySecurityChangeApplicationPort,
  ) {}

  async startEmailSession(input: {
    userId: string;
    email: string;
    deviceFingerprint: string;
    device: {
      label: string;
      browser: string;
      operatingSystem: string;
      approximateLocation?: string;
      summarizedUserAgent?: string;
    };
    correlationId: string;
  }): Promise<{
    sessionId: string;
    sessionToken: string;
    isNewDevice: boolean;
    notificationScheduled: boolean;
  }> {
    const issued = await this.sessions.startDeviceSession({
      userId: input.userId,
      trust: "trusted",
      deviceFingerprint: input.deviceFingerprint,
      device: input.device,
      newDeviceNotification: {
        recipient: input.email.trim().toLowerCase(),
        correlationId: input.correlationId,
      },
    });
    return {
      sessionId: issued.sessionId,
      sessionToken: issued.token,
      isNewDevice: issued.isNewDevice,
      notificationScheduled: issued.notificationScheduled,
    };
  }

  listIdentities(userId: string): Promise<readonly IdentityManagementSummary[]> {
    return this.repository.listForUser(userId);
  }

  findPendingIdentityLink(actorId: string, sessionId: string) {
    return this.repository.findPendingLinkForSession({
      actorId,
      sessionId,
      now: this.clock.now(),
    });
  }

  async assertFreshAuthentication(actorId: string, sessionId: string): Promise<void> {
    if (!(await this.sessions.hasFreshStepUp(actorId, sessionId, this.clock.now()))) {
      throw new ReauthenticationRequiredException();
    }
  }

  async confirmIdentityLink(input: {
    actorId: string;
    sessionId: string;
    proofId: string;
    correlationId: string;
  }): Promise<{
    provider: "discord";
    sessionId: string;
    sessionToken: string;
    otherSessionsRevoked: number;
  }> {
    const now = this.clock.now();
    await this.assertFreshAuthentication(input.actorId, input.sessionId);
    const pending = await this.repository.findPendingLink({
      actorId: input.actorId,
      sessionId: input.sessionId,
      proofId: input.proofId,
      now,
    });
    if (pending === null) throw new Error("identity proof unavailable");
    const committed = await this.securityChanges.execute({
      actorId: input.actorId,
      currentSessionId: input.sessionId,
      proofId: pending.proofId,
      change: {
        type: "link-identity",
        provider: "discord",
        providerSubject: pending.providerSubject,
        ...(pending.displayName === undefined ? {} : { displayName: pending.displayName }),
      },
      now,
      correlationId: input.correlationId,
    });
    return { provider: "discord", ...committed };
  }

  async removeIdentity(input: {
    actorId: string;
    sessionId: string;
    identityId: string;
    correlationId: string;
  }): Promise<{ sessionId: string; sessionToken: string; otherSessionsRevoked: number }> {
    const now = this.clock.now();
    await this.assertFreshAuthentication(input.actorId, input.sessionId);
    const sessionToken = this.tokens.opaque(32);
    const removed = await this.repository.removeOwned({
      actorId: input.actorId,
      currentSessionId: input.sessionId,
      identityId: input.identityId,
      replacementSessionToken: sessionToken,
      now,
    });
    if (removed.status === "not-found") throw new Error("identity not found");
    if (removed.status === "last-verified") throw new Error("last verified identity");
    return {
      sessionId: removed.sessionId,
      sessionToken,
      otherSessionsRevoked: removed.otherSessionsRevoked,
    };
  }

  async applyEmailSecurityChange(input: {
    actorId: string;
    sessionId: string;
    proofId: string;
    purpose: "link-email" | "change-email";
    email: string;
    identityId?: string;
    correlationId: string;
  }): Promise<{
    sessionId: string;
    sessionToken: string;
    otherSessionsRevoked: number;
  }> {
    const email = input.email.trim().toLowerCase();
    await this.assertFreshAuthentication(input.actorId, input.sessionId);
    if (input.purpose === "change-email" && !input.identityId) {
      throw new Error("email identity is required");
    }
    return this.securityChanges.execute({
      actorId: input.actorId,
      currentSessionId: input.sessionId,
      proofId: input.proofId,
      change:
        input.purpose === "link-email"
          ? { type: "link-identity", provider: "email", email }
          : { type: "change-email", identityId: input.identityId as string, email },
      now: this.clock.now(),
      correlationId: input.correlationId,
    });
  }

  async signInWithDiscord(profile: DiscordUserProfile): Promise<DiscordSignInResult> {
    if (profile.id.trim().length === 0 || profile.username.trim().length === 0) {
      throw new Error("discord identity unavailable");
    }

    const usableEmail = normalizeUsableEmail(profile);
    const existing = await this.repository.findDiscordIdentity(profile.id);
    let userId = existing?.userId;
    if (userId === undefined) {
      const identityId = this.tokens.id();
      const candidateUserId = this.tokens.id();
      const created = await this.repository.createDiscordAccount({
        identityId,
        userId: candidateUserId,
        subject: profile.id,
        displayName: profile.username,
        ...(usableEmail === undefined ? {} : { verifiedEmail: usableEmail }),
      });
      if (created.status === "created") {
        userId = created.userId;
      } else {
        userId = (await this.repository.findDiscordIdentity(profile.id))?.userId;
      }
    }
    if (userId === undefined) {
      throw new Error("discord identity unavailable");
    }

    const trust: SessionTrust =
      existing?.emailVerified === true || usableEmail !== undefined ? "trusted" : "provisional";
    const issued = await this.sessions.issue({
      userId,
      trust,
      ...(trust === "provisional"
        ? { expiresAt: new Date(this.clock.now().getTime() + PROVISIONAL_SESSION_LIFETIME_MS) }
        : {}),
    });

    return {
      status: "authenticated",
      userId,
      sessionId: issued.sessionId,
      sessionToken: issued.token,
      trust,
    };
  }

  async linkIdentity(input: {
    userId: string;
    currentSessionId: string;
    provider: "discord" | "email";
    subject: string;
    displayName?: string;
    currentMethodConfirmed: boolean;
    candidateMethodConfirmed: boolean;
  }): Promise<{
    status: "linked";
    sessionId: string;
    sessionToken: string;
    otherSessionsRevoked: number;
  }> {
    if (!input.currentMethodConfirmed || !input.candidateMethodConfirmed) {
      throw new Error("identity confirmation required");
    }
    if (
      !(await this.sessions.hasFreshStepUp(input.userId, input.currentSessionId, this.clock.now()))
    ) {
      throw new Error("recent authentication required");
    }

    const linked = await this.repository.link({
      identityId: this.tokens.id(),
      userId: input.userId,
      provider: input.provider,
      subject: input.subject,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      verifiedAt: this.clock.now(),
    });
    if (linked.status === "conflict") {
      throw new Error("identity cannot be linked");
    }

    const secured = await this.sessions.rotateCurrentAndRevokeOthers({
      userId: input.userId,
      sessionId: input.currentSessionId,
      reason: "identity-link",
    });
    return {
      status: "linked",
      sessionId: secured.sessionId,
      sessionToken: secured.token,
      otherSessionsRevoked: secured.otherSessionsRevoked,
    };
  }

  async confirmDiscordStepUp(input: {
    userId: string;
    sessionId: string;
    profile: DiscordUserProfile;
  }): Promise<void> {
    await this.assertDiscordIdentity(input.userId, input.profile);
    await this.sessions.confirmStepUp({
      userId: input.userId,
      sessionId: input.sessionId,
      method: "discord",
      confirmedAt: this.clock.now(),
    });
  }

  async assertDiscordIdentity(userId: string, profile: DiscordUserProfile): Promise<void> {
    const identity = await this.repository.findDiscordIdentity(profile.id);
    if (identity?.userId !== userId) {
      throw new Error("identity confirmation failed");
    }
  }
}
