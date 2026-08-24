import { Injectable } from "@nestjs/common";
import type { IdentityService } from "./identity.service.js";
import type { DiscordIdentityProvider, OAuthPurpose } from "./ports/discord-identity-provider.js";
import type { TokenGenerator } from "./ports/token-generator.js";
import type { SessionService } from "./session.service.js";

const OAUTH_TRANSACTION_LIFETIME_MS = 10 * 60_000;
const OAUTH_LINK_PROOF_LIFETIME_MS = 10 * 60_000;

export interface OAuthTransaction {
  purpose: OAuthPurpose;
  returnPath?: string;
  actorId?: string;
  sessionId?: string;
  currentMethodConfirmedAt?: Date;
}

export interface OAuthTransactionRepository {
  create(input: {
    id: string;
    state: string;
    browserBinding: string;
    purpose: OAuthPurpose;
    expiresAt: Date;
    returnPath?: string;
    actorId?: string;
    sessionId?: string;
  }): Promise<void>;
  consume(input: {
    state: string;
    browserBinding: string;
    purpose: OAuthPurpose;
    now: Date;
  }): Promise<OAuthTransaction | null>;
  createPendingLinkProof(input: {
    id: string;
    actorId: string;
    sessionId: string;
    purpose: "link-identity";
    provider: "discord";
    providerSubject: string;
    displayName?: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface OAuthClock {
  now(): Date;
}

export type OAuthCallbackResult =
  | { status: "authenticated"; nextPath: string; sessionId: string; sessionToken: string }
  | { status: "link-confirmation-required"; nextPath: string }
  | { status: "step-up-confirmed"; nextPath: string };

@Injectable()
export class OAuthService {
  constructor(
    private readonly provider: DiscordIdentityProvider,
    private readonly transactions: OAuthTransactionRepository,
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenGenerator,
    private readonly clock: OAuthClock,
  ) {}

  async start(input: {
    purpose: OAuthPurpose;
    browserBinding: string;
    returnPath?: string;
    actorId?: string;
    sessionId?: string;
  }): Promise<{ authorizationUrl: string }> {
    if (input.browserBinding.trim().length === 0) {
      throw new Error("browser binding required");
    }
    if (input.returnPath !== undefined && !isSafeReturnPath(input.returnPath)) {
      throw new Error("invalid return path");
    }
    const hasActor = input.actorId !== undefined;
    const hasSession = input.sessionId !== undefined;
    if (input.purpose === "sign-in" && (hasActor || hasSession)) {
      throw new Error("public sign-in cannot carry authenticated context");
    }
    if (input.purpose !== "sign-in" && (!hasActor || !hasSession)) {
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
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    };
    await this.transactions.create(transaction);
    return this.provider.start({ state, purpose: input.purpose });
  }

  async callback(input: {
    code: string;
    state: string;
    browserBinding: string;
    purpose: OAuthPurpose;
    actorId?: string;
    sessionId?: string;
  }): Promise<OAuthCallbackResult> {
    if (
      input.code.trim().length === 0 ||
      input.state.trim().length === 0 ||
      input.browserBinding.trim().length === 0
    ) {
      throw new Error("oauth transaction unavailable");
    }
    const hasActor = input.actorId !== undefined;
    const hasSession = input.sessionId !== undefined;
    if (
      (input.purpose === "sign-in" && (hasActor || hasSession)) ||
      (input.purpose !== "sign-in" && (!hasActor || !hasSession))
    ) {
      throw new Error("oauth transaction unavailable");
    }

    const transaction = await this.transactions.consume({
      state: input.state,
      browserBinding: input.browserBinding,
      purpose: input.purpose,
      now: this.clock.now(),
    });
    if (
      transaction === null ||
      transaction.purpose !== input.purpose ||
      (transaction.purpose !== "sign-in" &&
        (transaction.actorId !== input.actorId || transaction.sessionId !== input.sessionId))
    ) {
      throw new Error("oauth transaction unavailable");
    }

    const exchanged = await this.provider.exchange({ code: input.code, state: input.state });
    let profile: Awaited<ReturnType<DiscordIdentityProvider["fetchUser"]>>;
    try {
      profile = await this.provider.fetchUser(exchanged.accessToken);
    } finally {
      await this.provider.revoke(exchanged.accessToken);
    }
    return this.completeCallback(transaction, profile);
  }

  private async completeCallback(
    transaction: OAuthTransaction,
    profile: Awaited<ReturnType<DiscordIdentityProvider["fetchUser"]>>,
  ): Promise<OAuthCallbackResult> {
    const nextPath = transaction.returnPath ?? "/";
    if (transaction.purpose === "sign-in") {
      const result = await this.identity.signInWithDiscord(profile);
      return {
        status: "authenticated",
        nextPath,
        sessionId: result.sessionId,
        sessionToken: result.sessionToken,
      };
    }
    if (transaction.actorId === undefined || transaction.sessionId === undefined) {
      throw new Error("authenticated context required");
    }
    if (transaction.purpose === "link-identity") {
      if (transaction.currentMethodConfirmedAt === undefined) {
        throw new Error("fresh current-method proof required");
      }
      await this.transactions.createPendingLinkProof({
        id: this.tokens.id(),
        actorId: transaction.actorId,
        sessionId: transaction.sessionId,
        purpose: "link-identity",
        provider: "discord",
        providerSubject: profile.id,
        displayName: profile.username,
        expiresAt: new Date(this.clock.now().getTime() + OAUTH_LINK_PROOF_LIFETIME_MS),
      });
      return {
        status: "link-confirmation-required",
        nextPath,
      };
    }

    await this.identity.assertDiscordIdentity(transaction.actorId, profile);
    await this.sessions.confirmStepUp({
      userId: transaction.actorId,
      sessionId: transaction.sessionId,
      method: "discord",
      confirmedAt: this.clock.now(),
    });
    return { status: "step-up-confirmed", nextPath };
  }
}

function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}
