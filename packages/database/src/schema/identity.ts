import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const identityProvider = pgEnum("identity_provider", ["discord", "email"]);
export const identityStatus = pgEnum("identity_status", ["pending", "verified", "revoked"]);
export const authChallengePurpose = pgEnum("auth_challenge_purpose", [
  "sign-in",
  "link-email",
  "change-email",
  "step-up",
]);
export const oauthPurpose = pgEnum("oauth_purpose", ["sign-in", "link-identity", "step-up"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    status: userStatus("status").notNull().default("active"),
    displayName: text("display_name").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("users_status_idx").on(table.status)],
);

export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: identityProvider("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    status: identityStatus("status").notNull().default("verified"),
    displayName: text("display_name"),
    linkedAt: timestamptz("linked_at").notNull().defaultNow(),
    verifiedAt: timestamptz("verified_at"),
    revokedAt: timestamptz("revoked_at"),
  },
  (table) => [
    unique("identities_provider_subject_unique").on(table.provider, table.providerSubject),
    index("identities_user_status_idx").on(table.userId, table.status),
  ],
);

export const verifiedEmails = pgTable(
  "verified_emails",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    normalizedEmail: text("normalized_email").notNull(),
    verifiedAt: timestamptz("verified_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("verified_emails_normalized_email_unique").on(table.normalizedEmail),
    unique("verified_emails_identity_unique").on(table.identityId),
    uniqueIndex("verified_emails_active_user_unique")
      .on(table.userId)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceDigest: text("device_digest").notNull(),
    label: text("label").notNull(),
    browser: text("browser").notNull(),
    operatingSystem: text("operating_system").notNull(),
    approximateLocation: text("approximate_location"),
    summarizedUserAgent: text("summarized_user_agent"),
    firstSeenAt: timestamptz("first_seen_at").notNull(),
    lastSeenAt: timestamptz("last_seen_at").notNull(),
  },
  (table) => [
    unique("devices_user_digest_unique").on(table.userId, table.deviceDigest),
    unique("devices_user_id_id_unique").on(table.userId, table.id),
    index("devices_user_last_seen_idx").on(table.userId, table.lastSeenAt),
    check("devices_seen_order_check", sql`${table.lastSeenAt} >= ${table.firstSeenAt}`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull(),
    tokenDigest: text("token_digest").notNull().unique("sessions_token_digest_unique"),
    issuedAt: timestamptz("issued_at").notNull(),
    lastSeenAt: timestamptz("last_seen_at").notNull(),
    idleExpiresAt: timestamptz("idle_expires_at").notNull(),
    absoluteExpiresAt: timestamptz("absolute_expires_at").notNull(),
    reauthenticatedAt: timestamptz("reauthenticated_at"),
    revokedAt: timestamptz("revoked_at"),
    revocationReason: text("revocation_reason"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("sessions_user_id_id_unique").on(table.userId, table.id),
    foreignKey({
      name: "sessions_user_device_fk",
      columns: [table.userId, table.deviceId],
      foreignColumns: [devices.userId, devices.id],
    }).onDelete("cascade"),
    index("sessions_user_active_idx")
      .on(table.userId, table.lastSeenAt)
      .where(sql`${table.revokedAt} is null`),
    index("sessions_idle_expiry_idx").on(table.idleExpiresAt),
    index("sessions_absolute_expiry_idx").on(table.absoluteExpiresAt),
    check(
      "sessions_lifecycle_order_check",
      sql`${table.lastSeenAt} >= ${table.issuedAt} and ${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
    check(
      "sessions_revocation_pair_check",
      sql`(${table.revokedAt} is null and ${table.revocationReason} is null) or (${table.revokedAt} is not null and ${table.revocationReason} is not null)`,
    ),
  ],
);

export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    emailDigest: text("email_digest").notNull(),
    purpose: authChallengePurpose("purpose").notNull(),
    codeDigest: text("code_digest").notNull(),
    attemptsRemaining: integer("attempts_remaining").notNull().default(5),
    expiresAt: timestamptz("expires_at").notNull(),
    supersededAt: timestamptz("superseded_at"),
    consumedAt: timestamptz("consumed_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_challenges_active_subject_purpose_unique")
      .on(table.emailDigest, table.purpose)
      .where(sql`${table.supersededAt} is null and ${table.consumedAt} is null`),
    index("auth_challenges_digest_expiry_idx").on(table.emailDigest, table.expiresAt),
    index("auth_challenges_expiry_idx").on(table.expiresAt),
    check(
      "auth_challenges_attempts_check",
      sql`${table.attemptsRemaining} >= 0 and ${table.attemptsRemaining} <= 5`,
    ),
    check("auth_challenges_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "auth_challenges_terminal_state_check",
      sql`num_nonnulls(${table.supersededAt}, ${table.consumedAt}) <= 1`,
    ),
  ],
);

export const oauthTransactions = pgTable(
  "oauth_transactions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    purpose: oauthPurpose("purpose").notNull(),
    stateDigest: text("state_digest").notNull().unique("oauth_transactions_state_digest_unique"),
    browserBindingDigest: text("browser_binding_digest").notNull(),
    returnPath: text("return_path"),
    expiresAt: timestamptz("expires_at").notNull(),
    consumedAt: timestamptz("consumed_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("oauth_transactions_binding_expiry_idx").on(table.browserBindingDigest, table.expiresAt),
    index("oauth_transactions_expiry_idx").on(table.expiresAt),
    check("oauth_transactions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const sessionAlertContexts = pgTable(
  "session_alert_contexts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    tokenDigest: text("token_digest")
      .notNull()
      .unique("session_alert_contexts_token_digest_unique"),
    expiresAt: timestamptz("expires_at").notNull(),
    resolvedAt: timestamptz("resolved_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "session_alert_contexts_user_session_fk",
      columns: [table.userId, table.sessionId],
      foreignColumns: [sessions.userId, sessions.id],
    }).onDelete("cascade"),
    index("session_alert_contexts_expiry_idx").on(table.expiresAt),
    index("session_alert_contexts_session_idx").on(table.userId, table.sessionId),
    check("session_alert_contexts_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type IdentityRow = typeof identities.$inferSelect;
export type NewIdentityRow = typeof identities.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
