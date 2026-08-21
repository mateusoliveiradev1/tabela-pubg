import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const organizationRole = pgEnum("organization_role", ["owner", "admin", "member"]);
export const membershipStatus = pgEnum("membership_status", ["active", "revoked"]);
export const invitationOrganizationRole = pgEnum("invitation_organization_role", [
  "admin",
  "member",
]);

export interface InvitationRolePayloadEntry {
  readonly authorizationScopeId: string;
  readonly role: "referee" | "registrations" | "broadcast" | "analyst";
}

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique("organizations_slug_unique"),
    name: text("name").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("organizations_slug_check", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check("organizations_name_check", sql`char_length(btrim(${table.name})) between 2 and 120`),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: organizationRole("role").notNull().default("member"),
    status: membershipStatus("status").notNull().default("active"),
    joinedAt: timestamptz("joined_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
    revocationReason: text("revocation_reason"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("organization_memberships_organization_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    unique("organization_memberships_organization_id_id_unique").on(table.organizationId, table.id),
    index("organization_memberships_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("organization_memberships_organization_role_idx").on(
      table.organizationId,
      table.role,
      table.status,
    ),
    check(
      "organization_memberships_revocation_pair_check",
      sql`(${table.status} = 'active' and ${table.revokedAt} is null and ${table.revocationReason} is null) or (${table.status} = 'revoked' and ${table.revokedAt} is not null and ${table.revocationReason} is not null)`,
    ),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invitedByMembershipId: uuid("invited_by_membership_id").notNull(),
    acceptedByMembershipId: uuid("accepted_by_membership_id"),
    normalizedEmail: text("normalized_email").notNull(),
    tokenDigest: text("token_digest").notNull(),
    organizationRole: invitationOrganizationRole("organization_role").notNull(),
    rolePayload: jsonb("role_payload").$type<InvitationRolePayloadEntry[]>().notNull().default([]),
    issuedAt: timestamptz("issued_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
    revokedAt: timestamptz("revoked_at"),
    revocationReason: text("revocation_reason"),
    supersededAt: timestamptz("superseded_at"),
    supersededByInvitationId: uuid("superseded_by_invitation_id").references(
      (): AnyPgColumn => invitations.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("invitations_token_digest_unique").on(table.tokenDigest),
    unique("invitations_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("invitations_active_organization_email_unique")
      .on(table.organizationId, table.normalizedEmail)
      .where(
        sql`${table.acceptedAt} is null and ${table.revokedAt} is null and ${table.supersededAt} is null`,
      ),
    foreignKey({
      name: "invitations_organization_inviter_fk",
      columns: [table.organizationId, table.invitedByMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "invitations_organization_accepted_membership_fk",
      columns: [table.organizationId, table.acceptedByMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("restrict"),
    index("invitations_organization_status_idx").on(
      table.organizationId,
      table.expiresAt,
      table.acceptedAt,
      table.revokedAt,
      table.supersededAt,
    ),
    index("invitations_email_expiry_idx").on(table.normalizedEmail, table.expiresAt),
    check(
      "invitations_seven_day_expiry_check",
      sql`${table.expiresAt} = ${table.issuedAt} + interval '7 days'`,
    ),
    check("invitations_role_payload_check", sql`jsonb_typeof(${table.rolePayload}) = 'array'`),
    check(
      "invitations_terminal_state_check",
      sql`num_nonnulls(${table.acceptedAt}, ${table.revokedAt}, ${table.supersededAt}) <= 1`,
    ),
    check(
      "invitations_acceptance_pair_check",
      sql`(${table.acceptedAt} is null and ${table.acceptedByMembershipId} is null) or (${table.acceptedAt} is not null and ${table.acceptedByMembershipId} is not null)`,
    ),
    check(
      "invitations_revocation_pair_check",
      sql`(${table.revokedAt} is null and ${table.revocationReason} is null) or (${table.revokedAt} is not null and ${table.revocationReason} is not null)`,
    ),
    check(
      "invitations_supersession_pair_check",
      sql`(${table.supersededAt} is null and ${table.supersededByInvitationId} is null) or (${table.supersededAt} is not null and ${table.supersededByInvitationId} is not null)`,
    ),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;
export type OrganizationMembershipRow = typeof organizationMemberships.$inferSelect;
export type NewOrganizationMembershipRow = typeof organizationMemberships.$inferInsert;
export type InvitationRow = typeof invitations.$inferSelect;
export type NewInvitationRow = typeof invitations.$inferInsert;
