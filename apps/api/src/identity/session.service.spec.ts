import { describe, expect, it, vi } from "vitest";
import type { TokenGenerator } from "./ports/token-generator.js";
import {
  type SessionRecord,
  type SessionRepositoryPort,
  SessionService,
} from "./session.service.js";

const now = new Date("2026-08-21T12:00:00.000Z");

function session(overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    device: {
      label: "Desktop",
      browser: "Firefox",
      operatingSystem: "Windows",
      approximateLocation: "São Paulo, BR",
    },
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    lastSeenAt: new Date("2026-08-21T11:55:00.000Z"),
    idleExpiresAt: new Date("2026-09-20T11:55:00.000Z"),
    absoluteExpiresAt: new Date("2026-10-30T12:00:00.000Z"),
    ...overrides,
  };
}

function setup(options?: {
  sessions?: readonly SessionRecord[];
  alertStatus?: Awaited<ReturnType<SessionRepositoryPort["resolveAlertContextReadOnly"]>>;
}) {
  const alertStatus: Awaited<ReturnType<SessionRepositoryPort["resolveAlertContextReadOnly"]>> =
    options?.alertStatus ?? { status: "active", sessionId: "session-alerted" };
  const repository: SessionRepositoryPort = {
    issue: vi.fn(async (input) => ({ sessionId: input.id })),
    issueForDevice: vi.fn(async (input) => ({
      sessionId: input.id,
      isNewDevice: true,
      notificationScheduled: true,
    })),
    list: vi.fn(async () => options?.sessions ?? [session()]),
    revoke: vi.fn(async () => true),
    revokeOthers: vi.fn(async () => 2),
    rotate: vi.fn(async ({ sessionId }) => ({ sessionId: `${sessionId}-rotated` })),
    findForStepUp: vi.fn(async () =>
      session({ reauthenticatedAt: new Date(now.getTime() - 9 * 60_000) }),
    ),
    markStepUp: vi.fn(async () => true),
    resolveAlertContextReadOnly: vi.fn(async () => alertStatus),
  };
  let idSequence = 0;
  let opaqueSequence = 0;
  const tokens: TokenGenerator = {
    id: vi.fn(() => `session-new-${++idSequence}`),
    opaque: vi.fn(() => `opaque-${++opaqueSequence}`),
    numericCode: vi.fn(() => "12345678"),
    digest: vi.fn((value) => `digest:${value}`),
  };
  return {
    service: new SessionService(repository, tokens, { now: () => now }),
    repository,
    tokens,
  };
}

describe("SessionService", () => {
  it("returns redacted device summaries with current, revoked and expired status", async () => {
    const { service } = setup({
      sessions: [
        session(),
        session({ id: "session-revoked", revokedAt: new Date("2026-08-20T00:00:00.000Z") }),
        session({ id: "session-expired", idleExpiresAt: new Date("2026-08-21T11:59:59.000Z") }),
      ],
    });

    const result = await service.list("user-1", "session-1");

    expect(result.map(({ id, status, isCurrent }) => ({ id, status, isCurrent }))).toEqual([
      { id: "session-1", status: "active", isCurrent: true },
      { id: "session-revoked", status: "revoked", isCurrent: false },
      { id: "session-expired", status: "expired", isCurrent: false },
    ]);
    expect(JSON.stringify(result)).not.toContain("token");
    expect(JSON.stringify(result)).not.toContain("userId");
  });

  it("treats an account with zero sessions as an invariant violation", async () => {
    const { service } = setup({ sessions: [] });
    await expect(service.list("user-1", "session-1")).rejects.toThrow(
      "authenticated user has no sessions",
    );
  });

  it("revokes one session, every other session, and the current session with user binding", async () => {
    const { service, repository } = setup();

    await service.revoke("user-1", "session-2");
    await expect(service.revokeOthers("user-1", "session-1")).resolves.toBe(2);
    await service.logout("user-1", "session-1");

    expect(repository.revoke).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      sessionId: "session-2",
      reason: "user-revoked",
      now,
    });
    expect(repository.revokeOthers).toHaveBeenCalledWith({
      userId: "user-1",
      preservedSessionId: "session-1",
      reason: "user-revoked-others",
      now,
    });
    expect(repository.revoke).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      sessionId: "session-1",
      reason: "logout",
      now,
    });
  });

  it("issues a new-device alert without using IP or user agent as authentication authority", async () => {
    const { service, repository } = setup();

    const result = await service.startDeviceSession({
      userId: "user-1",
      deviceFingerprint: "device-cookie",
      device: {
        label: "Notebook",
        browser: "Chrome",
        operatingSystem: "Linux",
        approximateLocation: "Recife, BR",
        summarizedUserAgent: "Chrome on Linux",
      },
      newDeviceNotification: { recipient: "player@example.com", correlationId: "corr-device" },
    });

    expect(result).toMatchObject({
      sessionId: "session-new-1",
      token: "opaque-1",
      isNewDevice: true,
      notificationScheduled: true,
    });
    expect(repository.issueForDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        token: "opaque-1",
        alertToken: "opaque-2",
        deviceFingerprint: "device-cookie",
      }),
    );
    expect(repository.issueForDevice).not.toHaveBeenCalledWith(
      expect.objectContaining({ authorizedByIp: expect.anything() }),
    );
  });

  it("requires step-up to be strictly newer than ten minutes", async () => {
    const { service, repository } = setup();

    await expect(service.hasFreshStepUp("user-1", "session-1", now)).resolves.toBe(true);
    vi.mocked(repository.findForStepUp).mockResolvedValueOnce(
      session({ reauthenticatedAt: new Date(now.getTime() - 10 * 60_000) }),
    );
    await expect(service.hasFreshStepUp("user-1", "session-1", now)).resolves.toBe(false);
    vi.mocked(repository.findForStepUp).mockResolvedValueOnce(session({}));
    await expect(service.requireFreshStepUp("user-1", "session-1")).rejects.toThrow(
      "recent authentication required",
    );
  });

  it("rotates the current token and revokes others for a sensitive change", async () => {
    const { service, repository } = setup();

    const result = await service.rotateCurrentAndRevokeOthers({
      userId: "user-1",
      sessionId: "session-1",
      reason: "ownership-transfer",
    });

    expect(repository.rotate).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      token: "opaque-1",
      reauthenticatedAt: now,
    });
    expect(repository.revokeOthers).toHaveBeenCalledWith({
      userId: "user-1",
      preservedSessionId: "session-1-rotated",
      reason: "ownership-transfer",
      now,
    });
    expect(result).toEqual({ sessionId: "session-1-rotated", otherSessionsRevoked: 2 });
  });

  it.each([
    [{ status: "active", sessionId: "session-2" } as const, "active"],
    [{ status: "already-revoked", sessionId: "session-2" } as const, "revoked"],
    [{ status: "expired" } as const, "expired"],
    [{ status: "not-found" } as const, "not-found"],
  ])("maps read-only alert context %o to %s", async (repositoryResult, expectedStatus) => {
    const { service, repository, tokens } = setup({ alertStatus: repositoryResult });

    const result = await service.resolveAlertContext("user-1", "raw-alert-context");

    expect(tokens.digest).toHaveBeenCalledWith("raw-alert-context");
    expect(repository.resolveAlertContextReadOnly).toHaveBeenCalledWith({
      actorId: "user-1",
      contextDigest: "digest:raw-alert-context",
      now,
    });
    expect(result).toEqual({ status: expectedStatus });
    expect(repository.revoke).not.toHaveBeenCalled();
    expect(repository.revokeOthers).not.toHaveBeenCalled();
    expect(repository.rotate).not.toHaveBeenCalled();
    expect(repository.markStepUp).not.toHaveBeenCalled();
  });
});
