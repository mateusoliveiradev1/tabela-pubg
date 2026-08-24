import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { REQUIRED_PERMISSION_KEY } from "../authorization/decorators.js";
import type { CsrfService } from "../security/csrf.service.js";
import { SessionController } from "./session.controller.js";
import type { SessionService } from "./session.service.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const currentSessionId = "00000000-0000-4000-8000-000000000002";
const otherSessionId = "00000000-0000-4000-8000-000000000003";

function setup() {
  const sessions = {
    list: vi.fn(async () => [
      {
        id: currentSessionId,
        device: { label: "Desktop", browser: "Firefox", operatingSystem: "Windows" },
        approximateLocation: null,
        createdAt: new Date("2026-08-01T12:00:00.000Z"),
        lastSeenAt: new Date("2026-08-24T12:00:00.000Z"),
        idleExpiresAt: new Date("2026-09-23T12:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-11-22T12:00:00.000Z"),
        isCurrent: true,
        status: "active" as const,
      },
    ]),
    revoke: vi.fn(async () => undefined),
    revokeOthers: vi.fn(async () => 2),
    logout: vi.fn(async () => undefined),
  } as unknown as SessionService;
  const csrf = {
    invalidate: vi.fn(),
  } as unknown as CsrfService;
  const controller = new SessionController(sessions, csrf);
  const request = {
    auth: { actorId, sessionId: currentSessionId, trust: "trusted" },
    cookies: { "__Host-session": "opaque-current" },
  } as unknown as FastifyRequest & {
    auth: { actorId: string; sessionId: string; trust: "trusted" };
  };
  const reply = {} as FastifyReply;
  return { controller, sessions, csrf, request, reply };
}

describe("SessionController", () => {
  it("protects every handler with authenticated permission metadata", () => {
    for (const handler of ["list", "revoke", "revokeOthers", "logout"] as const) {
      expect(
        Reflect.getMetadata(REQUIRED_PERMISSION_KEY, SessionController.prototype[handler]),
      ).toBe("authenticated");
    }
  });

  it("lists redacted sessions and marks the request.auth session as current", async () => {
    const { controller, sessions, request } = setup();

    const result = await controller.list(request);

    expect(sessions.list).toHaveBeenCalledWith(actorId, currentSessionId);
    expect(result.sessions[0]).toMatchObject({ id: currentSessionId, isCurrent: true });
    expect(JSON.stringify(result)).not.toMatch(/token|digest|userId/i);
  });

  it("revokes only an actor-owned target and rejects route/body disagreement", async () => {
    const { controller, sessions, csrf, request, reply } = setup();

    await expect(
      controller.revoke(otherSessionId, { sessionId: otherSessionId }, request, reply),
    ).resolves.toEqual({ status: "revoked", revokedSessionId: otherSessionId });
    expect(sessions.revoke).toHaveBeenCalledWith(actorId, otherSessionId);
    expect(csrf.invalidate).not.toHaveBeenCalled();

    await expect(
      controller.revoke(otherSessionId, { sessionId: currentSessionId }, request, reply),
    ).rejects.toThrow();
    expect(sessions.revoke).toHaveBeenCalledTimes(1);
  });

  it("clears session and CSRF lifecycle when the current target is revoked", async () => {
    const { controller, csrf, request, reply } = setup();

    await controller.revoke(currentSessionId, { sessionId: currentSessionId }, request, reply);

    expect(csrf.invalidate).toHaveBeenCalledOnce();
    expect(csrf.invalidate).toHaveBeenCalledWith(request, reply);
  });

  it("revokes every other session while preserving the current one", async () => {
    const { controller, sessions, csrf, request } = setup();

    await expect(controller.revokeOthers({}, request)).resolves.toEqual({
      status: "revoked",
      revokedCount: 2,
    });
    expect(sessions.revokeOthers).toHaveBeenCalledWith(actorId, currentSessionId);
    expect(csrf.invalidate).not.toHaveBeenCalled();
  });

  it("logs out request.auth current session before clearing all auth cookies", async () => {
    const { controller, sessions, csrf, request, reply } = setup();
    const events: string[] = [];
    vi.mocked(sessions.logout).mockImplementationOnce(async () => {
      events.push("revoked");
    });
    vi.mocked(csrf.invalidate).mockImplementationOnce(() => {
      events.push("cookies-cleared");
    });

    const result = await controller.logout({}, request, reply);

    expect(sessions.logout).toHaveBeenCalledWith(actorId, currentSessionId);
    expect(events).toEqual(["revoked", "cookies-cleared"]);
    expect(result).toEqual({ status: "revoked", revokedSessionId: currentSessionId });
  });

  it("rejects browser-supplied authority fields even on targetless commands", async () => {
    const { controller, sessions, request, reply } = setup();

    await expect(
      controller.logout({ actorId, sessionId: otherSessionId }, request, reply),
    ).rejects.toThrow();
    expect(sessions.logout).not.toHaveBeenCalled();
  });
});
