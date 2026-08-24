import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { REQUIRED_PERMISSION_KEY } from "../authorization/decorators.js";
import type { CsrfService } from "../security/csrf.service.js";
import type { IdentityService } from "./identity.service.js";
import { IdentityManagementController } from "./identity-management.controller.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const proofId = "00000000-0000-4000-8000-000000000003";
const identityId = "00000000-0000-4000-8000-000000000004";

function setup() {
  const identity = {
    listIdentities: vi.fn(async () => [
      {
        id: identityId,
        provider: "discord" as const,
        status: "verified" as const,
        displayIdentifier: "p***r",
        linkedAt: new Date("2026-08-01T12:00:00.000Z"),
      },
    ]),
    confirmIdentityLink: vi.fn(async () => ({
      provider: "discord" as const,
      sessionId,
      sessionToken: "replacement-token",
      otherSessionsRevoked: 2,
    })),
    removeIdentity: vi.fn(async () => ({
      sessionId,
      sessionToken: "replacement-after-remove",
      otherSessionsRevoked: 1,
    })),
  } as unknown as IdentityService;
  const events: string[] = [];
  const csrf = {
    rotateToSession: vi.fn(() => {
      events.push("cookie-then-csrf");
      return { csrfToken: "rotated" };
    }),
  } as unknown as CsrfService;
  const controller = new IdentityManagementController(identity, csrf);
  const request = {
    auth: { actorId, sessionId, trust: "trusted" },
    cookies: { "__Host-session": "old-token" },
  } as unknown as FastifyRequest & {
    auth: { actorId: string; sessionId: string; trust: "trusted" };
  };
  const reply = {} as FastifyReply;
  return { controller, identity, csrf, request, reply, events };
}

describe("IdentityManagementController", () => {
  it("protects every handler with authenticated permission metadata", () => {
    for (const handler of ["list", "confirmLink", "remove"] as const) {
      expect(
        Reflect.getMetadata(
          REQUIRED_PERMISSION_KEY,
          IdentityManagementController.prototype[handler],
        ),
      ).toBe("authenticated");
    }
  });

  it("lists only redacted allowlisted identity fields for request.auth.actorId", async () => {
    const { controller, identity, request } = setup();

    const result = await controller.list(request);

    expect(identity.listIdentities).toHaveBeenCalledWith(actorId);
    expect(result.identities).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/providerSubject|email|digest|token|credential/i);
  });

  it("calls the atomic bound command once and publishes replacement credentials after commit", async () => {
    const { controller, identity, csrf, request, reply, events } = setup();
    vi.mocked(identity.confirmIdentityLink).mockImplementationOnce(async () => {
      events.push("command-committed");
      return {
        provider: "discord",
        sessionId,
        sessionToken: "replacement-token",
        otherSessionsRevoked: 2,
      };
    });

    const result = await controller.confirmLink(
      { candidateIdentityId: proofId, confirmation: true },
      request,
      reply,
      "correlation-1",
    );

    expect(identity.confirmIdentityLink).toHaveBeenCalledTimes(1);
    expect(identity.confirmIdentityLink).toHaveBeenCalledWith({
      actorId,
      sessionId,
      proofId,
      correlationId: "correlation-1",
    });
    expect(events).toEqual(["command-committed", "cookie-then-csrf"]);
    expect(csrf.rotateToSession).toHaveBeenCalledWith(
      request,
      reply,
      sessionId,
      "replacement-token",
    );
    expect(result).toEqual({ status: "linked", provider: "discord", otherSessionsRevoked: 2 });
    expect(JSON.stringify(result)).not.toContain("replacement-token");
  });

  it("rejects actor, user, session and trust smuggling before the service", async () => {
    const { controller, identity, request, reply } = setup();

    await expect(
      controller.confirmLink(
        {
          candidateIdentityId: proofId,
          confirmation: true,
          actorId,
          userId: actorId,
          sessionId,
          trust: "trusted",
        },
        request,
        reply,
        "correlation-1",
      ),
    ).rejects.toThrow();
    expect(identity.confirmIdentityLink).not.toHaveBeenCalled();
  });

  it.each(["stale proof", "proof replay", "cross-session proof", "stale step-up"])(
    "does not touch response credentials when link confirmation rejects %s",
    async (message) => {
      const { controller, identity, csrf, request, reply } = setup();
      vi.mocked(identity.confirmIdentityLink).mockRejectedValueOnce(new Error(message));

      await expect(
        controller.confirmLink(
          { candidateIdentityId: proofId, confirmation: true },
          request,
          reply,
          "correlation-1",
        ),
      ).rejects.toThrow(message);
      expect(csrf.rotateToSession).not.toHaveBeenCalled();
    },
  );

  it("requires route and body identity IDs to agree", async () => {
    const { controller, identity, request, reply } = setup();

    await expect(
      controller.remove(identityId, { identityId: proofId }, request, reply, "correlation-2"),
    ).rejects.toThrow();
    expect(identity.removeIdentity).not.toHaveBeenCalled();
  });

  it.each(["identity not found", "last verified identity", "stale step-up"])(
    "rejects %s without rotating response credentials",
    async (message) => {
      const { controller, identity, csrf, request, reply } = setup();
      vi.mocked(identity.removeIdentity).mockRejectedValueOnce(new Error(message));

      await expect(
        controller.remove(identityId, { identityId }, request, reply, "correlation-2"),
      ).rejects.toThrow(message);
      expect(identity.removeIdentity).toHaveBeenCalledWith({
        actorId,
        sessionId,
        identityId,
        correlationId: "correlation-2",
      });
      expect(csrf.rotateToSession).not.toHaveBeenCalled();
    },
  );

  it("rotates the current session only after an owner-scoped removal completes", async () => {
    const { controller, identity, csrf, request, reply, events } = setup();
    vi.mocked(identity.removeIdentity).mockImplementationOnce(async () => {
      events.push("identity-removed");
      return {
        sessionId,
        sessionToken: "replacement-after-remove",
        otherSessionsRevoked: 1,
      };
    });

    await expect(
      controller.remove(identityId, { identityId }, request, reply, "correlation-2"),
    ).resolves.toEqual({ status: "removed" });
    expect(events).toEqual(["identity-removed", "cookie-then-csrf"]);
    expect(csrf.rotateToSession).toHaveBeenCalledWith(
      request,
      reply,
      sessionId,
      "replacement-after-remove",
    );
  });
});
