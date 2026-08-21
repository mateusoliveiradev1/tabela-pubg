import { Injectable } from "@nestjs/common";
import type { IdentityService } from "./identity.service.js";
import type { DiscordIdentityProvider, OAuthPurpose } from "./ports/discord-identity-provider.js";
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

  async start(input: {
    purpose: OAuthPurpose;
    browserBinding: string;
    returnPath?: string;
    userId?: string;
    sessionId?: string;
    currentMethodConfirmed?: boolean;
  }): Promise<{ authorizationUrl: string }> {
    if (input.browserBinding.trim().length === 0) {
      throw new Error("browser binding required");
    }
    if (input.returnPath !== undefined && !isSafeReturnPath(input.returnPath)) {
      throw new Error("invalid return path");
    }
    if (
      input.purpose !== "sign-in" &&
      (input.userId === undefined || input.sessionId === undefined)
    ) {
      throw new Error("authenticated context required");
    }

    const state = this.tokens.opaque(32);
    const transaction = {
      id: this.tokens.id(),
      state,
      browserBinding: input.browserBinding,
      purpose: input.purpose,
      expiresAt: new Date(this.clock.now().getTime() + OAUTH_TRANSACTION_LIFETIME_MS),
      ...(input.returnPath === undefined ? {} : { returnPath: input.returnPath }),
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.currentMethodConfirmed === undefined
        ? {}
        : { currentMethodConfirmed: input.currentMethodConfirmed }),
    };
    await this.transactions.create(transaction);
    return this.provider.start({ state, purpose: input.purpose });
  }

  async callback(input: {
    code: string;
    state: string;
    browserBinding: string;
    purpose: OAuthPurpose;
  }): Promise<OAuthCallbackResult> {
    if (
      input.code.trim().length === 0 ||
      input.state.trim().length === 0 ||
      input.browserBinding.trim().length === 0
    ) {
      throw new Error("oauth transaction unavailable");
    }

    const transaction = await this.transactions.consume({
      state: input.state,
      browserBinding: input.browserBinding,
      purpose: input.purpose,
      now: this.clock.now(),
    });
    if (transaction === null || transaction.purpose !== input.purpose) {
      throw new Error("oauth transaction unavailable");
    }

    const exchanged = await this.provider.exchange({ code: input.code, state: input.state });
    try {
      const profile = await this.provider.fetchUser(exchanged.accessToken);
      return await this.completeCallback(transaction, profile);
    } finally {
      await this.provider.revoke(exchanged.accessToken);
    }
  }

  private async completeCallback(
    transaction: OAuthTransaction,
    profile: Awaited<ReturnType<DiscordIdentityProvider["fetchUser"]>>,
  ): Promise<OAuthCallbackResult> {
    const nextPath = transaction.returnPath ?? "/";
    if (transaction.purpose === "sign-in") {
      const result = await this.identity.signInWithDiscord(profile);
      return { status: "authenticated", nextPath, sessionId: result.sessionId };
    }
    if (transaction.userId === undefined || transaction.sessionId === undefined) {
      throw new Error("authenticated context required");
    }
    if (transaction.purpose === "link-identity") {
      const result = await this.identity.linkIdentity({
        userId: transaction.userId,
        currentSessionId: transaction.sessionId,
        provider: "discord",
        subject: profile.id,
        displayName: profile.username,
        currentMethodConfirmed: transaction.currentMethodConfirmed === true,
        candidateMethodConfirmed: true,
      });
      return {
        status: "linked",
        nextPath,
        sessionId: result.sessionId,
        otherSessionsRevoked: result.otherSessionsRevoked,
      };
    }

    await this.identity.confirmDiscordStepUp({
      userId: transaction.userId,
      sessionId: transaction.sessionId,
      profile,
    });
    return { status: "step-up-confirmed", nextPath };
  }
}

function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}
