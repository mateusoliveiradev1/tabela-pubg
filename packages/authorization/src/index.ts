import type { AuthorizationScopeId, OrganizationId, UserId } from "@pubg-camp/domain";

export const ALL_PERMISSIONS = [
  "organization:settings:manage",
  "organization:members:manage",
  "organization:roles:manage",
  "organization:ownership:transfer",
  "organization:audit:read",
  "organization:audit:self:read",
  "tournament:competition:read",
  "tournament:competition:manage",
  "tournament:registrations:read",
  "tournament:registrations:manage",
  "tournament:broadcast:read",
  "tournament:broadcast:manage",
  "tournament:statistics:read",
  "tournament:statistics:export",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];
export type OrganizationRole = "owner" | "admin";
export type OperationalRole = "referee" | "registrations" | "broadcast" | "analyst";
export type AuthorizationStatus = "active" | "revoked";

export interface AuthorizationInput {
  readonly actorId: UserId;
  readonly organizationId: OrganizationId;
  readonly authorizationScopeId?: AuthorizationScopeId;
  readonly permission: Permission;
}

export interface OperationalRoleAssignment {
  readonly organizationId: OrganizationId;
  readonly authorizationScopeId: AuthorizationScopeId;
  readonly role: OperationalRole;
  readonly status: AuthorizationStatus;
}

export interface AuthorizationSnapshot {
  readonly actorId: UserId;
  readonly organizationId: OrganizationId;
  readonly membershipStatus: AuthorizationStatus;
  readonly organizationRole: OrganizationRole | null;
  readonly assignments: readonly OperationalRoleAssignment[];
}

const permissionSet: ReadonlySet<Permission> = new Set(ALL_PERMISSIONS);
const organizationPermissionSet: ReadonlySet<Permission> = new Set(
  ALL_PERMISSIONS.filter((permission) => permission.startsWith("organization:")),
);

const organizationRoles: ReadonlySet<OrganizationRole> = new Set(["owner", "admin"]);
const operationalRoles: ReadonlySet<OperationalRole> = new Set([
  "referee",
  "registrations",
  "broadcast",
  "analyst",
]);
const authorizationStatuses: ReadonlySet<AuthorizationStatus> = new Set(["active", "revoked"]);

const ownerPermissions: ReadonlySet<Permission> = new Set(ALL_PERMISSIONS);
const adminPermissions: ReadonlySet<Permission> = new Set(
  ALL_PERMISSIONS.filter((permission) => permission !== "organization:ownership:transfer"),
);

const organizationRolePermissions: Readonly<Record<OrganizationRole, ReadonlySet<Permission>>> = {
  owner: ownerPermissions,
  admin: adminPermissions,
};

const operationalRolePermissions: Readonly<Record<OperationalRole, ReadonlySet<Permission>>> = {
  referee: new Set([
    "organization:audit:self:read",
    "tournament:competition:read",
    "tournament:competition:manage",
    "tournament:statistics:read",
  ]),
  registrations: new Set([
    "organization:audit:self:read",
    "tournament:registrations:read",
    "tournament:registrations:manage",
    "tournament:statistics:read",
  ]),
  broadcast: new Set([
    "organization:audit:self:read",
    "tournament:broadcast:read",
    "tournament:broadcast:manage",
    "tournament:statistics:read",
  ]),
  analyst: new Set([
    "organization:audit:self:read",
    "tournament:competition:read",
    "tournament:registrations:read",
    "tournament:broadcast:read",
    "tournament:statistics:read",
    "tournament:statistics:export",
  ]),
};

function isKnownPermission(permission: Permission): boolean {
  return permissionSet.has(permission);
}

function isKnownOrganizationRole(role: OrganizationRole | null): boolean {
  return role === null || organizationRoles.has(role);
}

function hasValidSnapshotVocabulary(snapshot: AuthorizationSnapshot): boolean {
  return (
    authorizationStatuses.has(snapshot.membershipStatus) &&
    isKnownOrganizationRole(snapshot.organizationRole) &&
    snapshot.assignments.every(
      (assignment) =>
        operationalRoles.has(assignment.role) && authorizationStatuses.has(assignment.status),
    )
  );
}

function organizationRoleAllows(permission: Permission, role: OrganizationRole | null): boolean {
  return role !== null && organizationRolePermissions[role].has(permission);
}

function operationalRoleAllows(
  input: AuthorizationInput,
  assignments: readonly OperationalRoleAssignment[],
): boolean {
  if (input.authorizationScopeId === undefined) {
    return false;
  }

  return assignments.some(
    (assignment) =>
      assignment.status === "active" &&
      assignment.organizationId === input.organizationId &&
      assignment.authorizationScopeId === input.authorizationScopeId &&
      operationalRolePermissions[assignment.role].has(input.permission),
  );
}

export function can(input: AuthorizationInput, snapshot: AuthorizationSnapshot): boolean {
  if (
    !isKnownPermission(input.permission) ||
    !hasValidSnapshotVocabulary(snapshot) ||
    snapshot.membershipStatus !== "active" ||
    input.actorId !== snapshot.actorId ||
    input.organizationId !== snapshot.organizationId
  ) {
    return false;
  }

  if (organizationPermissionSet.has(input.permission)) {
    if (input.authorizationScopeId !== undefined) {
      return false;
    }

    if (input.permission === "organization:audit:self:read") {
      return true;
    }

    return organizationRoleAllows(input.permission, snapshot.organizationRole);
  }

  if (input.authorizationScopeId === undefined) {
    return false;
  }

  return (
    organizationRoleAllows(input.permission, snapshot.organizationRole) ||
    operationalRoleAllows(input, snapshot.assignments)
  );
}
