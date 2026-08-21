import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as databaseSchema from "../schema.js";
import {
  type AuditEventRow,
  type AuditSnapshot,
  auditEvents,
  organizationMemberships,
} from "../schema.js";

export type AuditRepositoryExecutor = Pick<
  PostgresJsDatabase<typeof databaseSchema>,
  "insert" | "select"
>;

const sensitiveField =
  /(?:authorization|cookie|code|email|invite|otp|password|payload|recipient|secret|session|token)/i;

function sanitizeSnapshot(snapshot: AuditSnapshot | null | undefined): AuditSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(snapshot).filter(
      ([key, value]) => !sensitiveField.test(key) && (value === null || !value.includes("@")),
    ),
  );
}

export interface AppendAuditEventInput {
  id: string;
  organizationId: string;
  authorizationScopeId?: string;
  actorMembershipId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  before?: AuditSnapshot | null;
  after?: AuditSnapshot | null;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
}

async function append(
  executor: AuditRepositoryExecutor,
  input: AppendAuditEventInput,
): Promise<void> {
  await executor.insert(auditEvents).values({
    id: input.id,
    organizationId: input.organizationId,
    actorMembershipId: input.actorMembershipId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    before: sanitizeSnapshot(input.before),
    after: sanitizeSnapshot(input.after),
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
    ...(input.authorizationScopeId === undefined
      ? {}
      : { authorizationScopeId: input.authorizationScopeId }),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
  });
}

async function listVisible(
  executor: AuditRepositoryExecutor,
  organizationId: string,
  viewerMembershipId: string,
): Promise<AuditEventRow[]> {
  const [viewer] = await executor
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, viewerMembershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);

  if (!viewer) {
    return [];
  }

  const visibility =
    viewer.role === "owner" || viewer.role === "admin"
      ? eq(auditEvents.organizationId, organizationId)
      : and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.actorMembershipId, viewerMembershipId),
        );

  return executor
    .select()
    .from(auditEvents)
    .where(visibility)
    .orderBy(desc(auditEvents.occurredAt));
}

export interface VisibleAuditPageInput {
  organizationId: string;
  viewerMembershipId: string;
  actorMembershipId?: string;
  action?: string;
  authorizationScopeId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

async function listVisiblePage(
  executor: AuditRepositoryExecutor,
  input: VisibleAuditPageInput,
): Promise<{ rows: AuditEventRow[]; total: number }> {
  const [viewer] = await executor
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, input.organizationId),
        eq(organizationMemberships.id, input.viewerMembershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);

  if (!viewer) {
    return { rows: [], total: 0 };
  }

  const visibility =
    viewer.role === "owner" || viewer.role === "admin"
      ? eq(auditEvents.organizationId, input.organizationId)
      : and(
          eq(auditEvents.organizationId, input.organizationId),
          eq(auditEvents.actorMembershipId, input.viewerMembershipId),
        );
  const where = and(
    visibility,
    input.actorMembershipId === undefined
      ? undefined
      : eq(auditEvents.actorMembershipId, input.actorMembershipId),
    input.action === undefined ? undefined : eq(auditEvents.action, input.action),
    input.authorizationScopeId === undefined
      ? undefined
      : eq(auditEvents.authorizationScopeId, input.authorizationScopeId),
    input.from === undefined ? undefined : gte(auditEvents.occurredAt, input.from),
    input.to === undefined ? undefined : lte(auditEvents.occurredAt, input.to),
  );
  const [totals, rows] = await Promise.all([
    executor.select({ value: count() }).from(auditEvents).where(where),
    executor
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.occurredAt))
      .limit(input.limit)
      .offset(input.offset),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}

export const AuditWriter = {
  append,
  listVisible,
  listVisiblePage,
} as const;
