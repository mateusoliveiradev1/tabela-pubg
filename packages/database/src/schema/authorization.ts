import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizationMemberships, organizations } from "./organizations.js";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const authorizationScopeKind = pgEnum("authorization_scope_kind", ["tournament"]);
export const operationalRole = pgEnum("operational_role", [
  "referee",
  "registrations",
  "broadcast",
  "analyst",
]);
export const roleAssignmentStatus = pgEnum("role_assignment_status", ["active", "revoked"]);

export const authorizationScopes = pgTable(
  "authorization_scopes",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: authorizationScopeKind("kind").notNull().default("tournament"),
    label: text("label").notNull(),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("authorization_scopes_organization_id_id_unique").on(table.organizationId, table.id),
    index("authorization_scopes_organization_kind_idx").on(table.organizationId, table.kind),
    check(
      "authorization_scopes_label_check",
      sql`char_length(btrim(${table.label})) between 1 and 160`,
    ),
  ],
);

export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    authorizationScopeId: uuid("authorization_scope_id").notNull(),
    role: operationalRole("role").notNull(),
    status: roleAssignmentStatus("status").notNull().default("active"),
    assignedByMembershipId: uuid("assigned_by_membership_id").notNull(),
    assignmentReason: text("assignment_reason").notNull(),
    assignedAt: timestamptz("assigned_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
    revocationReason: text("revocation_reason"),
  },
  (table) => [
    unique("role_assignments_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("role_assignments_active_role_unique")
      .on(table.organizationId, table.membershipId, table.authorizationScopeId, table.role)
      .where(sql`${table.status} = 'active'`),
    foreignKey({
      name: "role_assignments_organization_membership_fk",
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "role_assignments_organization_scope_fk",
      columns: [table.organizationId, table.authorizationScopeId],
      foreignColumns: [authorizationScopes.organizationId, authorizationScopes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "role_assignments_organization_assigner_fk",
      columns: [table.organizationId, table.assignedByMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("restrict"),
    index("role_assignments_organization_membership_idx").on(
      table.organizationId,
      table.membershipId,
      table.status,
    ),
    index("role_assignments_organization_scope_idx").on(
      table.organizationId,
      table.authorizationScopeId,
      table.status,
    ),
    check("role_assignments_reason_check", sql`char_length(btrim(${table.assignmentReason})) >= 8`),
    check(
      "role_assignments_revocation_pair_check",
      sql`(${table.status} = 'active' and ${table.revokedAt} is null and ${table.revocationReason} is null) or (${table.status} = 'revoked' and ${table.revokedAt} is not null and ${table.revocationReason} is not null)`,
    ),
  ],
);

export type AuthorizationScopeRow = typeof authorizationScopes.$inferSelect;
export type NewAuthorizationScopeRow = typeof authorizationScopes.$inferInsert;
export type RoleAssignmentRow = typeof roleAssignments.$inferSelect;
export type NewRoleAssignmentRow = typeof roleAssignments.$inferInsert;
