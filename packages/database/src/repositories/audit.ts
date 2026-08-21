import { and, desc, eq } from "drizzle-orm";
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

export const AuditWriter = {
  append,
  listVisible,
} as const;
