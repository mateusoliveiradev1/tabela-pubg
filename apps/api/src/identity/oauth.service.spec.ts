import { describe, expect, it, vi } from "vitest";
import type { IdentityService } from "./identity.service.js";
import {
  OAuthService,
  type OAuthTransaction,
  type OAuthTransactionRepository,
} from "./oauth.service.js";
import type { DiscordIdentityProvider } from "./ports/discord-identity-provider.js";
import type { TokenGenerator } from "./ports/token-generator.js";
import type { SessionService } from "./session.service.js";

const now = new Date("2026-08-24T12:00:00.000Z");
const actorId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function setup(transaction: OAuthTransaction | null = { purpose: "sign-in", returnPath: "/home" }) {
  let stored = transaction;
  const events: string[] = [];
  const provider: DiscordIdentityProvider = {
    start: vi.fn(async ({ state }) => ({
      authorizationUrl: `https://discord.test/oauth?state=${state}`,
    })),
    exchange: vi.fn(async () => ({ accessToken: "discord-secret" })),
    fetchUser: vi.fn(async () => ({
      id: "discord-1",
      username: "player",
      email: "player@example.com",
      emailVerified: true,
    })),
    revoke: vi.fn(async () => {
      events.push("revoke");
    }),
  };
  const transactions: OAuthTransactionRepository = {
    create: vi.fn(async (input) => {
      stored = input;
    }),
    consume: vi.fn(async () => {
      const result = stored;
      stored = null;
      return result;
    }),
    createPendingLinkProof: vi.fn(async () => {
      events.push("proof");
    }),
  };
  const identity = {
    signInWithDiscord: vi.fn(async () => {
      events.push("session");
      return {
        status: "authenticated" as const,
        userId: actorId,
        sessionId: "session-sign-in",
        sessionToken: "opaque-session-token",
        trust: "trusted" as const,
      };
    }),
    linkIdentity: vi.fn(async () => {
      events.push("identity-link");
      return {
        status: "linked" as const,
        sessionId: "session-rotated",
        sessionToken: "rotated-token",
        otherSessionsRevoked: 1,
      };
    }),
    confirmDiscordStepUp: vi.fn(async () => {
      events.push("identity-step-up");
    }),
    assertDiscordIdentity: vi.fn(async () => undefined),
  } as unknown as IdentityService;
  const sessions = {
    confirmStepUp: vi.fn(async () => {
      events.push("step-up");
    }),
  } as unknown as SessionService;
  const tokens: TokenGenerator = {
    id: vi.fn(() => "oauth-1"),
    opaque: vi.fn(() => "state-1"),
    numericCode: vi.fn(() => "12345678"),
    digest: vi.fn((value) => `digest:${value}`),
  };
  return {
    service: new OAuthService(provider, transactions, identity, sessions, tokens, {
      now: () => now,
    }),
    provider,
    transactions,
    identity,
    sessions,
    events,
  };
}

describe("OAuthService", () => {
  it("persists a public sign-in transaction without actor authority", async () => {
    const { service, transactions } = setup(null);

    const result = await service.start({
      purpose: "sign-in",
      browserBinding: "browser-1",
      returnPath: "/dashboard",
    });

    expect(transactions.create).toHaveBeenCalledWith({
      id: "oauth-1",
      state: "state-1",
      browserBinding: "browser-1",
      purpose: "sign-in",
      expiresAt: new Date("2026-08-24T12:10:00.000Z"),
      returnPath: "/dashboard",
    });
    expect(result.authorizationUrl).toContain("state=state-1");
  });

  it.each(["step-up", "link-identity"] as const)(
    "persists server-derived actor/session for protected %s start",
    async (purpose) => {
      const { service, transactions } = setup(null);

      await service.start({
        purpose,
        browserBinding: "browser-1",
        actorId,
        sessionId,
        returnPath: "/account/identities",
      });

      expect(transactions.create).toHaveBeenCalledWith(
        expect.objectContaining({ purpose, actorId, sessionId }),
      );
    },
  );

  it("lets the repository admit step-up from an active session without requiring earlier freshness", async () => {
    const { service, transactions, provider } = setup(null);

    await service.start({
      purpose: "step-up",
      browserBinding: "browser-1",
      actorId,
      sessionId,
    });

    expect(transactions.create).toHaveBeenCalledOnce();
    expect(provider.start).toHaveBeenCalledOnce();
  });

  it("fails before redirect when the protected session or link freshness prerequisite is rejected", async () => {
    const { service, transactions, provider } = setup(null);
    vi.mocked(transactions.create).mockRejectedValueOnce(new Error("active session required"));

    await expect(
      service.start({
        purpose: "step-up",
        browserBinding: "browser-1",
        actorId,
        sessionId,
      }),
    ).rejects.toThrow("active session required");
    expect(provider.start).not.toHaveBeenCalled();
  });

  it("rejects client authority and missing server authority for protected starts", async () => {
    const { service, transactions } = setup(null);

    await expect(
      service.start({ purpose: "step-up", browserBinding: "browser-1" }),
    ).rejects.toThrow("authenticated context required");
    await expect(
      service.start({
        purpose: "sign-in",
        browserBinding: "browser-1",
        actorId,
        sessionId,
      }),
    ).rejects.toThrow("public sign-in cannot carry authenticated context");
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it("fails closed before provider exchange when state, purpose or browser binding cannot be consumed", async () => {
    const { service, provider } = setup(null);

    await expect(
      service.callback({
        code: "code-1",
        state: "missing",
        browserBinding: "browser-1",
        purpose: "sign-in",
      }),
    ).rejects.toThrow("oauth transaction unavailable");
    expect(provider.exchange).not.toHaveBeenCalled();
  });

  it("revokes before creating the sign-in session and never returns the provider token", async () => {
    const { service, provider, identity, events } = setup();

    const result = await service.callback({
      code: "code-1",
      state: "state-1",
      browserBinding: "browser-1",
      purpose: "sign-in",
    });

    expect(identity.signInWithDiscord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "discord-1" }),
    );
    expect(provider.revoke).toHaveBeenCalledWith("discord-secret");
    expect(events).toEqual(["revoke", "session"]);
    expect(result).toEqual({
      status: "authenticated",
      nextPath: "/home",
      sessionId: "session-sign-in",
      sessionToken: "opaque-session-token",
    });
    expect(JSON.stringify(result)).not.toContain("discord-secret");
  });

  it("confirms Discord step-up for the consumed actor/session only after revoke", async () => {
    const transaction: OAuthTransaction = {
      purpose: "step-up",
      actorId,
      sessionId,
      returnPath: "/organizations/one/members",
    };
    const { service, sessions, identity, events } = setup(transaction);

    const result = await service.callback({
      code: "code-1",
      state: "state-1",
      browserBinding: "browser-1",
      purpose: "step-up",
      actorId,
      sessionId,
    });

    expect(sessions.confirmStepUp).toHaveBeenCalledWith({
      userId: actorId,
      sessionId,
      method: "discord",
      confirmedAt: now,
    });
    expect(identity.confirmDiscordStepUp).not.toHaveBeenCalled();
    expect(events).toEqual(["revoke", "step-up"]);
    expect(result).toEqual({
      status: "step-up-confirmed",
      nextPath: "/organizations/one/members",
    });
  });

  it("creates one pending link proof after revoke without linking or rotating sessions", async () => {
    const transaction: OAuthTransaction = {
      purpose: "link-identity",
      actorId,
      sessionId,
      currentMethodConfirmedAt: new Date("2026-08-24T11:55:00.000Z"),
      returnPath: "/account/identities",
    };
    const { service, transactions, identity, events } = setup(transaction);

    const result = await service.callback({
      code: "code-1",
      state: "state-1",
      browserBinding: "browser-1",
      purpose: "link-identity",
      actorId,
      sessionId,
    });

    expect(transactions.createPendingLinkProof).toHaveBeenCalledWith({
      id: "oauth-1",
      actorId,
      sessionId,
      purpose: "link-identity",
      provider: "discord",
      providerSubject: "discord-1",
      displayName: "player",
      expiresAt: new Date("2026-08-24T12:10:00.000Z"),
    });
    expect(identity.linkIdentity).not.toHaveBeenCalled();
    expect(events).toEqual(["revoke", "proof"]);
    expect(result).toEqual({
      status: "link-confirmation-required",
      nextPath: "/account/identities",
    });
  });

  it("rejects callback actor/session mismatch before provider exchange", async () => {
    const { service, provider, sessions } = setup({
      purpose: "step-up",
      actorId,
      sessionId,
    });

    await expect(
      service.callback({
        code: "code-1",
        state: "state-1",
        browserBinding: "browser-1",
        purpose: "step-up",
        actorId,
        sessionId: "99999999-9999-4999-8999-999999999999",
      }),
    ).rejects.toThrow("oauth transaction unavailable");
    expect(provider.exchange).not.toHaveBeenCalled();
    expect(sessions.confirmStepUp).not.toHaveBeenCalled();
  });

  it("revoke rejection leaves sign-in, step-up and pending proof mutations untouched", async () => {
    for (const transaction of [
      { purpose: "sign-in" as const },
      { purpose: "step-up" as const, actorId, sessionId },
      {
        purpose: "link-identity" as const,
        actorId,
        sessionId,
        currentMethodConfirmedAt: now,
      },
    ]) {
      const { service, provider, transactions, identity, sessions } = setup(transaction);
      vi.mocked(provider.revoke).mockRejectedValueOnce(
        new Error("discord token revocation failed"),
      );

      await expect(
        service.callback({
          code: "code-1",
          state: "state-1",
          browserBinding: "browser-1",
          purpose: transaction.purpose,
          ...(transaction.purpose === "sign-in" ? {} : { actorId, sessionId }),
        }),
      ).rejects.toThrow("discord token revocation failed");
      expect(identity.signInWithDiscord).not.toHaveBeenCalled();
      expect(identity.linkIdentity).not.toHaveBeenCalled();
      expect(sessions.confirmStepUp).not.toHaveBeenCalled();
      expect(transactions.createPendingLinkProof).not.toHaveBeenCalled();
    }
  });

  it("revokes the provider token when profile fetch fails and commits nothing", async () => {
    const { service, provider, identity, sessions, transactions } = setup();
    vi.mocked(provider.fetchUser).mockRejectedValueOnce(new Error("provider failed"));

    await expect(
      service.callback({
        code: "code-1",
        state: "state-1",
        browserBinding: "browser-1",
        purpose: "sign-in",
      }),
    ).rejects.toThrow("provider failed");
    expect(provider.revoke).toHaveBeenCalledWith("discord-secret");
    expect(identity.signInWithDiscord).not.toHaveBeenCalled();
    expect(sessions.confirmStepUp).not.toHaveBeenCalled();
    expect(transactions.createPendingLinkProof).not.toHaveBeenCalled();
  });

  it("consumes callback state once", async () => {
    const { service } = setup();
    await service.callback({
      code: "code-1",
      state: "state-1",
      browserBinding: "browser-1",
      purpose: "sign-in",
    });

    await expect(
      service.callback({
        code: "code-1",
        state: "state-1",
        browserBinding: "browser-1",
        purpose: "sign-in",
      }),
    ).rejects.toThrow("oauth transaction unavailable");
  });
});
