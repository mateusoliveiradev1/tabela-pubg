import { createHash } from "node:crypto";
import type { EventEnvelope } from "@pubg-camp/contracts";
import { ObjectKeySchema } from "@pubg-camp/storage";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { appendOutboxEvent } from "../outbox.js";
import type * as databaseSchema from "../schema.js";
import {
  authorizationScopes,
  type InvitationRolePayloadEntry,
  type InvitationRow,
  invitations,
  type OrganizationLogoAssetRow,
  type OrganizationMembershipRow,
  type OrganizationRow,
  type OrphanStorageCleanupRow,
  organizationLogoAssets,
  organizationMemberships,
  organizations,
  orphanStorageCleanupLedger,
  type RoleAssignmentRow,
  roleAssignments,
  type UserRow,
  users,
  verifiedEmails,
} from "../schema.js";
import { AuditWriter } from "./audit.js";

export type OrganizationRepositoryExecutor = Pick<
  PostgresJsDatabase<typeof databaseSchema>,
  "execute" | "insert" | "select" | "update"
>;

export type LogoActivationExecutor = OrganizationRepositoryExecutor & {
  rollback(): never;
};

export type OrphanCleanupClaimResult =
  | { status: "claimed"; cleanup: OrphanStorageCleanupRow }
  | { status: "completed" }
  | { status: "missing" }
  | { status: "leased-until"; retryAt: Date }
  | { status: "retry-at"; retryAt: Date };

export interface CreatePendingLogoInput {
  id: string;
  objectKey: string;
  detectedMime: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  sha256: string;
  createdByMembershipId: string;
  createdAt: Date;
}

function validateLogoMetadata(
  organizationId: string,
  input: CreatePendingLogoInput,
): CreatePendingLogoInput {
  const objectKey = ObjectKeySchema.parse(input.objectKey);
  if (!objectKey.startsWith(`branding/${organizationId}/`)) {
    throw new Error("organization logo object key is outside the organization namespace");
  }
  if (!(["image/png", "image/jpeg", "image/webp"] as const).includes(input.detectedMime)) {
    throw new Error("organization logo detected MIME is not allowed");
  }
  if (
    !Number.isInteger(input.byteSize) ||
    input.byteSize <= 0 ||
    input.byteSize > 2 * 1024 * 1024
  ) {
    throw new Error("organization logo byte size is outside the allowed range");
  }
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new Error("organization logo digest must be lowercase SHA-256");
  }
  return { ...input, objectKey };
}

export async function createPendingLogo(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  input: CreatePendingLogoInput,
): Promise<OrganizationLogoAssetRow> {
  const metadata = validateLogoMetadata(organizationId, input);
  const [created] = await executor
    .insert(organizationLogoAssets)
    .values({
      ...metadata,
      organizationId,
      status: "pending",
      updatedAt: metadata.createdAt,
    })
    .returning();
  if (!created) throw new Error("organization logo metadata was not persisted");
  return created;
}

export async function getActiveLogo(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
): Promise<OrganizationLogoAssetRow | null> {
  const [active] = await executor
    .select()
    .from(organizationLogoAssets)
    .where(
      and(
        eq(organizationLogoAssets.organizationId, organizationId),
        eq(organizationLogoAssets.status, "active"),
      ),
    )
    .limit(1);
  return active ?? null;
}

export async function activateLogo(
  executor: LogoActivationExecutor,
  organizationId: string,
  logoAssetId: string,
  activatedAt: Date,
): Promise<OrganizationLogoAssetRow | null> {
  if (!(await lockOrganization(executor, organizationId))) {
    throw new Error("organization logo tenant does not exist");
  }

  const [pending] = await executor
    .select({ id: organizationLogoAssets.id })
    .from(organizationLogoAssets)
    .where(
      and(
        eq(organizationLogoAssets.organizationId, organizationId),
        eq(organizationLogoAssets.id, logoAssetId),
        eq(organizationLogoAssets.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) throw new Error("pending organization logo is unavailable");

  const previous = await getActiveLogo(executor, organizationId);
  if (previous) {
    await executor
      .update(organizationLogoAssets)
      .set({
        status: "delete_pending",
        deletePendingAt: activatedAt,
        updatedAt: activatedAt,
      })
      .where(
        and(
          eq(organizationLogoAssets.organizationId, organizationId),
          eq(organizationLogoAssets.id, previous.id),
          eq(organizationLogoAssets.status, "active"),
        ),
      );
  }

  const [activated] = await executor
    .update(organizationLogoAssets)
    .set({ status: "active", activatedAt, updatedAt: activatedAt })
    .where(
      and(
        eq(organizationLogoAssets.organizationId, organizationId),
        eq(organizationLogoAssets.id, logoAssetId),
        eq(organizationLogoAssets.status, "pending"),
      ),
    )
    .returning({ id: organizationLogoAssets.id });
  if (!activated)
    throw new Error("organization logo changed while locked; transaction must roll back");
  return previous;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function lockOrganization(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
): Promise<boolean> {
  const locked = await executor.execute(
    sql`select ${organizations.id} from ${organizations}
        where ${organizations.id} = ${organizationId} for update`,
  );
  return locked.length === 1;
}

async function validateRolePayload(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  rolePayload: readonly InvitationRolePayloadEntry[],
): Promise<boolean> {
  const uniqueAssignments = new Set<string>();
  for (const assignment of rolePayload) {
    const key = `${assignment.authorizationScopeId}:${assignment.role}`;
    if (uniqueAssignments.has(key)) return false;
    uniqueAssignments.add(key);
    const [scope] = await executor
      .select({ id: authorizationScopes.id })
      .from(authorizationScopes)
      .where(
        and(
          eq(authorizationScopes.organizationId, organizationId),
          eq(authorizationScopes.id, assignment.authorizationScopeId),
          isNull(authorizationScopes.archivedAt),
        ),
      )
      .limit(1);
    if (!scope) return false;
  }
  return true;
}

export interface MutationMetadata {
  auditEventId: string;
  outboxEventId: string;
  correlationId: string;
  reason: string;
  occurredAt: Date;
}

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

export async function findMembershipByUser(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  userId: string,
): Promise<OrganizationMembershipRow | null> {
  const [membership] = await executor
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
      ),
    )
    .limit(1);
  return membership ?? null;
}

export async function findOrganizationById(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
): Promise<OrganizationRow | null> {
  const [organization] = await executor
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return organization ?? null;
}

export async function listOrganizationsForUser(
  executor: OrganizationRepositoryExecutor,
  userId: string,
): Promise<readonly { organization: OrganizationRow; membership: OrganizationMembershipRow }[]> {
  const rows = await executor
    .select({ organization: organizations, membership: organizationMemberships })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(
      and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")),
    )
    .orderBy(organizations.name);
  return rows;
}

export async function listMembershipsForOrganization(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
): Promise<readonly OrganizationMembershipRow[]> {
  return executor
    .select()
    .from(organizationMemberships)
    .where(eq(organizationMemberships.organizationId, organizationId))
    .orderBy(organizationMemberships.joinedAt);
}

export async function findUserById(
  executor: OrganizationRepositoryExecutor,
  userId: string,
): Promise<UserRow | null> {
  const [user] = await executor.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

export async function findVerifiedEmailForUser(
  executor: OrganizationRepositoryExecutor,
  userId: string,
): Promise<string | null> {
  const [email] = await executor
    .select({ normalizedEmail: verifiedEmails.normalizedEmail })
    .from(verifiedEmails)
    .where(and(eq(verifiedEmails.userId, userId), isNull(verifiedEmails.revokedAt)))
    .limit(1);
  return email?.normalizedEmail ?? null;
}

export async function listActiveAssignmentsForMembership(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  membershipId: string,
): Promise<readonly (RoleAssignmentRow & { scopeName: string })[]> {
  return executor
    .select({
      id: roleAssignments.id,
      organizationId: roleAssignments.organizationId,
      membershipId: roleAssignments.membershipId,
      authorizationScopeId: roleAssignments.authorizationScopeId,
      role: roleAssignments.role,
      status: roleAssignments.status,
      assignedByMembershipId: roleAssignments.assignedByMembershipId,
      assignmentReason: roleAssignments.assignmentReason,
      assignedAt: roleAssignments.assignedAt,
      revokedAt: roleAssignments.revokedAt,
      revocationReason: roleAssignments.revocationReason,
      scopeName: authorizationScopes.label,
    })
    .from(roleAssignments)
    .innerJoin(
      authorizationScopes,
      and(
        eq(authorizationScopes.organizationId, roleAssignments.organizationId),
        eq(authorizationScopes.id, roleAssignments.authorizationScopeId),
      ),
    )
    .where(
      and(
        eq(roleAssignments.organizationId, organizationId),
        eq(roleAssignments.membershipId, membershipId),
        eq(roleAssignments.status, "active"),
      ),
    );
}

export interface CreateInvitationInput extends MutationMetadata {
  id: string;
  invitedByMembershipId: string;
  email: string;
  token: string;
  organizationRole: "admin" | "member";
  rolePayload: readonly InvitationRolePayloadEntry[];
  issuedAt: Date;
}

export async function createInvitation(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  input: CreateInvitationInput,
): Promise<void> {
  const [inviter] = await executor
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, input.invitedByMembershipId),
        eq(organizationMemberships.status, "active"),
        or(eq(organizationMemberships.role, "owner"), eq(organizationMemberships.role, "admin")),
      ),
    )
    .limit(1);
  if (!inviter || !(await validateRolePayload(executor, organizationId, input.rolePayload))) {
    throw new Error("invitation actor or role payload is outside the organization scope");
  }

  await executor.insert(invitations).values({
    id: input.id,
    organizationId,
    invitedByMembershipId: input.invitedByMembershipId,
    normalizedEmail: normalizeEmail(input.email),
    tokenDigest: digestToken(input.token),
    organizationRole: input.organizationRole,
    rolePayload: [...input.rolePayload],
    issuedAt: input.issuedAt,
    expiresAt: new Date(input.issuedAt.getTime() + INVITATION_TTL_MS),
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  });
  await AuditWriter.append(executor, {
    id: input.auditEventId,
    organizationId,
    actorMembershipId: input.invitedByMembershipId,
    action: "invitation.created",
    targetType: "invitation",
    targetId: input.id,
    reason: input.reason,
    before: null,
    after: { invitationStatus: "pending", organizationRole: input.organizationRole },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });
  await appendOutboxEvent(executor, {
    id: input.outboxEventId,
    type: "invitation.created",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    aggregate: { type: "invitation", id: input.id },
    payload: { organizationId, invitationId: input.id },
  });
}

export interface ResendInvitationInput extends MutationMetadata {
  id: string;
  actorMembershipId: string;
  token: string;
  issuedAt: Date;
}

export type ResendInvitationResult =
  | { status: "reissued"; invitation: InvitationRow }
  | { status: "unavailable" };

export async function resendInvitation(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  previousInvitationId: string,
  input: ResendInvitationInput,
): Promise<ResendInvitationResult> {
  if (!(await lockOrganization(executor, organizationId))) return { status: "unavailable" };
  await executor.execute(
    sql`select ${invitations.id} from ${invitations}
        where ${invitations.organizationId} = ${organizationId}
          and ${invitations.id} = ${previousInvitationId} for update`,
  );
  const [previous] = await executor
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.id, previousInvitationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        isNull(invitations.supersededAt),
        gt(invitations.expiresAt, input.occurredAt),
      ),
    )
    .limit(1);
  const [actor] = await executor
    .select({ id: organizationMemberships.id, role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, input.actorMembershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (!previous || (actor?.role !== "owner" && actor?.role !== "admin")) {
    return { status: "unavailable" };
  }

  const expiresAt = new Date(input.issuedAt.getTime() + INVITATION_TTL_MS);
  await executor.insert(invitations).values({
    id: input.id,
    organizationId,
    invitedByMembershipId: input.actorMembershipId,
    normalizedEmail: previous.normalizedEmail,
    tokenDigest: digestToken(input.token),
    organizationRole: previous.organizationRole,
    rolePayload: previous.rolePayload,
    issuedAt: input.issuedAt,
    expiresAt,
    revokedAt: input.issuedAt,
    revocationReason: "pending supersession",
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  });
  const [superseded] = await executor
    .update(invitations)
    .set({
      supersededAt: input.occurredAt,
      supersededByInvitationId: input.id,
      updatedAt: input.occurredAt,
    })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.id, previousInvitationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        isNull(invitations.supersededAt),
      ),
    )
    .returning({ id: invitations.id });
  if (!superseded) throw new Error("invitation changed while locked; transaction must roll back");
  const [activated] = await executor
    .update(invitations)
    .set({ revokedAt: null, revocationReason: null, updatedAt: input.occurredAt })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.id, input.id),
        eq(invitations.revocationReason, "pending supersession"),
      ),
    )
    .returning();
  if (!activated) throw new Error("replacement invitation was not activated");

  await AuditWriter.append(executor, {
    id: input.auditEventId,
    organizationId,
    actorMembershipId: input.actorMembershipId,
    action: "invitation.created",
    targetType: "invitation",
    targetId: input.id,
    reason: input.reason,
    before: { invitationStatus: "superseded" },
    after: { invitationStatus: "pending", organizationRole: activated.organizationRole },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });
  await appendOutboxEvent(executor, {
    id: input.outboxEventId,
    type: "invitation.reissued",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    aggregate: { type: "invitation", id: input.id },
    payload: { organizationId, invitationId: input.id, previousInvitationId },
  });
  return { status: "reissued", invitation: activated };
}

export async function findInvitationByToken(
  executor: OrganizationRepositoryExecutor,
  token: string,
): Promise<InvitationRow | null> {
  const [invitation] = await executor
    .select()
    .from(invitations)
    .where(eq(invitations.tokenDigest, digestToken(token)))
    .limit(1);
  return invitation ?? null;
}

export async function listInvitationsForOrganization(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
): Promise<readonly InvitationRow[]> {
  return executor
    .select()
    .from(invitations)
    .where(eq(invitations.organizationId, organizationId))
    .orderBy(desc(invitations.createdAt));
}

export interface RevokeInvitationInput extends MutationMetadata {
  actorMembershipId: string;
}

export async function revokeInvitation(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  invitationId: string,
  input: RevokeInvitationInput,
): Promise<boolean> {
  if (!(await lockOrganization(executor, organizationId))) return false;
  await executor.execute(
    sql`select ${invitations.id} from ${invitations}
        where ${invitations.organizationId} = ${organizationId}
          and ${invitations.id} = ${invitationId} for update`,
  );
  const [revoked] = await executor
    .update(invitations)
    .set({
      revokedAt: input.occurredAt,
      revocationReason: input.reason,
      updatedAt: input.occurredAt,
    })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.id, invitationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        isNull(invitations.supersededAt),
      ),
    )
    .returning({ id: invitations.id });
  if (!revoked) return false;
  await AuditWriter.append(executor, {
    id: input.auditEventId,
    organizationId,
    actorMembershipId: input.actorMembershipId,
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: invitationId,
    reason: input.reason,
    before: { invitationStatus: "pending" },
    after: { invitationStatus: "revoked" },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });
  await appendOutboxEvent(executor, {
    id: input.outboxEventId,
    type: "invitation.revoked",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    aggregate: { type: "invitation", id: invitationId },
    payload: { organizationId, invitationId },
  });
  return true;
}

export interface AcceptInvitationInput extends MutationMetadata {
  membershipId: string;
  assignmentIds: readonly string[];
}

export type AcceptInvitationResult =
  | { status: "accepted"; membershipId: string }
  | { status: "unavailable" };

export async function acceptInvitation(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  token: string,
  userId: string,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  if (!(await lockOrganization(executor, organizationId))) return { status: "unavailable" };
  const tokenDigest = digestToken(token);
  await executor.execute(
    sql`select ${invitations.id} from ${invitations}
        where ${invitations.organizationId} = ${organizationId}
          and ${invitations.tokenDigest} = ${tokenDigest} for update`,
  );
  const [invitation] = await executor
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.tokenDigest, tokenDigest),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        isNull(invitations.supersededAt),
        gt(invitations.expiresAt, input.occurredAt),
      ),
    )
    .limit(1);
  const [verifiedEmail] = await executor
    .select({ normalizedEmail: verifiedEmails.normalizedEmail })
    .from(verifiedEmails)
    .where(and(eq(verifiedEmails.userId, userId), isNull(verifiedEmails.revokedAt)))
    .limit(1);
  const [existingMembership] = await executor
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
      ),
    )
    .limit(1);
  if (
    !invitation ||
    !verifiedEmail ||
    verifiedEmail.normalizedEmail !== invitation.normalizedEmail ||
    existingMembership ||
    input.assignmentIds.length !== invitation.rolePayload.length ||
    !(await validateRolePayload(executor, organizationId, invitation.rolePayload))
  ) {
    return { status: "unavailable" };
  }

  await executor.insert(organizationMemberships).values({
    id: input.membershipId,
    organizationId,
    userId,
    role: invitation.organizationRole,
    status: "active",
    joinedAt: input.occurredAt,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  });
  if (invitation.rolePayload.length > 0) {
    await executor.insert(roleAssignments).values(
      invitation.rolePayload.map((assignment, index) => ({
        id: input.assignmentIds[index] as string,
        organizationId,
        membershipId: input.membershipId,
        authorizationScopeId: assignment.authorizationScopeId,
        role: assignment.role,
        status: "active" as const,
        assignedByMembershipId: invitation.invitedByMembershipId,
        assignmentReason: input.reason,
        assignedAt: input.occurredAt,
      })),
    );
  }
  const [consumed] = await executor
    .update(invitations)
    .set({
      acceptedByMembershipId: input.membershipId,
      acceptedAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.id, invitation.id),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        isNull(invitations.supersededAt),
      ),
    )
    .returning({ id: invitations.id });
  if (!consumed) throw new Error("invitation changed while locked; transaction must roll back");

  await AuditWriter.append(executor, {
    id: input.auditEventId,
    organizationId,
    actorMembershipId: input.membershipId,
    action: "invitation.accepted",
    targetType: "invitation",
    targetId: invitation.id,
    reason: input.reason,
    before: { invitationStatus: "pending" },
    after: { invitationStatus: "accepted", organizationRole: invitation.organizationRole },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });
  await appendOutboxEvent(executor, {
    id: input.outboxEventId,
    type: "invitation.accepted",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    aggregate: { type: "invitation", id: invitation.id },
    payload: { organizationId, invitationId: invitation.id, membershipId: input.membershipId },
  });
  return { status: "accepted", membershipId: input.membershipId };
}

export type RevokeMembershipResult =
  | { status: "revoked" }
  | { status: "last-owner" }
  | { status: "unavailable" };

export interface UpdateMembershipRolesInput extends MutationMetadata {
  actorMembershipId: string;
  organizationRole: "admin" | "member";
  rolePayload: readonly InvitationRolePayloadEntry[];
  assignmentIds: readonly string[];
}

export type UpdateMembershipRolesResult =
  | { status: "updated" }
  | { status: "last-owner" }
  | { status: "unavailable" };

export async function updateMembershipRoles(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  membershipId: string,
  input: UpdateMembershipRolesInput,
): Promise<UpdateMembershipRolesResult> {
  if (!(await lockOrganization(executor, organizationId))) return { status: "unavailable" };
  const [target] = await executor
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, membershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);
  const [actor] = await executor
    .select({ id: organizationMemberships.id, role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, input.actorMembershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (
    !target ||
    (actor?.role !== "owner" && actor?.role !== "admin") ||
    (target.role === "owner" && actor.role !== "owner") ||
    input.assignmentIds.length !== input.rolePayload.length ||
    !(await validateRolePayload(executor, organizationId, input.rolePayload))
  ) {
    return { status: "unavailable" };
  }
  if (target.role === "owner") {
    const owners = await executor
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.role, "owner"),
          eq(organizationMemberships.status, "active"),
        ),
      );
    if (owners.length <= 1) return { status: "last-owner" };
  }

  const previousAssignments = await listActiveAssignmentsForMembership(
    executor,
    organizationId,
    membershipId,
  );
  await executor
    .update(roleAssignments)
    .set({
      status: "revoked",
      revokedAt: input.occurredAt,
      revocationReason: input.reason,
    })
    .where(
      and(
        eq(roleAssignments.organizationId, organizationId),
        eq(roleAssignments.membershipId, membershipId),
        eq(roleAssignments.status, "active"),
      ),
    );
  if (input.rolePayload.length > 0) {
    await executor.insert(roleAssignments).values(
      input.rolePayload.map((assignment, index) => ({
        id: input.assignmentIds[index] as string,
        organizationId,
        membershipId,
        authorizationScopeId: assignment.authorizationScopeId,
        role: assignment.role,
        status: "active" as const,
        assignedByMembershipId: input.actorMembershipId,
        assignmentReason: input.reason,
        assignedAt: input.occurredAt,
      })),
    );
  }
  await executor
    .update(organizationMemberships)
    .set({ role: input.organizationRole, updatedAt: input.occurredAt })
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, membershipId),
        eq(organizationMemberships.status, "active"),
      ),
    );
  await AuditWriter.append(executor, {
    id: input.auditEventId,
    organizationId,
    actorMembershipId: input.actorMembershipId,
    action: "membership.roles.updated",
    targetType: "organization-membership",
    targetId: membershipId,
    reason: input.reason,
    before: {
      organizationRole: target.role,
      operationalRoles: previousAssignments.map(roleAssignmentKey).toSorted().join(",") || "none",
    },
    after: {
      organizationRole: input.organizationRole,
      operationalRoles:
        input.rolePayload
          .map((assignment) => `${assignment.authorizationScopeId}:${assignment.role}`)
          .toSorted()
          .join(",") || "none",
    },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });
  await appendOutboxEvent(executor, {
    id: input.outboxEventId,
    type: "membership.roles.updated",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    aggregate: { type: "organization-membership", id: membershipId },
    payload: { organizationId, membershipId },
  });
  return { status: "updated" };
}

function roleAssignmentKey(assignment: RoleAssignmentRow): string {
  return `${assignment.authorizationScopeId}:${assignment.role}`;
}

export async function revokeMembership(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  membershipId: string,
  actorMembershipId: string,
  input: MutationMetadata,
): Promise<RevokeMembershipResult> {
  if (!(await lockOrganization(executor, organizationId))) return { status: "unavailable" };
  const [target] = await executor
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, membershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);
  const [actor] = await executor
    .select({ id: organizationMemberships.id, role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, actorMembershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (!target || (actor?.role !== "owner" && actor?.role !== "admin")) {
    return { status: "unavailable" };
  }
  if (target.role === "owner") {
    const owners = await executor
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.role, "owner"),
          eq(organizationMemberships.status, "active"),
        ),
      );
    if (owners.length <= 1) return { status: "last-owner" };
  }
  const [revoked] = await executor
    .update(organizationMemberships)
    .set({
      status: "revoked",
      revokedAt: input.occurredAt,
      revocationReason: input.reason,
      updatedAt: input.occurredAt,
    })
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, membershipId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .returning({ id: organizationMemberships.id });
  if (!revoked) return { status: "unavailable" };
  await AuditWriter.append(executor, {
    id: input.auditEventId,
    organizationId,
    actorMembershipId,
    action: "membership.revoked",
    targetType: "organization-membership",
    targetId: membershipId,
    reason: input.reason,
    before: { membershipStatus: "active", organizationRole: target.role },
    after: { membershipStatus: "revoked", organizationRole: target.role },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });
  await appendOutboxEvent(executor, {
    id: input.outboxEventId,
    type: "membership.revoked",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    aggregate: { type: "organization-membership", id: membershipId },
    payload: { organizationId, membershipId },
  });
  return { status: "revoked" };
}

export type TransferOwnershipResult = { status: "transferred" } | { status: "unavailable" };

export async function transferOwnership(
  executor: OrganizationRepositoryExecutor,
  organizationId: string,
  currentOwnerMembershipId: string,
  newOwnerMembershipId: string,
  input: MutationMetadata,
): Promise<TransferOwnershipResult> {
  if (
    currentOwnerMembershipId === newOwnerMembershipId ||
    !(await lockOrganization(executor, organizationId))
  ) {
    return { status: "unavailable" };
  }
  const memberships = await executor
    .select({ id: organizationMemberships.id, role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, "active"),
        or(
          eq(organizationMemberships.id, currentOwnerMembershipId),
          eq(organizationMemberships.id, newOwnerMembershipId),
        ),
      ),
    );
  const currentOwner = memberships.find((item) => item.id === currentOwnerMembershipId);
  const newOwner = memberships.find((item) => item.id === newOwnerMembershipId);
  if (currentOwner?.role !== "owner" || !newOwner) return { status: "unavailable" };

  await executor
    .update(organizationMemberships)
    .set({ role: "owner", updatedAt: input.occurredAt })
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, newOwnerMembershipId),
        eq(organizationMemberships.status, "active"),
      ),
    );
  await executor
    .update(organizationMemberships)
    .set({ role: "member", updatedAt: input.occurredAt })
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.id, currentOwnerMembershipId),
        eq(organizationMemberships.status, "active"),
      ),
    );
  await AuditWriter.append(executor, {
    id: input.auditEventId,
    organizationId,
    actorMembershipId: currentOwnerMembershipId,
    action: "ownership.transferred",
    targetType: "organization",
    targetId: organizationId,
    reason: input.reason,
    before: { ownership: currentOwnerMembershipId },
    after: { ownership: newOwnerMembershipId },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });
  await appendOutboxEvent(executor, {
    id: input.outboxEventId,
    type: "ownership.transferred",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    aggregate: { type: "organization", id: organizationId },
    payload: {
      organizationId,
      previousOwnerMembershipId: currentOwnerMembershipId,
      newOwnerMembershipId,
    },
  });
  return { status: "transferred" };
}

export interface EnqueueOrphanCleanupInput {
  cleanupId: string;
  provider: "s3";
  objectKey: string;
  outboxEventId: string;
  occurredAt: Date;
  nextAttemptAt?: Date;
}

export interface RetryOrphanCleanupInput {
  now: Date;
  nextAttemptAt: Date;
  error: string;
}

const CLEANUP_LEASE_MS = 5 * 60_000;

export async function enqueueOrphanCleanup(
  executor: OrganizationRepositoryExecutor,
  input: EnqueueOrphanCleanupInput,
): Promise<string> {
  const objectKey = ObjectKeySchema.parse(input.objectKey);
  if (!objectKey.startsWith("branding/")) {
    throw new Error("orphan cleanup accepts only server-generated branding keys");
  }
  const objectKeyDigest = digestToken(objectKey);
  const [inserted] = await executor
    .insert(orphanStorageCleanupLedger)
    .values({
      cleanupId: input.cleanupId,
      provider: input.provider,
      objectKey,
      objectKeyDigest,
      status: "pending",
      attempts: 0,
      nextAttemptAt: input.nextAttemptAt ?? input.occurredAt,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    .onConflictDoNothing({
      target: [orphanStorageCleanupLedger.provider, orphanStorageCleanupLedger.objectKeyDigest],
    })
    .returning({ cleanupId: orphanStorageCleanupLedger.cleanupId });

  if (!inserted) {
    const [existing] = await executor
      .select({ cleanupId: orphanStorageCleanupLedger.cleanupId })
      .from(orphanStorageCleanupLedger)
      .where(
        and(
          eq(orphanStorageCleanupLedger.provider, input.provider),
          eq(orphanStorageCleanupLedger.objectKeyDigest, objectKeyDigest),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("orphan cleanup idempotency lookup failed");
    return existing.cleanupId;
  }

  await appendOutboxEvent(executor, {
    id: input.outboxEventId,
    type: "storage.logo.cleanup",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    aggregate: { type: "storage-cleanup", id: inserted.cleanupId },
    payload: { cleanupId: inserted.cleanupId },
  });
  return inserted.cleanupId;
}

export const StorageCleanupRepository = {
  async enqueueOrphanCleanup(
    database: PostgresJsDatabase<typeof databaseSchema>,
    input: EnqueueOrphanCleanupInput,
  ): Promise<string> {
    return database.transaction((transaction) => enqueueOrphanCleanup(transaction, input));
  },

  async claimOrphanCleanup(
    executor: OrganizationRepositoryExecutor,
    cleanupId: string,
    now: Date,
    leaseMs = CLEANUP_LEASE_MS,
  ): Promise<OrphanCleanupClaimResult> {
    const staleClaimedAt = new Date(now.getTime() - leaseMs);
    const [claimed] = await executor
      .update(orphanStorageCleanupLedger)
      .set({ status: "claimed", claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(orphanStorageCleanupLedger.cleanupId, cleanupId),
          or(
            and(
              or(
                eq(orphanStorageCleanupLedger.status, "pending"),
                eq(orphanStorageCleanupLedger.status, "failed"),
              ),
              lte(orphanStorageCleanupLedger.nextAttemptAt, now),
            ),
            and(
              eq(orphanStorageCleanupLedger.status, "claimed"),
              lte(orphanStorageCleanupLedger.claimedAt, staleClaimedAt),
            ),
          ),
        ),
      )
      .returning();
    if (claimed) return { status: "claimed", cleanup: claimed };

    const [existing] = await executor
      .select({
        status: orphanStorageCleanupLedger.status,
        claimedAt: orphanStorageCleanupLedger.claimedAt,
        nextAttemptAt: orphanStorageCleanupLedger.nextAttemptAt,
      })
      .from(orphanStorageCleanupLedger)
      .where(eq(orphanStorageCleanupLedger.cleanupId, cleanupId))
      .limit(1);
    if (!existing) return { status: "missing" };
    if (existing.status === "completed") return { status: "completed" };
    if (existing.status === "claimed") {
      if (!existing.claimedAt) throw new Error("claimed orphan cleanup has no lease timestamp");
      return {
        status: "leased-until",
        retryAt: new Date(existing.claimedAt.getTime() + leaseMs),
      };
    }
    return { status: "retry-at", retryAt: existing.nextAttemptAt };
  },

  async completeOrphanCleanup(
    executor: OrganizationRepositoryExecutor,
    cleanupId: string,
    now: Date,
  ): Promise<boolean> {
    const [completed] = await executor
      .update(orphanStorageCleanupLedger)
      .set({
        status: "completed",
        attempts: sql`${orphanStorageCleanupLedger.attempts} + 1`,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(orphanStorageCleanupLedger.cleanupId, cleanupId),
          eq(orphanStorageCleanupLedger.status, "claimed"),
        ),
      )
      .returning({ cleanupId: orphanStorageCleanupLedger.cleanupId });
    if (completed) return true;
    const [existing] = await executor
      .select({ status: orphanStorageCleanupLedger.status })
      .from(orphanStorageCleanupLedger)
      .where(eq(orphanStorageCleanupLedger.cleanupId, cleanupId))
      .limit(1);
    return existing?.status === "completed";
  },

  async retryOrphanCleanup(
    executor: OrganizationRepositoryExecutor,
    cleanupId: string,
    input: RetryOrphanCleanupInput,
  ): Promise<boolean> {
    if (input.nextAttemptAt <= input.now) {
      throw new Error("orphan cleanup retry must be scheduled in the future");
    }
    const lastError = input.error.trim().slice(0, 500);
    if (!lastError) throw new Error("orphan cleanup retry requires a failure reason");

    const [retried] = await executor
      .update(orphanStorageCleanupLedger)
      .set({
        status: "failed",
        attempts: sql`${orphanStorageCleanupLedger.attempts} + 1`,
        nextAttemptAt: input.nextAttemptAt,
        claimedAt: null,
        lastError,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(orphanStorageCleanupLedger.cleanupId, cleanupId),
          eq(orphanStorageCleanupLedger.status, "claimed"),
        ),
      )
      .returning({ cleanupId: orphanStorageCleanupLedger.cleanupId });
    if (retried) return true;
    const [existing] = await executor
      .select({ status: orphanStorageCleanupLedger.status })
      .from(orphanStorageCleanupLedger)
      .where(eq(orphanStorageCleanupLedger.cleanupId, cleanupId))
      .limit(1);
    return existing?.status === "failed";
  },
};

export const invitationDurations = { ttlMs: INVITATION_TTL_MS };
