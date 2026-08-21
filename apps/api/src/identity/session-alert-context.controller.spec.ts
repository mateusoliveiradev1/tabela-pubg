import { describe, expect, it, vi } from "vitest";
import {
  SessionAlertContextController,
  type SessionAlertRequest,
} from "./identity.controller.js";
import type { SessionService } from "./session.service.js";

describe("SessionAlertContextController", () => {
  it.each(["active", "revoked", "expired", "not-found"] as const)(
    "returns %s from the authenticated actor without mutating state",
    async (status) => {
      const session = {
        resolveAlertContext: vi.fn(async () => ({ status })),
        revoke: vi.fn(),
        revokeOthers: vi.fn(),
        logout: vi.fn(),
        rotateCurrentAndRevokeOthers: vi.fn(),
      } as unknown as SessionService;
      const controller = new SessionAlertContextController(session);
      const request = { auth: { actorId: "user-a", sessionId: "session-a" } } as SessionAlertRequest;

      const result = await controller.resolve({ context: "opaque-alert-context" }, request);

      expect(result).toEqual({ status });
      expect(session.resolveAlertContext).toHaveBeenCalledWith("user-a", "opaque-alert-context");
      expect(session.revoke).not.toHaveBeenCalled();
      expect(session.revokeOthers).not.toHaveBeenCalled();
      expect(session.logout).not.toHaveBeenCalled();
      expect(session.rotateCurrentAndRevokeOthers).not.toHaveBeenCalled();
    },
  );

  it("rejects actor/session fields instead of trusting query input", async () => {
    const session = { resolveAlertContext: vi.fn() } as unknown as SessionService;
    const controller = new SessionAlertContextController(session);
    const request = { auth: { actorId: "user-a", sessionId: "session-a" } } as SessionAlertRequest;

    await expect(
      controller.resolve(
        { context: "opaque-alert-context", actorId: "user-b" } as never,
        request,
      ),
    ).rejects.toThrow();
    expect(session.resolveAlertContext).not.toHaveBeenCalled();
  });
});
