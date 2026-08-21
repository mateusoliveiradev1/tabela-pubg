import type { EventEnvelope } from "@pubg-camp/contracts";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { appendOutboxEvent } from "../outbox.js";
import type * as databaseSchema from "../schema.js";
import {
  type OrganizationMembershipRow,
  organizationMemberships,
  organizations,
} from "../schema.js";
import { AuditWriter } from "./audit.js";

export type OrganizationRepositoryExecutor = Pick<
  PostgresJsDatabase<typeof databaseSchema>,
  "insert" | "select" | "update"
>;

export interface CreateOrganizationInput {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string;
  ownerMembershipId: string;
  auditEventId: string;
  outboxEventId: string;
  correlationId: string;
  occurredAt: Date;
}

export async function createOrganization(
  executor: OrganizationRepositoryExecutor,
  input: CreateOrganizationInput,
): Promise<void> {
  await executor.insert(organizations).values({
    id: input.id,
    slug: input.slug,
    name: input.name,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  });
  await executor.insert(organizationMemberships).values({
    id: input.ownerMembershipId,
    organizationId: input.id,
    userId: input.ownerUserId,
    role: "owner",
    status: "active",
    joinedAt: input.occurredAt,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  });

  await AuditWriter.append(executor, {
    id: input.auditEventId,
    organizationId: input.id,
    actorMembershipId: input.ownerMembershipId,
    action: "organization.created",
    targetType: "organization",
    targetId: input.id,
    reason: "organization created",
    before: null,
    after: { organizationName: input.name, organizationRole: "owner" },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });

  const event: EventEnvelope = {
    id: input.outboxEventId,
    type: "organization.created",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    aggregate: { type: "organization", id: input.id },
    payload: { organizationId: input.id },
  };
  await appendOutboxEvent(executor, event);
}

export async function findMembershipById(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  membershipId: string,
): Promise<OrganizationMembershipRow | null> {
  const [membership] = await executor
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, membershipId),
      ),
    )
    .limit(1);
  return membership ?? null;
}
