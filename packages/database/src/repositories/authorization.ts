import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as databaseSchema from "../schema.js";
import { organizationMemberships, roleAssignments } from "../schema.js";

export type AuthorizationRepositoryExecutor = Pick<
  PostgresJsDatabase<typeof databaseSchema>,
  "select"
>;

export interface CurrentAuthorizationSnapshot {
  readonly actorId: string;
  readonly organizationId: string;
  readonly membershipStatus: "active" | "revoked";
  readonly organizationRole: "owner" | "admin" | null;
  readonly assignments: readonly {
    readonly organizationId: string;
    readonly authorizationScopeId: string;
    readonly role: "referee" | "registrations" | "broadcast" | "analyst";
    readonly status: "active";
  }[];
}

export async function loadAuthorizationSnapshot(
  executor: AuthorizationRepositoryExecutor,
  organizationId: string,
  userId: string,
): Promise<CurrentAuthorizationSnapshot | null> {
  const [membership] = await executor
    .select({
      id: organizationMemberships.id,
      role: organizationMemberships.role,
      status: organizationMemberships.status,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    return null;
  }

  const assignments =
    membership.status === "active"
      ? await executor
          .select({
            organizationId: roleAssignments.organizationId,
            authorizationScopeId: roleAssignments.authorizationScopeId,
            role: roleAssignments.role,
            status: roleAssignments.status,
          })
          .from(roleAssignments)
          .where(
            and(
              eq(roleAssignments.organizationId, organizationId),
              eq(roleAssignments.membershipId, membership.id),
              eq(roleAssignments.status, "active"),
            ),
          )
      : [];

  return {
    actorId: userId,
    organizationId,
    membershipStatus: membership.status,
    organizationRole:
      membership.role === "owner" || membership.role === "admin" ? membership.role : null,
    assignments: assignments.map((assignment) => ({ ...assignment, status: "active" as const })),
  };
}
