import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authorizationScopes } from "./authorization.js";
import { organizationMemberships, organizations } from "./organizations.js";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type AuditSnapshot = Readonly<Record<string, string | null>>;

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    authorizationScopeId: uuid("authorization_scope_id"),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    before: jsonb("before").$type<AuditSnapshot>(),
    after: jsonb("after").$type<AuditSnapshot>(),
    correlationId: uuid("correlation_id").notNull(),
    causationId: uuid("causation_id"),
    occurredAt: timestamptz("occurred_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "audit_events_organization_actor_fk",
      columns: [table.organizationId, table.actorMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "audit_events_organization_scope_fk",
      columns: [table.organizationId, table.authorizationScopeId],
      foreignColumns: [authorizationScopes.organizationId, authorizationScopes.id],
    }).onDelete("restrict"),
    index("audit_events_organization_occurred_idx").on(table.organizationId, table.occurredAt),
    index("audit_events_organization_actor_idx").on(
      table.organizationId,
      table.actorMembershipId,
      table.occurredAt,
    ),
    index("audit_events_organization_scope_idx").on(
      table.organizationId,
      table.authorizationScopeId,
      table.occurredAt,
    ),
    index("audit_events_correlation_idx").on(table.correlationId),
    check("audit_events_reason_check", sql`char_length(btrim(${table.reason})) >= 1`),
  ],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
