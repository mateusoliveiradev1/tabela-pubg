import { describe, expect, it, vi } from "vitest";
import type { InvitationRepositoryPort } from "./invitations.service.js";
import { InvitationsService } from "./invitations.service.js";

const now = new Date("2026-08-21T12:00:00.000Z");

describe("invitation delivery transaction boundary", () => {
  it("surfaces delivery failure and never reports an accepted create", async () => {
    const repository: InvitationRepositoryPort = {
      createWithDelivery: vi.fn(async () => {
        throw new Error("encrypted delivery insert failed; transaction rolled back");
      }),
      resendWithDelivery: vi.fn(async () => {
        throw new Error("not used");
      }),
      revoke: vi.fn(async () => false),
      preview: vi.fn(async () => ({ status: "invalid" as const })),
      accept: vi.fn(async () => ({ status: "unavailable" as const })),
      list: vi.fn(async () => []),
    };
    const service = new InvitationsService(
      repository,
      {
        id: () => "11111111-1111-4111-8111-111111111111",
        opaque: () => "secret-invitation-token",
        numericCode: () => "12345678",
        digest: (value) => value,
      },
      { now: () => now },
    );

    await expect(
      service.create({
        actorId: "22222222-2222-4222-8222-222222222222",
        organizationId: "33333333-3333-4333-8333-333333333333",
        body: { email: "player@example.com", organizationRole: "member", assignments: [] },
        correlationId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toThrow("transaction rolled back");
  });

  it("keeps retry identity on the delivery instead of minting another invitation", async () => {
    const createWithDelivery = vi.fn(async () => ({
      invitationId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    }));
    const repository: InvitationRepositoryPort = {
      createWithDelivery,
      resendWithDelivery: vi.fn(async () => {
        throw new Error("not used");
      }),
      revoke: vi.fn(async () => false),
      preview: vi.fn(async () => ({ status: "invalid" as const })),
      accept: vi.fn(async () => ({ status: "unavailable" as const })),
      list: vi.fn(async () => []),
    };
    const service = new InvitationsService(
      repository,
      {
        id: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
        opaque: () => "secret-invitation-token",
        numericCode: () => "12345678",
        digest: (value) => value,
      },
      { now: () => now },
    );

    await service.create({
      actorId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      body: { email: "player@example.com", organizationRole: "member", assignments: [] },
      correlationId: "44444444-4444-4444-8444-444444444444",
    });

    expect(createWithDelivery).toHaveBeenCalledTimes(1);
    expect(createWithDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: expect.any(String), invitationId: expect.any(String) }),
    );
  });
});
