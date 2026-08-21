import type { MembershipId } from "./identity.js";

export type OrganizationMembershipRole = "owner" | "admin";
export type MembershipStatus = "active" | "revoked";

export interface OrganizationMembership {
  readonly id: MembershipId;
  readonly role: OrganizationMembershipRole;
  readonly status: MembershipStatus;
}

export class LastOwnerRemovalError extends Error {
  readonly code = "LAST_OWNER_REMOVAL";

  constructor() {
    super("The last active organization owner must transfer ownership before removal.");
    this.name = "LastOwnerRemovalError";
  }
}

export type OwnerRemovalResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: LastOwnerRemovalError };

export function validateOwnerRemoval(
  targetMembershipId: MembershipId,
  memberships: readonly OrganizationMembership[],
): OwnerRemovalResult {
  const target = memberships.find((membership) => membership.id === targetMembershipId);

  if (target?.status !== "active" || target.role !== "owner") {
    return { ok: true };
  }

  const hasAnotherActiveOwner = memberships.some(
    (membership) =>
      membership.id !== targetMembershipId &&
      membership.status === "active" &&
      membership.role === "owner",
  );

  if (!hasAnotherActiveOwner) {
    return { ok: false, error: new LastOwnerRemovalError() };
  }

  return { ok: true };
}
