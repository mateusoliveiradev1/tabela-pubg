import { describe, expect, it } from "vitest";
import { AuditEventPageSchema, AuditQuerySchema } from "./audit.js";

const organizationId = "018f0ce7-98e3-7b27-bf2d-6eeac51d2340";

describe("audit contracts", () => {
  it("accepts an explicit, bounded paginated query", () => {
    expect(
      AuditQuerySchema.safeParse({
        organizationId,
        visibility: "all",
        page: 1,
        pageSize: 25,
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-20T23:59:59.000Z",
      }).success,
    ).toBe(true);

    expect(
      AuditQuerySchema.safeParse({
        organizationId,
        visibility: "all",
        page: 1,
        pageSize: 500,
      }).success,
    ).toBe(false);
  });

  it("allows only redacted audit projections", () => {
    const event = {
      id: "018f0ce7-98e3-7b27-bf2d-6eeac51d2341",
      actor: {
        displayName: "Mateus",
        maskedEmail: "m•••@example.com",
      },
      action: "membership.roles.updated",
      targetLabel: "Membro da organização",
      scopeLabel: "Camps da Comunidade",
      reason: "Reorganização da equipe",
      occurredAt: "2026-08-20T12:00:00.000Z",
      changes: [
        {
          field: "organizationRole",
          before: "member",
          after: "admin",
        },
      ],
    };

    expect(
      AuditEventPageSchema.safeParse({
        visibility: "all",
        events: [event],
        page: 1,
        pageSize: 25,
        total: 1,
        totalPages: 1,
      }).success,
    ).toBe(true);

    expect(
      AuditEventPageSchema.safeParse({
        visibility: "all",
        events: [
          {
            ...event,
            actor: {
              displayName: "Mateus",
              maskedEmail: "mateus@example.com",
            },
            ciphertext: "encrypted-payload",
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
        totalPages: 1,
      }).success,
    ).toBe(false);
  });
});
