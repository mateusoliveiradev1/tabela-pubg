import type { CreateOrganizationRequest, OrganizationSummary } from "@pubg-camp/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenGenerator } from "../identity/ports/token-generator.js";
import { type InvitationRepositoryPort, InvitationsService } from "./invitations.service.js";
import { type OrganizationRepositoryPort, OrganizationsService } from "./organizations.service.js";

const actorId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const membershipId = "33333333-3333-4333-8333-333333333333";
const invitationId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-08-21T12:00:00.000Z");

function ownerSummary(id: string, name: string): OrganizationSummary {
  return {
    id,
    slug: `${name.toLowerCase().replaceAll(" ", "-")}-camp`,
    name,
    logoUrl: null,
    membershipRole: "owner",
  };
}

function tokenGenerator(): TokenGenerator {
  let id = 0;
  return {
    id: vi.fn(() => {
      id += 1;
      return `${`${id}`.padStart(8, "0")}-0000-4000-8000-000000000000`;
    }),
    opaque: vi.fn((bytes) => `opaque-${bytes}-bytes`),
    numericCode: vi.fn(() => "12345678"),
    digest: vi.fn((value) => `digest:${value}`),
  };
}

describe("OrganizationsService", () => {
  let repository: OrganizationRepositoryPort;
  let service: OrganizationsService;

  beforeEach(() => {
    repository = {
      create: vi.fn(async (input) => ownerSummary(input.id, input.name)),
      listForUser: vi.fn(async () => []),
    };
    service = new OrganizationsService(repository, tokenGenerator(), { now: () => now });
  });

  it("creates independent owner memberships and never stores an implicit active organization", async () => {
    const first = await service.create({
      actorId,
      body: { name: "Arena Alpha" },
      correlationId: "55555555-5555-4555-8555-555555555555",
    });
    const second = await service.create({
      actorId,
      body: { name: "Arena Bravo" },
      correlationId: "66666666-6666-4666-8666-666666666666",
    });

    expect(first.organization.membershipRole).toBe("owner");
    expect(second.organization.membershipRole).toBe("owner");
    expect(repository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actorId, name: "Arena Alpha" }),
    );
    expect(repository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actorId, name: "Arena Bravo" }),
    );
    expect(first.organization.id).not.toBe(second.organization.id);
  });

  it("validates organization input before opening a repository transaction", async () => {
    await expect(
      service.create({
        actorId,
        body: { name: "x" } as CreateOrganizationRequest,
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("lists every membership for the actor without selecting one as active", async () => {
    vi.mocked(repository.listForUser).mockResolvedValueOnce([
      ownerSummary(organizationId, "Arena Alpha"),
      {
        ...ownerSummary("77777777-7777-4777-8777-777777777777", "Arena Bravo"),
        membershipRole: "admin",
      },
    ]);

    const result = await service.list(actorId);

    expect(result.organizations).toHaveLength(2);
    expect(repository.listForUser).toHaveBeenCalledWith(actorId);
    expect(result).not.toHaveProperty("activeOrganizationId");
  });
});

describe("InvitationsService", () => {
  let repository: InvitationRepositoryPort;
  let service: InvitationsService;

  beforeEach(() => {
    repository = {
      createWithDelivery: vi.fn(async () => ({
        invitationId,
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      })),
      resendWithDelivery: vi.fn(async () => ({
        invitationId,
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      })),
      revoke: vi.fn(async () => true),
      preview: vi.fn(async () => ({ status: "invalid" as const })),
      accept: vi.fn(async () => ({ status: "unavailable" as const })),
      list: vi.fn(async () => []),
    };
    service = new InvitationsService(repository, tokenGenerator(), { now: () => now });
  });

  it("uses a 256-bit one-use token and schedules encrypted delivery atomically", async () => {
    await service.create({
      actorId,
      organizationId,
      body: { email: "PLAYER@EXAMPLE.COM", organizationRole: "admin", assignments: [] },
      correlationId: "55555555-5555-4555-8555-555555555555",
    });

    expect(repository.createWithDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        organizationId,
        email: "player@example.com",
        token: "opaque-32-bytes",
        occurredAt: now,
      }),
    );
  });

  it("resend creates a fresh token and delegates supersession plus delivery to one transaction", async () => {
    await service.resend({
      actorId,
      organizationId,
      invitationId,
      reason: "Equipe de transmissão atualizada",
      correlationId: "55555555-5555-4555-8555-555555555555",
    });

    expect(repository.resendWithDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ token: "opaque-32-bytes", previousInvitationId: invitationId }),
    );
  });

  it("accepts only the repository's exact verified-email single-use result", async () => {
    vi.mocked(repository.accept).mockResolvedValueOnce({
      status: "accepted",
      organization: ownerSummary(organizationId, "Arena Alpha"),
      membership: {
        id: membershipId,
        user: { id: actorId, displayName: "Player", maskedEmail: "p***@example.com" },
        organizationRole: "admin",
        status: "active",
        assignments: [],
        joinedAt: now.toISOString(),
      },
    });

    const result = await service.accept({
      actorId,
      token: "one-use-token",
      confirmation: true,
      correlationId: "55555555-5555-4555-8555-555555555555",
    });

    expect(result.status).toBe("accepted");
    expect(repository.accept).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, token: "one-use-token" }),
    );
  });

  it("does not expose invitation tokens from create, resend or list responses", async () => {
    const created = await service.create({
      actorId,
      organizationId,
      body: { email: "player@example.com", organizationRole: "member", assignments: [] },
      correlationId: "55555555-5555-4555-8555-555555555555",
    });
    const resent = await service.resend({
      actorId,
      organizationId,
      invitationId,
      reason: "Reenvio solicitado pelo destinatário",
      correlationId: "55555555-5555-4555-8555-555555555555",
    });
    const listed = await service.list(actorId, organizationId);

    expect(JSON.stringify({ created, resent, listed })).not.toContain("opaque-32-bytes");
  });
});
