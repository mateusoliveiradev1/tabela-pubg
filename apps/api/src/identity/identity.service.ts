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

@Injectable()
export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly sessions: IdentitySessionPort,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
  ) {}

  async signInWithDiscord(_profile: DiscordUserProfile): Promise<DiscordSignInResult> {
    throw new Error("not implemented");
  }

  async linkIdentity(_input: {
    userId: string;
    currentSessionId: string;
    provider: "discord" | "email";
    subject: string;
    displayName?: string;
    currentMethodConfirmed: boolean;
    candidateMethodConfirmed: boolean;
  }): Promise<{ status: "linked"; sessionId: string; otherSessionsRevoked: number }> {
    throw new Error("not implemented");
  }

  async confirmDiscordStepUp(_input: {
    userId: string;
    sessionId: string;
    profile: DiscordUserProfile;
  }): Promise<void> {
    throw new Error("not implemented");
  }
}
