import { Injectable } from "@nestjs/common";
import type { IdentityService } from "./identity.service.js";
import type {
  DiscordIdentityProvider,
  OAuthPurpose,
} from "./ports/discord-identity-provider.js";
import type { TokenGenerator } from "./ports/token-generator.js";

const OAUTH_TRANSACTION_LIFETIME_MS = 10 * 60_000;

export interface OAuthTransaction {
  purpose: OAuthPurpose;
  returnPath?: string;
  userId?: string;
  sessionId?: string;
  currentMethodConfirmed?: boolean;
}

export interface OAuthTransactionRepository {
  create(input: {
    id: string;
    state: string;
    browserBinding: string;
    purpose: OAuthPurpose;
    expiresAt: Date;
    returnPath?: string;
    userId?: string;
    sessionId?: string;
    currentMethodConfirmed?: boolean;
  }): Promise<void>;
  consume(input: {
    state: string;
    browserBinding: string;
    purpose: OAuthPurpose;
    now: Date;
  }): Promise<OAuthTransaction | null>;
}

export interface OAuthClock {
  now(): Date;
}

export type OAuthCallbackResult =
  | { status: "authenticated"; nextPath: string; sessionId: string }
  | { status: "linked"; nextPath: string; sessionId: string; otherSessionsRevoked: number }
  | { status: "step-up-confirmed"; nextPath: string };

@Injectable()
export class OAuthService {
  constructor(
    private readonly provider: DiscordIdentityProvider,
    private readonly transactions: OAuthTransactionRepository,
    private readonly identity: IdentityService,
    private readonly tokens: TokenGenerator,
    private readonly clock: OAuthClock,
  ) {}

  async start(_input: {
    purpose: OAuthPurpose;
    browserBinding: string;
    returnPath?: string;
    userId?: string;
    sessionId?: string;
    currentMethodConfirmed?: boolean;
  }): Promise<{ authorizationUrl: string }> {
    void OAUTH_TRANSACTION_LIFETIME_MS;
    throw new Error("not implemented");
  }

  async callback(_input: {
    code: string;
    state: string;
    browserBinding: string;
    purpose: OAuthPurpose;
  }): Promise<OAuthCallbackResult> {
    throw new Error("not implemented");
  }
}
