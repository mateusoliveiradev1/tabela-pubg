import { describe, expect, it } from "vitest";
import {
  CreateOrganizationRequestSchema,
  InvitationPreviewResponseSchema,
  MembershipListResponseSchema,
  UpdateMembershipRequestSchema,
} from "./organizations.js";

const organizationId = "018f0ce7-98e3-7b27-bf2d-6eeac51d2320";
const membershipId = "018f0ce7-98e3-7b27-bf2d-6eeac51d2321";
const userId = "018f0ce7-98e3-7b27-bf2d-6eeac51d2322";
const scopeId = "018f0ce7-98e3-7b27-bf2d-6eeac51d2323";

describe("organization contracts", () => {
  it("accepts bounded organization input and rejects unknown fields", () => {
    expect(CreateOrganizationRequestSchema.safeParse({ name: "Camps da Comunidade" }).success).toBe(
      true,
    );
    expect(
      CreateOrganizationRequestSchema.safeParse({
        name: "Camps da Comunidade",
        ownerId: userId,
      }).success,
    ).toBe(false);
  });

  it("represents every invitation UI state without returning its token", () => {
    const invitations = [
      {
        status: "valid",
        organization: { id: organizationId, name: "Camps da Comunidade", logoUrl: null },
        invitedBy: "Organizador",
        maskedEmail: "m•••@example.com",
        organizationRole: "member",
        assignments: [],
        expiresAt: "2026-08-27T12:00:00.000Z",
        emailMatches: true,
      },
      { status: "expired" },
      { status: "revoked" },
      { status: "used", organizationSlug: "camps-da-comunidade" },
      { status: "invalid" },
    ] as const;

    for (const invitation of invitations) {
      expect(InvitationPreviewResponseSchema.safeParse(invitation).success).toBe(true);
    }

    expect(
      InvitationPreviewResponseSchema.safeParse({
        ...invitations[0],
        invitationToken: "opaque-secret",
      }).success,
    ).toBe(false);
  });

  it("keeps organization roles separate from tournament assignments", () => {
    const result = MembershipListResponseSchema.safeParse({
      members: [
        {
          id: membershipId,
          user: {
            id: userId,
            displayName: "Mateus",
            maskedEmail: "m•••@example.com",
          },
          organizationRole: "member",
          status: "active",
          assignments: [
            {
              authorizationScopeId: scopeId,
              scopeName: "Final",
              role: "broadcast",
            },
          ],
          joinedAt: "2026-08-20T12:00:00.000Z",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(
      UpdateMembershipRequestSchema.safeParse({
        organizationRole: "admin",
        assignments: [
          {
            authorizationScopeId: scopeId,
            role: "broadcast",
          },
        ],
        reason: "Reorganização da equipe",
      }).success,
    ).toBe(true);
  });
});
