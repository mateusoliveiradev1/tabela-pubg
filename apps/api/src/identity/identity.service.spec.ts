import { describe, expect, it, vi } from "vitest";
import {
  type IdentityRepository,
  type IdentitySecurityChangeApplicationPort,
  IdentityService,
  type IdentitySessionPort,
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
});
