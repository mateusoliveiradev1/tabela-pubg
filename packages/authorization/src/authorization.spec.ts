import type { AuthorizationScopeId, OrganizationId, UserId } from "@pubg-camp/domain";
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  type AuthorizationSnapshot,
  can,
  type OperationalRole,
  type OrganizationRole,
  type Permission,
} from "./index.js";

const actorId = "user-1" as UserId;
const organizationId = "organization-1" as OrganizationId;
const tournamentId = "tournament-1" as AuthorizationScopeId;

const organizationPermissions = [
  "organization:read",
  "organization:settings:manage",
  "organization:members:manage",
  "organization:roles:manage",
  "organization:ownership:transfer",
  "organization:audit:read",
  "organization:audit:self:read",
] as const satisfies readonly Permission[];

const tournamentPermissions = [
  "tournament:competition:read",
  "tournament:competition:manage",
  "tournament:registrations:read",
  "tournament:registrations:manage",
  "tournament:broadcast:read",
  "tournament:broadcast:manage",
  "tournament:statistics:read",
  "tournament:statistics:export",
] as const satisfies readonly Permission[];

function snapshot(overrides: Partial<AuthorizationSnapshot> = {}): AuthorizationSnapshot {
  return {
    actorId,
    organizationId,
    membershipStatus: "active",
    organizationRole: null,
    assignments: [],
    ...overrides,
  };
}

function decision(permission: Permission, authorizationSnapshot: AuthorizationSnapshot) {
  return can(
    {
      actorId,
      organizationId,
      permission,
      ...(permission.startsWith("tournament:") ? { authorizationScopeId: tournamentId } : {}),
    },
    authorizationSnapshot,
  );
}

describe("organization roles", () => {
  const matrix: Readonly<Record<OrganizationRole, readonly Permission[]>> = {
    owner: ALL_PERMISSIONS,
    admin: ALL_PERMISSIONS.filter((permission) => permission !== "organization:ownership:transfer"),
  };

  for (const [role, allowed] of Object.entries(matrix) as [
    OrganizationRole,
    readonly Permission[],
  ][]) {
    it(`enumerates every permission for ${role}`, () => {
      const authorizationSnapshot = snapshot({ organizationRole: role });

      for (const permission of ALL_PERMISSIONS) {
        expect(decision(permission, authorizationSnapshot), permission).toBe(
          allowed.includes(permission),
        );
      }
    });
  }

  it("requires explicit tournament scope even for owner and admin", () => {
    const authorizationSnapshot = snapshot({ organizationRole: "owner" });

    expect(
      can(
        {
          actorId,
          organizationId,
          permission: "tournament:competition:manage",
        },
        authorizationSnapshot,
      ),
    ).toBe(false);
  });

  it("denies organization permissions when a tournament scope is supplied", () => {
    const authorizationSnapshot = snapshot({ organizationRole: "owner" });

    expect(
      can(
        {
          actorId,
          organizationId,
          authorizationScopeId: tournamentId,
          permission: "organization:settings:manage",
        },
        authorizationSnapshot,
      ),
    ).toBe(false);
  });
});

describe("operational roles", () => {
  const matrix: Readonly<Record<OperationalRole, readonly Permission[]>> = {
    referee: [
      "organization:read",
      "organization:audit:self:read",
      "tournament:competition:read",
      "tournament:competition:manage",
      "tournament:statistics:read",
    ],
    registrations: [
      "organization:read",
      "organization:audit:self:read",
      "tournament:registrations:read",
      "tournament:registrations:manage",
      "tournament:statistics:read",
    ],
    broadcast: [
      "organization:read",
      "organization:audit:self:read",
      "tournament:broadcast:read",
      "tournament:broadcast:manage",
      "tournament:statistics:read",
    ],
    analyst: [
      "organization:read",
      "organization:audit:self:read",
      "tournament:competition:read",
      "tournament:registrations:read",
      "tournament:broadcast:read",
      "tournament:statistics:read",
      "tournament:statistics:export",
    ],
  };

  for (const [role, allowed] of Object.entries(matrix) as [
    OperationalRole,
    readonly Permission[],
  ][]) {
    it(`enumerates every permission for ${role}`, () => {
      const authorizationSnapshot = snapshot({
        assignments: [
          {
            organizationId,
            authorizationScopeId: tournamentId,
            role,
            status: "active",
          },
        ],
      });

      for (const permission of ALL_PERMISSIONS) {
        expect(decision(permission, authorizationSnapshot), permission).toBe(
          allowed.includes(permission),
        );
      }
    });
  }

  it("forms a strict union of accumulated roles", () => {
    const authorizationSnapshot = snapshot({
      assignments: [
        {
          organizationId,
          authorizationScopeId: tournamentId,
          role: "referee",
          status: "active",
        },
        {
          organizationId,
          authorizationScopeId: tournamentId,
          role: "broadcast",
          status: "active",
        },
      ],
    });

    expect(decision("tournament:competition:manage", authorizationSnapshot)).toBe(true);
    expect(decision("tournament:broadcast:manage", authorizationSnapshot)).toBe(true);
    expect(decision("tournament:registrations:manage", authorizationSnapshot)).toBe(false);
  });

  it("removes only a revoked role without promoting remaining roles", () => {
    const authorizationSnapshot = snapshot({
      assignments: [
        {
          organizationId,
          authorizationScopeId: tournamentId,
          role: "referee",
          status: "revoked",
        },
        {
          organizationId,
          authorizationScopeId: tournamentId,
          role: "broadcast",
          status: "active",
        },
      ],
    });

    expect(decision("tournament:competition:manage", authorizationSnapshot)).toBe(false);
    expect(decision("tournament:broadcast:manage", authorizationSnapshot)).toBe(true);
    expect(decision("tournament:statistics:export", authorizationSnapshot)).toBe(false);
  });
});

describe("default deny boundaries", () => {
  const refereeSnapshot = snapshot({
    assignments: [
      {
        organizationId,
        authorizationScopeId: tournamentId,
        role: "referee",
        status: "active",
      },
    ],
  });

  it("denies mismatched actor, organization, scope and inactive membership", () => {
    expect(
      can(
        {
          actorId: "another-user" as UserId,
          organizationId,
          authorizationScopeId: tournamentId,
          permission: "tournament:competition:manage",
        },
        refereeSnapshot,
      ),
    ).toBe(false);
    expect(
      can(
        {
          actorId,
          organizationId: "another-org" as OrganizationId,
          authorizationScopeId: tournamentId,
          permission: "tournament:competition:manage",
        },
        refereeSnapshot,
      ),
    ).toBe(false);
    expect(
      can(
        {
          actorId,
          organizationId,
          authorizationScopeId: "another-tournament" as AuthorizationScopeId,
          permission: "tournament:competition:manage",
        },
        refereeSnapshot,
      ),
    ).toBe(false);
    expect(
      decision(
        "tournament:competition:manage",
        snapshot({
          membershipStatus: "revoked",
          assignments: refereeSnapshot.assignments,
        }),
      ),
    ).toBe(false);
  });

  it("denies assignments belonging to another organization", () => {
    const crossTenantSnapshot = snapshot({
      assignments: [
        {
          organizationId: "another-org" as OrganizationId,
          authorizationScopeId: tournamentId,
          role: "referee",
          status: "active",
        },
      ],
    });

    expect(decision("tournament:competition:manage", crossTenantSnapshot)).toBe(false);
  });

  it("denies unknown permission and roles at runtime", () => {
    expect(
      can(
        {
          actorId,
          organizationId,
          permission: "organization:*" as Permission,
        },
        snapshot({ organizationRole: "owner" }),
      ),
    ).toBe(false);
    expect(
      can(
        {
          actorId,
          organizationId,
          permission: "organization:settings:manage",
        },
        snapshot({ organizationRole: "super-admin" as OrganizationRole }),
      ),
    ).toBe(false);
    expect(
      decision(
        "tournament:competition:manage",
        snapshot({
          assignments: [
            {
              organizationId,
              authorizationScopeId: tournamentId,
              role: "operator" as OperationalRole,
              status: "active",
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe("active organization membership", () => {
  it("grants only the explicit baseline read permissions without requiring a role assignment", () => {
    const activeMember = snapshot();

    expect(decision("organization:read", activeMember)).toBe(true);
    expect(decision("organization:audit:self:read", activeMember)).toBe(true);
    expect(decision("organization:settings:manage", activeMember)).toBe(false);
  });

  it("revokes baseline read permissions with the membership", () => {
    const revokedMember = snapshot({ membershipStatus: "revoked" });

    expect(decision("organization:read", revokedMember)).toBe(false);
    expect(decision("organization:audit:self:read", revokedMember)).toBe(false);
  });
});

describe("permission vocabulary", () => {
  it("covers organization and tournament permissions without wildcards", () => {
    expect(ALL_PERMISSIONS).toEqual([...organizationPermissions, ...tournamentPermissions]);
    expect(ALL_PERMISSIONS.every((permission) => !permission.includes("*"))).toBe(true);
  });
});
