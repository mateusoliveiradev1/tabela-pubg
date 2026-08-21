import { Injectable } from "@nestjs/common";
import {
  type MembershipMutationResponse,
  MembershipMutationResponseSchema,
  type MembershipSummary,
  MembershipSummarySchema,
  type TransferOwnershipRequest,
  TransferOwnershipRequestSchema,
  type TransferOwnershipResponse,
  TransferOwnershipResponseSchema,
  type UpdateMembershipRequest,
  UpdateMembershipRequestSchema,
} from "@pubg-camp/contracts";
import {
  type DatabaseConnection,
  findMembershipById,
  findMembershipByUser,
  findOrganizationById,
  findUserById,
  findVerifiedEmailForUser,
  listActiveAssignmentsForMembership,
  listMembershipsForOrganization,
  revokeMembership,
  revokeOtherSessions,
  transferOwnership,
  updateMembershipRoles,
} from "@pubg-camp/database";
import type { SessionService } from "../identity/session.service.js";

export interface MembersClock {
  now(): Date;
}

export type RecentReauthenticationPort = Pick<SessionService, "requireRecentReauthentication">;

interface MemberMutationIdentity {
  actorId: string;
  sessionId: string;
  organizationId: string;
  correlationId: string;
  occurredAt: Date;
}

export type MemberUpdateResult =
  | { status: "updated"; membership: MembershipSummary }
  | { status: "last-owner" | "unavailable" };
export type MemberRevokeResult =
  | { status: "revoked"; membership: MembershipSummary }
  | { status: "last-owner" | "unavailable" };
export type OwnershipTransferResult =
  | ({ status: "transferred" } & TransferOwnershipResponse)
  | { status: "unavailable" };

export interface MemberRepositoryPort {
  organizationName(actorId: string, organizationId: string): Promise<string | null>;
  list(actorId: string, organizationId: string): Promise<readonly MembershipSummary[]>;
  update(
    input: MemberMutationIdentity & {
      membershipId: string;
      body: UpdateMembershipRequest;
    },
  ): Promise<MemberUpdateResult>;
  revoke(
    input: MemberMutationIdentity & { membershipId: string; reason: string },
  ): Promise<MemberRevokeResult>;
  transferOwnership(
    input: MemberMutationIdentity & {
      organizationNameConfirmation: string;
      targetMembershipId: string;
      reason: string;
    },
  ): Promise<OwnershipTransferResult>;
}

export class PostgresMemberRepository implements MemberRepositoryPort {
  constructor(
    private readonly database: DatabaseConnection["db"],
    private readonly generateId: () => string,
  ) {}

  async organizationName(actorId: string, organizationId: string): Promise<string | null> {
    const actor = await findMembershipByUser(this.database, organizationId, actorId);
    if (actor?.status !== "active") return null;
    return (await findOrganizationById(this.database, organizationId))?.name ?? null;
  }

  async list(actorId: string, organizationId: string): Promise<readonly MembershipSummary[]> {
    const actor = await findMembershipByUser(this.database, organizationId, actorId);
    if (actor?.status !== "active") throw new Error("organization action unavailable");
    const memberships = await listMembershipsForOrganization(this.database, organizationId);
    return Promise.all(
      memberships.map(async (membership) => {
        const summary = await projectMembership(this.database, organizationId, membership.id);
        if (!summary) throw new Error("membership projection unavailable");
        return summary;
      }),
    );
  }

  async update(
    input: MemberMutationIdentity & {
      membershipId: string;
      body: UpdateMembershipRequest;
    },
  ): Promise<MemberUpdateResult> {
    const result = await this.database.transaction(async (transaction) => {
      const actor = await findMembershipByUser(transaction, input.organizationId, input.actorId);
      if (actor?.status !== "active") return { status: "unavailable" as const };
      return updateMembershipRoles(transaction, input.organizationId, input.membershipId, {
        actorMembershipId: actor.id,
        organizationRole: input.body.organizationRole,
        rolePayload: input.body.assignments,
        assignmentIds: input.body.assignments.map(() => this.generateId()),
        auditEventId: this.generateId(),
        outboxEventId: this.generateId(),
        correlationId: input.correlationId,
        reason: input.body.reason,
        occurredAt: input.occurredAt,
      });
    });
    if (result.status !== "updated") return result;
    const membership = await projectMembership(
      this.database,
      input.organizationId,
      input.membershipId,
    );
    if (!membership) return { status: "unavailable" };
    return { status: "updated", membership };
  }

  async revoke(
    input: MemberMutationIdentity & { membershipId: string; reason: string },
  ): Promise<MemberRevokeResult> {
    const result = await this.database.transaction(async (transaction) => {
      const actor = await findMembershipByUser(transaction, input.organizationId, input.actorId);
      if (actor?.status !== "active") return { status: "unavailable" as const };
      return revokeMembership(transaction, input.organizationId, input.membershipId, actor.id, {
        auditEventId: this.generateId(),
        outboxEventId: this.generateId(),
        correlationId: input.correlationId,
        reason: input.reason,
        occurredAt: input.occurredAt,
      });
    });
    if (result.status !== "revoked") return result;
    const membership = await projectMembership(
      this.database,
      input.organizationId,
      input.membershipId,
    );
    if (!membership) return { status: "unavailable" };
    return { status: "revoked", membership };
  }

  async transferOwnership(
    input: MemberMutationIdentity & {
      organizationNameConfirmation: string;
      targetMembershipId: string;
      reason: string;
    },
  ): Promise<OwnershipTransferResult> {
    const result = await this.database.transaction(async (transaction) => {
      const actor = await findMembershipByUser(transaction, input.organizationId, input.actorId);
      const organization = await findOrganizationById(transaction, input.organizationId);
      if (
        actor?.status !== "active" ||
        actor.role !== "owner" ||
        !organization ||
        organization.name !== input.organizationNameConfirmation
      ) {
        return { status: "unavailable" as const };
      }
      const transferred = await transferOwnership(
        transaction,
        input.organizationId,
        actor.id,
        input.targetMembershipId,
        {
          auditEventId: this.generateId(),
          outboxEventId: this.generateId(),
          correlationId: input.correlationId,
          reason: input.reason,
          occurredAt: input.occurredAt,
        },
      );
      if (transferred.status !== "transferred") return transferred;
      const otherSessionsRevoked = await revokeOtherSessions(
        transaction,
        input.actorId,
        input.sessionId,
        "ownership-transfer",
        () => input.occurredAt,
      );
      return { status: "transferred" as const, otherSessionsRevoked, actorMembershipId: actor.id };
    });
    if (result.status !== "transferred") return result;
    const currentMembership = await projectMembership(
      this.database,
      input.organizationId,
      result.actorMembershipId,
    );
    const newOwnerMembership = await projectMembership(
      this.database,
      input.organizationId,
      input.targetMembershipId,
    );
    if (!currentMembership || !newOwnerMembership) return { status: "unavailable" };
    return {
      status: "transferred",
      currentMembership,
      newOwnerMembership,
      otherSessionsRevoked: result.otherSessionsRevoked,
    };
  }
}

@Injectable()
export class MembersService {
  constructor(
    private readonly repository: MemberRepositoryPort,
    private readonly sessions: RecentReauthenticationPort,
    private readonly clock: MembersClock,
  ) {}

  async list(actorId: string, organizationId: string) {
    return { members: await this.repository.list(actorId, organizationId) };
  }

  async update(input: {
    actorId: string;
    sessionId: string;
    organizationId: string;
    membershipId: string;
    body: UpdateMembershipRequest;
    correlationId: string;
  }): Promise<MembershipMutationResponse> {
    const body = UpdateMembershipRequestSchema.parse(input.body);
    await this.sessions.requireRecentReauthentication(input.actorId, input.sessionId);
    const result = await this.repository.update({
      ...input,
      body,
      occurredAt: this.clock.now(),
    });
    if (result.status === "last-owner") throw new Error("ownership transfer required");
    if (result.status !== "updated") throw new Error("membership action unavailable");
    return MembershipMutationResponseSchema.parse(result);
  }

  async revoke(input: {
    actorId: string;
    sessionId: string;
    organizationId: string;
    membershipId: string;
    reason: string;
    correlationId: string;
  }): Promise<MembershipMutationResponse> {
    const body = UpdateMembershipRequestSchema.shape.reason.parse(input.reason);
    await this.sessions.requireRecentReauthentication(input.actorId, input.sessionId);
    const result = await this.repository.revoke({
      ...input,
      reason: body,
      occurredAt: this.clock.now(),
    });
    if (result.status === "last-owner") throw new Error("ownership transfer required");
    if (result.status !== "revoked") throw new Error("membership action unavailable");
    return MembershipMutationResponseSchema.parse(result);
  }

  async transferOwnership(input: {
    actorId: string;
    sessionId: string;
    organizationId: string;
    body: TransferOwnershipRequest;
    correlationId: string;
  }): Promise<TransferOwnershipResponse> {
    const body = TransferOwnershipRequestSchema.parse(input.body);
    const organizationName = await this.repository.organizationName(
      input.actorId,
      input.organizationId,
    );
    if (organizationName !== body.organizationNameConfirmation) {
      throw new Error("organization name confirmation does not match");
    }
    await this.sessions.requireRecentReauthentication(input.actorId, input.sessionId);
    const result = await this.repository.transferOwnership({
      ...input,
      ...body,
      occurredAt: this.clock.now(),
    });
    if (result.status !== "transferred") throw new Error("membership action unavailable");
    return TransferOwnershipResponseSchema.parse(result);
  }
}

async function projectMembership(
  database: DatabaseConnection["db"],
  organizationId: string,
  membershipId: string,
): Promise<MembershipSummary | null> {
  const membership = await findMembershipById(database, organizationId, membershipId);
  if (!membership) return null;
  const user = await findUserById(database, membership.userId);
  if (!user) return null;
  const email = await findVerifiedEmailForUser(database, membership.userId);
  const assignments = await listActiveAssignmentsForMembership(
    database,
    organizationId,
    membershipId,
  );
  return MembershipSummarySchema.parse({
    id: membership.id,
    user: {
      id: user.id,
      displayName: user.displayName,
      maskedEmail: email ? maskEmail(email) : null,
    },
    organizationRole: membership.role,
    status: membership.status,
    assignments: assignments.map((assignment) => ({
      authorizationScopeId: assignment.authorizationScopeId,
      role: assignment.role,
      scopeName: assignment.scopeName,
    })),
    joinedAt: membership.joinedAt.toISOString(),
  });
}

function maskEmail(email: string): string {
  const [local = "u", domain = "invalid.local"] = email.split("@", 2);
  return `${local.slice(0, 1)}***@${domain}`;
}
