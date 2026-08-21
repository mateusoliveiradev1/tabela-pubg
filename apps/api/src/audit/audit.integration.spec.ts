import type { AuditEventPage } from "@pubg-camp/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AuditRepositoryPort,
  AuditService,
  projectAuditChanges,
} from "./audit.service.js";

const actorId = "11111111-1111-4111-8111-111111111111";
const otherActorId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";

function page(visibility: "all" | "self"): AuditEventPage {
  return {
    visibility,
    events: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        actor: { displayName: "Organizador", maskedEmail: "o***@example.com" },
        action: "membership.roles.updated",
        targetLabel: "Membro",
        scopeLabel: "Arena Alpha",
        authorizationScopeId: null,
        correlationId: "55555555-5555-4555-8555-555555555555",
        reason: "Responsabilidades operacionais atualizadas",
        occurredAt: "2026-08-21T12:00:00.000Z",
        changes: [{ field: "organizationRole", before: "member", after: "admin" }],
      },
    ],
    page: 1,
    pageSize: 25,
    total: 1,
    totalPages: 1,
  };
}

describe("AuditService", () => {
  let repository: AuditRepositoryPort;
  let service: AuditService;

  beforeEach(() => {
    repository = {
      resolveVisibility: vi.fn(async () => "all" as const),
      query: vi.fn(async (input) => page(input.visibility)),
    };
    service = new AuditService(repository);
  });

  it("allows owner/admin organization-wide visibility and allowlisted actor filters", async () => {
    const result = await service.query(actorId, {
      organizationId,
      visibility: "all",
      actorId: otherActorId,
      page: 1,
      pageSize: 25,
    });

    expect(result.visibility).toBe("all");
    expect(repository.query).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "all", actorId: otherActorId }),
    );
  });

  it("forces regular members to self-only even when the client requests another actor", async () => {
    vi.mocked(repository.resolveVisibility).mockResolvedValueOnce("self");

    const result = await service.query(actorId, {
      organizationId,
      visibility: "all",
      actorId: otherActorId,
      page: 1,
      pageSize: 25,
    });

    expect(result.visibility).toBe("self");
    expect(repository.query).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "self", actorId }),
    );
  });

  it("rejects cross-organization viewers uniformly before querying events", async () => {
    vi.mocked(repository.resolveVisibility).mockResolvedValueOnce(null);

    await expect(
      service.query(actorId, {
        organizationId,
        visibility: "self",
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toThrow("audit unavailable");
    expect(repository.query).not.toHaveBeenCalled();
  });
});

describe("audit redacted projection", () => {
  it("emits allowlisted before/after pairs and removes secrets, complete email and ciphertext", () => {
    const changes = projectAuditChanges(
      {
        organizationRole: "member",
        token: "secret-token",
        emailAddress: "full@example.com",
        payloadCiphertext: "ciphertext",
      },
      {
        organizationRole: "admin",
        cookie: "session-cookie",
        operationalRoles: "arena:broadcast",
      },
    );

    expect(changes).toEqual([
      { field: "organizationRole", before: "member", after: "admin" },
      { field: "operationalRoles", before: null, after: "arena:broadcast" },
    ]);
    expect(JSON.stringify(changes)).not.toMatch(/secret-token|full@example|ciphertext|session-cookie/);
  });
});
