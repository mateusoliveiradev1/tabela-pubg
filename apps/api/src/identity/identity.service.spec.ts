import { describe, expect, it, vi } from "vitest";
import {
  type IdentityRepository,
  type IdentitySecurityChangeApplicationPort,
  IdentityService,
  type IdentitySessionPort,
  ReauthenticationRequiredException,
} from "./identity.service.js";
import type { TokenGenerator } from "./ports/token-generator.js";

const now = new Date("2026-08-21T12:00:00.000Z");

function setup(options?: { existingSubject?: string; linkConflict?: boolean }) {
  const repository: IdentityRepository = {
    findDiscordIdentity: vi.fn(async (subject) =>
      subject === options?.existingSubject
        ? { userId: "user-existing", emailVerified: true }
        : null,
    ),
    createDiscordAccount: vi.fn(async (input) =>
      options?.existingSubject === input.subject
        ? { status: "conflict" as const }
        : { status: "created" as const, userId: input.userId },
    ),
    link: vi.fn(async () =>
      options?.linkConflict ? { status: "conflict" as const } : { status: "linked" as const },
    ),
    listForUser: vi.fn(async () => [
      {
        id: "00000000-0000-4000-8000-000000000010",
        provider: "discord" as const,
        status: "verified" as const,
        displayIdentifier: "p***r",
        linkedAt: now,
      },
    ]),
    findPendingLinkForSession: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000011",
      provider: "discord" as const,
      displayIdentifier: "pl•••er",
    })),
    findPendingLink: vi.fn(async () => ({
      proofId: "proof-1",
      provider: "discord" as const,
      providerSubject: "discord-subject",
      displayName: "player",
    })),
    removeOwned: vi.fn(async () => ({
      status: "removed" as const,
      sessionId: "session-1",
      otherSessionsRevoked: 2,
    })),
  };
  const sessions: IdentitySessionPort = {
    issue: vi.fn(async () => ({ sessionId: "session-new", token: "session-token-new" })),
    startDeviceSession: vi.fn(async () => ({
      sessionId: "session-email",
      token: "session-token-email",
      isNewDevice: true,
      notificationScheduled: true,
    })),
    hasFreshStepUp: vi.fn(async () => true),
    rotateCurrentAndRevokeOthers: vi.fn(async () => ({
      sessionId: "session-rotated",
      token: "session-token-rotated",
      otherSessionsRevoked: 2,
    })),
    confirmStepUp: vi.fn(async () => undefined),
  };
  const securityChanges: IdentitySecurityChangeApplicationPort = {
    execute: vi.fn(async () => ({
      sessionId: "session-1",
      sessionToken: "session-token-replaced",
      otherSessionsRevoked: 2,
    })),
  };
  const tokens: TokenGenerator = {
    id: vi.fn().mockReturnValueOnce("identity-new").mockReturnValueOnce("user-new"),
    opaque: vi.fn(() => "opaque"),
    numericCode: vi.fn(() => "12345678"),
    digest: vi.fn((value) => `digest:${value}`),
  };
  return {
    service: new IdentityService(repository, sessions, tokens, { now: () => now }, securityChanges),
    repository,
    sessions,
    securityChanges,
  };
}

describe("IdentityService", () => {
  it("resolves Discord login only by stable provider subject and never by matching email", async () => {
    const { service, repository } = setup({ existingSubject: "discord-existing" });

    const result = await service.signInWithDiscord({
      id: "discord-new",
      username: "new-player",
      email: "same@example.com",
      emailVerified: true,
    });

    expect(repository.findDiscordIdentity).toHaveBeenCalledWith("discord-new");
    expect(repository.createDiscordAccount).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "discord-new", verifiedEmail: "same@example.com" }),
    );
    expect(result.userId).toBe("user-new");
  });

  it("issues only a 15 minute provisional session when Discord has no usable email", async () => {
    const { service, sessions } = setup();

    const result = await service.signInWithDiscord({
      id: "discord-no-email",
      username: "player",
      emailVerified: false,
    });

    expect(result.trust).toBe("provisional");
    expect(sessions.issue).toHaveBeenCalledWith({
      userId: "user-new",
      trust: "provisional",
      expiresAt: new Date("2026-08-21T12:15:00.000Z"),
    });
  });

  it("requires both explicit confirmations and a fresh step-up before linking", async () => {
    const { service, repository, sessions } = setup();

    await expect(
      service.linkIdentity({
        userId: "user-1",
        currentSessionId: "session-1",
        provider: "discord",
        subject: "discord-1",
        currentMethodConfirmed: true,
        candidateMethodConfirmed: false,
      }),
    ).rejects.toThrow("identity confirmation required");
    expect(repository.link).not.toHaveBeenCalled();

    vi.mocked(sessions.hasFreshStepUp).mockResolvedValueOnce(false);
    await expect(
      service.linkIdentity({
        userId: "user-1",
        currentSessionId: "session-1",
        provider: "discord",
        subject: "discord-1",
        currentMethodConfirmed: true,
        candidateMethodConfirmed: true,
      }),
    ).rejects.toThrow("recent authentication required");
  });

  it("returns a generic conflict and does not rotate sessions when identity is owned elsewhere", async () => {
    const { service, sessions } = setup({ linkConflict: true });

    await expect(
      service.linkIdentity({
        userId: "user-1",
        currentSessionId: "session-1",
        provider: "discord",
        subject: "discord-other",
        currentMethodConfirmed: true,
        candidateMethodConfirmed: true,
      }),
    ).rejects.toThrow("identity cannot be linked");
    expect(sessions.rotateCurrentAndRevokeOthers).not.toHaveBeenCalled();
  });

  it("rotates the confirmed session and revokes every other session after linking", async () => {
    const { service, sessions } = setup();

    const result = await service.linkIdentity({
      userId: "user-1",
      currentSessionId: "session-1",
      provider: "email",
      subject: "player@example.com",
      currentMethodConfirmed: true,
      candidateMethodConfirmed: true,
    });

    expect(sessions.rotateCurrentAndRevokeOthers).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      reason: "identity-link",
    });
    expect(result).toEqual({
      status: "linked",
      sessionId: "session-rotated",
      sessionToken: "session-token-rotated",
      otherSessionsRevoked: 2,
    });
  });

  it("starts a trusted device session and schedules the new-device alert for email sign-in", async () => {
    const { service, sessions } = setup();

    const result = await service.startEmailSession({
      userId: "user-email",
      email: " Player@Example.com ",
      deviceFingerprint: "server-browser-binding",
      device: {
        label: "Email sign-in device",
        browser: "Chrome",
        operatingSystem: "Windows",
        summarizedUserAgent: "Chrome on Windows",
      },
      correlationId: "corr-email-sign-in",
    });

    expect(sessions.startDeviceSession).toHaveBeenCalledWith({
      userId: "user-email",
      trust: "trusted",
      deviceFingerprint: "server-browser-binding",
      device: {
        label: "Email sign-in device",
        browser: "Chrome",
        operatingSystem: "Windows",
        summarizedUserAgent: "Chrome on Windows",
      },
      newDeviceNotification: {
        recipient: "player@example.com",
        correlationId: "corr-email-sign-in",
      },
    });
    expect(result).toEqual({
      sessionId: "session-email",
      sessionToken: "session-token-email",
      isNewDevice: true,
      notificationScheduled: true,
    });
  });

  it("delegates an unconsumed email proof to the single atomic security-change command", async () => {
    const { service, securityChanges, repository, sessions } = setup();

    const result = await service.applyEmailSecurityChange({
      actorId: "user-1",
      sessionId: "session-1",
      proofId: "proof-1",
      purpose: "change-email",
      email: "New@Example.com",
      identityId: "identity-email-1",
      correlationId: "corr-change-email",
    });

    expect(securityChanges.execute).toHaveBeenCalledTimes(1);
    expect(securityChanges.execute).toHaveBeenCalledWith({
      actorId: "user-1",
      currentSessionId: "session-1",
      proofId: "proof-1",
      change: {
        type: "change-email",
        identityId: "identity-email-1",
        email: "new@example.com",
      },
      now,
      correlationId: "corr-change-email",
    });
    expect(repository.link).not.toHaveBeenCalled();
    expect(sessions.rotateCurrentAndRevokeOthers).not.toHaveBeenCalled();
    expect(result.sessionToken).toBe("session-token-replaced");
  });

  it("lists only repository-projected redacted identities for the actor", async () => {
    const { service, repository } = setup();

    const result = await service.listIdentities("user-1");

    expect(repository.listForUser).toHaveBeenCalledWith("user-1");
    expect(result).toEqual([
      expect.objectContaining({ provider: "discord", displayIdentifier: "p***r" }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/providerSubject|digest|token|email/i);
  });

  it("projects a pending Discord proof only for the current actor and session", async () => {
    const { service, repository } = setup();

    await expect(service.findPendingIdentityLink("user-1", "session-1")).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000011",
      provider: "discord",
      displayIdentifier: "pl•••er",
    });
    expect(repository.findPendingLinkForSession).toHaveBeenCalledWith({
      actorId: "user-1",
      sessionId: "session-1",
      now,
    });
    expect(
      JSON.stringify(await service.findPendingIdentityLink("user-1", "session-1")),
    ).not.toMatch(/providerSubject|discord-subject|token|digest/i);
  });

  it("requires fresh step-up and delegates an explicit actor/session-bound Discord candidate once", async () => {
    const { service, repository, sessions, securityChanges } = setup();

    const result = await service.confirmIdentityLink({
      actorId: "user-1",
      sessionId: "session-1",
      proofId: "proof-1",
      correlationId: "corr-link",
    });

    expect(sessions.hasFreshStepUp).toHaveBeenCalledWith("user-1", "session-1", now);
    expect(repository.findPendingLink).toHaveBeenCalledWith({
      actorId: "user-1",
      sessionId: "session-1",
      proofId: "proof-1",
      now,
    });
    expect(securityChanges.execute).toHaveBeenCalledTimes(1);
    expect(securityChanges.execute).toHaveBeenCalledWith({
      actorId: "user-1",
      currentSessionId: "session-1",
      proofId: "proof-1",
      change: {
        type: "link-identity",
        provider: "discord",
        providerSubject: "discord-subject",
        displayName: "player",
      },
      now,
      correlationId: "corr-link",
    });
    expect(result.provider).toBe("discord");
  });

  it.each(["stale", "replayed", "cross-session"])(
    "rejects a %s proof before invoking the atomic command",
    async () => {
      const { service, repository, securityChanges } = setup();
      vi.mocked(repository.findPendingLink).mockResolvedValueOnce(null);

      await expect(
        service.confirmIdentityLink({
          actorId: "user-1",
          sessionId: "session-1",
          proofId: "proof-1",
          correlationId: "corr-link",
        }),
      ).rejects.toThrow("identity proof unavailable");
      expect(securityChanges.execute).not.toHaveBeenCalled();
    },
  );

  it("rejects stale step-up before reading or consuming a pending proof", async () => {
    const { service, repository, sessions, securityChanges } = setup();
    vi.mocked(sessions.hasFreshStepUp).mockResolvedValueOnce(false);

    await expect(
      service.confirmIdentityLink({
        actorId: "user-1",
        sessionId: "session-1",
        proofId: "proof-1",
        correlationId: "corr-link",
      }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredException);
    expect(repository.findPendingLink).not.toHaveBeenCalled();
    expect(securityChanges.execute).not.toHaveBeenCalled();
  });

  it("delegates owner-scoped removal, token rotation and revoke-others to one transaction", async () => {
    const { service, repository, sessions } = setup();

    const result = await service.removeIdentity({
      actorId: "user-1",
      sessionId: "session-1",
      identityId: "identity-1",
      correlationId: "corr-remove",
    });

    expect(repository.removeOwned).toHaveBeenCalledWith({
      actorId: "user-1",
      currentSessionId: "session-1",
      identityId: "identity-1",
      replacementSessionToken: "opaque",
      now,
    });
    expect(sessions.rotateCurrentAndRevokeOthers).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessionId: "session-1",
      sessionToken: "opaque",
      otherSessionsRevoked: 2,
    });
  });

  it.each([
    [{ status: "not-found" as const }, "identity not found"],
    [{ status: "last-verified" as const }, "last verified identity"],
  ])("does not rotate after repository removal rejection %#", async (removal, message) => {
    const { service, repository, sessions } = setup();
    vi.mocked(repository.removeOwned).mockResolvedValueOnce(removal);

    await expect(
      service.removeIdentity({
        actorId: "user-1",
        sessionId: "session-1",
        identityId: "identity-1",
        correlationId: "corr-remove",
      }),
    ).rejects.toThrow(message);
    expect(sessions.rotateCurrentAndRevokeOthers).not.toHaveBeenCalled();
  });
});
