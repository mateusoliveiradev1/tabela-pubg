import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
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
export const organizationLogoMime = pgEnum("organization_logo_mime", [
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const organizationLogoStatus = pgEnum("organization_logo_status", [
  "pending",
  "active",
  "delete_pending",
]);
export const storageCleanupProvider = pgEnum("storage_cleanup_provider", ["s3"]);
export const storageCleanupStatus = pgEnum("storage_cleanup_status", [
  "pending",
  "claimed",
  "completed",
  "failed",
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
    supersededByInvitationId: uuid("superseded_by_invitation_id"),
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
    foreignKey({
      name: "invitations_organization_superseding_invitation_fk",
      columns: [table.organizationId, table.supersededByInvitationId],
      foreignColumns: [table.organizationId, table.id],
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
    check(
      "invitations_no_self_supersession_check",
      sql`${table.supersededByInvitationId} is null or ${table.supersededByInvitationId} <> ${table.id}`,
    ),
  ],
);

export const organizationLogoAssets = pgTable(
  "organization_logo_assets",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    detectedMime: organizationLogoMime("detected_mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    status: organizationLogoStatus("status").notNull().default("pending"),
    activatedAt: timestamptz("activated_at"),
    deletePendingAt: timestamptz("delete_pending_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("organization_logo_assets_object_key_unique").on(table.objectKey),
    unique("organization_logo_assets_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("organization_logo_assets_one_active_per_organization_unique")
      .on(table.organizationId)
      .where(sql`${table.status} = 'active'`),
    foreignKey({
      name: "organization_logo_assets_organization_creator_fk",
      columns: [table.organizationId, table.createdByMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("restrict"),
    index("organization_logo_assets_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
    check(
      "organization_logo_assets_object_key_tenant_check",
      sql`${table.objectKey} ~ ('^branding/' || ${table.organizationId}::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')`,
    ),
    check("organization_logo_assets_byte_size_check", sql`${table.byteSize} between 1 and 2097152`),
    check("organization_logo_assets_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "organization_logo_assets_lifecycle_check",
      sql`(${table.status} = 'pending' and ${table.activatedAt} is null and ${table.deletePendingAt} is null)
        or (${table.status} = 'active' and ${table.activatedAt} is not null and ${table.deletePendingAt} is null)
        or (${table.status} = 'delete_pending' and ${table.deletePendingAt} is not null)`,
    ),
  ],
);

export const orphanStorageCleanupLedger = pgTable(
  "orphan_storage_cleanup_ledger",
  {
    cleanupId: uuid("cleanup_id").primaryKey(),
    provider: storageCleanupProvider("provider").notNull(),
    objectKey: text("object_key").notNull(),
    objectKeyDigest: text("object_key_digest").notNull(),
    status: storageCleanupStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamptz("next_attempt_at").notNull().defaultNow(),
    claimedAt: timestamptz("claimed_at"),
    completedAt: timestamptz("completed_at"),
    lastError: text("last_error"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("orphan_storage_cleanup_provider_digest_unique").on(
      table.provider,
      table.objectKeyDigest,
    ),
    index("orphan_storage_cleanup_claim_idx").on(
      table.status,
      table.nextAttemptAt,
      table.claimedAt,
    ),
    check(
      "orphan_storage_cleanup_object_key_check",
      sql`${table.objectKey} ~ '^branding/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("orphan_storage_cleanup_digest_check", sql`${table.objectKeyDigest} ~ '^[0-9a-f]{64}$'`),
    check("orphan_storage_cleanup_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "orphan_storage_cleanup_lifecycle_check",
      sql`(${table.status} = 'pending' and ${table.claimedAt} is null and ${table.completedAt} is null)
        or (${table.status} = 'claimed' and ${table.claimedAt} is not null and ${table.completedAt} is null)
        or (${table.status} = 'completed' and ${table.claimedAt} is not null and ${table.completedAt} is not null)
        or (${table.status} = 'failed' and ${table.completedAt} is null)`,
    ),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;
export type OrganizationMembershipRow = typeof organizationMemberships.$inferSelect;
export type NewOrganizationMembershipRow = typeof organizationMemberships.$inferInsert;
export type InvitationRow = typeof invitations.$inferSelect;
export type NewInvitationRow = typeof invitations.$inferInsert;
export type OrganizationLogoAssetRow = typeof organizationLogoAssets.$inferSelect;
export type NewOrganizationLogoAssetRow = typeof organizationLogoAssets.$inferInsert;
export type OrphanStorageCleanupRow = typeof orphanStorageCleanupLedger.$inferSelect;
export type NewOrphanStorageCleanupRow = typeof orphanStorageCleanupLedger.$inferInsert;
