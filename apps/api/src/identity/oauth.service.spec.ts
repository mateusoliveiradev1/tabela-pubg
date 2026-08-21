import { describe, expect, it, vi } from "vitest";
import type { IdentityService } from "./identity.service.js";
import {
  OAuthService,
  type OAuthTransaction,
  type OAuthTransactionRepository,
} from "./oauth.service.js";
import type { DiscordIdentityProvider } from "./ports/discord-identity-provider.js";
import type { TokenGenerator } from "./ports/token-generator.js";

const now = new Date("2026-08-21T12:00:00.000Z");

function setup(transaction: OAuthTransaction | null = { purpose: "sign-in", returnPath: "/home" }) {
  let stored = transaction;
  const provider: DiscordIdentityProvider = {
    start: vi.fn(async ({ state }) => ({ authorizationUrl: `https://discord.test/oauth?state=${state}` })),
    exchange: vi.fn(async () => ({ accessToken: "discord-secret" })),
    fetchUser: vi.fn(async () => ({
      id: "discord-1",
      username: "player",
      email: "player@example.com",
      emailVerified: true,
    })),
    revoke: vi.fn(async () => undefined),
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
  };
  const identity = {
    signInWithDiscord: vi.fn(async () => ({
      status: "authenticated" as const,
      userId: "user-1",
      sessionId: "session-1",
      trust: "trusted" as const,
    })),
    linkIdentity: vi.fn(async () => ({
      status: "linked" as const,
      sessionId: "session-rotated",
      otherSessionsRevoked: 1,
    })),
    confirmDiscordStepUp: vi.fn(async () => undefined),
  } as unknown as IdentityService;
  const tokens: TokenGenerator = {
    id: vi.fn(() => "oauth-1"),
    opaque: vi.fn(() => "state-1"),
    numericCode: vi.fn(() => "12345678"),
    digest: vi.fn((value) => `digest:${value}`),
  };
  return {
    service: new OAuthService(provider, transactions, identity, tokens, { now: () => now }),
    provider,
    transactions,
    identity,
  };
}

describe("OAuthService", () => {
  it("persists purpose, browser binding and a ten minute expiry before redirecting", async () => {
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
      expiresAt: new Date("2026-08-21T12:10:00.000Z"),
      returnPath: "/dashboard",
    });
    expect(result.authorizationUrl).toContain("state=state-1");
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

  it("consumes state once, authenticates by Discord subject and revokes the provider token", async () => {
    const { service, provider, identity } = setup();

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
    expect(result).toEqual({ status: "authenticated", nextPath: "/home", sessionId: "session-1" });

    await expect(
      service.callback({
        code: "code-1",
        state: "state-1",
        browserBinding: "browser-1",
        purpose: "sign-in",
      }),
    ).rejects.toThrow("oauth transaction unavailable");
  });

  it("revokes the provider token in finally when profile fetch fails", async () => {
    const { service, provider } = setup();
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
  });

  it("never returns the Discord access token in any callback result", async () => {
    const { service } = setup();

    const result = await service.callback({
      code: "code-1",
      state: "state-1",
      browserBinding: "browser-1",
      purpose: "sign-in",
    });

    expect(JSON.stringify(result)).not.toContain("discord-secret");
    expect(result).not.toHaveProperty("accessToken");
  });
});
