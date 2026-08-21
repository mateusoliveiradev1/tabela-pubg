import { Injectable } from "@nestjs/common";
import type { DiscordUserProfile } from "./ports/discord-identity-provider.js";
import type { TokenGenerator } from "./ports/token-generator.js";

export type SessionTrust = "provisional" | "trusted";

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
}

export interface IdentitySessionPort {
  issue(input: {
    userId: string;
    trust: SessionTrust;
    expiresAt?: Date;
  }): Promise<{ sessionId: string }>;
  hasFreshStepUp(userId: string, sessionId: string, now: Date): Promise<boolean>;
  rotateCurrentAndRevokeOthers(input: {
    userId: string;
    sessionId: string;
    reason: "identity-link" | "email-change";
  }): Promise<{ sessionId: string; otherSessionsRevoked: number }>;
  confirmStepUp(input: {
    userId: string;
    sessionId: string;
    method: "discord" | "email";
    confirmedAt: Date;
  }): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface DiscordSignInResult {
  status: "authenticated";
  userId: string;
  sessionId: string;
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
  ) {}

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

    return { status: "authenticated", userId, sessionId: issued.sessionId, trust };
  }

  async linkIdentity(input: {
    userId: string;
    currentSessionId: string;
    provider: "discord" | "email";
    subject: string;
    displayName?: string;
    currentMethodConfirmed: boolean;
    candidateMethodConfirmed: boolean;
  }): Promise<{ status: "linked"; sessionId: string; otherSessionsRevoked: number }> {
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
      otherSessionsRevoked: secured.otherSessionsRevoked,
    };
  }

  async confirmDiscordStepUp(input: {
    userId: string;
    sessionId: string;
    profile: DiscordUserProfile;
  }): Promise<void> {
    const identity = await this.repository.findDiscordIdentity(input.profile.id);
    if (identity?.userId !== input.userId) {
      throw new Error("identity confirmation failed");
    }
    await this.sessions.confirmStepUp({
      userId: input.userId,
      sessionId: input.sessionId,
      method: "discord",
      confirmedAt: this.clock.now(),
    });
  }
}
