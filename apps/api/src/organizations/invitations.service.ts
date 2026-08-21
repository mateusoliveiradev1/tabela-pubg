import { Injectable } from "@nestjs/common";
import {
  type AcceptInvitationResponse,
  AcceptInvitationResponseSchema,
  type CreateInvitationRequest,
  CreateInvitationRequestSchema,
  type CreateInvitationResponse,
  CreateInvitationResponseSchema,
  type InvitationActionResponse,
  InvitationActionResponseSchema,
  type InvitationListItem,
  InvitationListResponseSchema,
  type InvitationPreviewResponse,
  InvitationPreviewResponseSchema,
  type MembershipSummary,
  MembershipSummarySchema,
  type OperationalAssignmentSummary,
} from "@pubg-camp/contracts";
import {
  acceptInvitation,
  createInvitation,
  type DatabaseConnection,
  type EncryptionKey,
  findInvitationByToken,
  findMembershipById,
  findMembershipByUser,
  findOrganizationById,
  findUserById,
  findVerifiedEmailForUser,
  invitationDurations,
  listActiveAssignmentsForMembership,
  listInvitationsForOrganization,
  createEncryptedNotificationDelivery as notificationDeliver,
  resendInvitation,
  revokeInvitation,
} from "@pubg-camp/database";
import type { TokenGenerator } from "../identity/ports/token-generator.js";

export interface InvitationsClock {
  now(): Date;
}

interface InvitationMutationIdentity {
  actorId: string;
  organizationId: string;
  correlationId: string;
  occurredAt: Date;
}

export interface CreateInvitationDeliveryCommand extends InvitationMutationIdentity {
  invitationId: string;
  deliveryId: string;
  auditEventId: string;
  invitationOutboxEventId: string;
  notificationOutboxEventId: string;
  email: string;
  token: string;
  organizationRole: "admin" | "member";
  assignments: CreateInvitationRequest["assignments"];
}

export interface ResendInvitationDeliveryCommand extends InvitationMutationIdentity {
  previousInvitationId: string;
  invitationId: string;
  deliveryId: string;
  auditEventId: string;
  invitationOutboxEventId: string;
  notificationOutboxEventId: string;
  token: string;
  reason: string;
}

export type InvitationAcceptance =
  | { status: "unavailable" }
  | { status: "accepted"; organization: unknown; membership: unknown };

export interface InvitationRepositoryPort {
  createWithDelivery(
    input: CreateInvitationDeliveryCommand,
  ): Promise<{ invitationId: string; expiresAt: Date }>;
  resendWithDelivery(
    input: ResendInvitationDeliveryCommand,
  ): Promise<{ invitationId: string; expiresAt: Date }>;
  revoke(
    input: InvitationMutationIdentity & { invitationId: string; reason: string },
  ): Promise<boolean>;
  preview(input: { actorId: string; token: string; now: Date }): Promise<InvitationPreviewResponse>;
  accept(input: {
    actorId: string;
    token: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<InvitationAcceptance>;
  list(actorId: string, organizationId: string, now: Date): Promise<readonly InvitationListItem[]>;
}

export class PostgresInvitationRepository implements InvitationRepositoryPort {
  constructor(
    private readonly database: DatabaseConnection["db"],
    private readonly encryptionKey: EncryptionKey,
    private readonly generateId: () => string,
  ) {}

  async createWithDelivery(
    input: CreateInvitationDeliveryCommand,
  ): Promise<{ invitationId: string; expiresAt: Date }> {
    const expiresAt = new Date(input.occurredAt.getTime() + invitationDurations.ttlMs);
    await this.database.transaction(async (transaction) => {
      const actor = await findMembershipByUser(transaction, input.organizationId, input.actorId);
      const organization = await findOrganizationById(transaction, input.organizationId);
      if (actor?.status !== "active" || !organization) {
        throw new Error("organization action unavailable");
      }
      await createInvitation(transaction, input.organizationId, {
        id: input.invitationId,
        invitedByMembershipId: actor.id,
        email: input.email,
        token: input.token,
        organizationRole: input.organizationRole,
        rolePayload: input.assignments,
        issuedAt: input.occurredAt,
        auditEventId: input.auditEventId,
        outboxEventId: input.invitationOutboxEventId,
        correlationId: input.correlationId,
        reason: "member invited",
        occurredAt: input.occurredAt,
      });
      await notificationDeliver(transaction, {
        id: input.deliveryId,
        template: "invitation",
        recipient: input.email,
        idempotencyKey: `invitation:${input.invitationId}`,
        encryptionKey: this.encryptionKey,
        payload: {
          recipient: input.email,
          invitationToken: input.token,
          organizationName: organization.name,
          expiresAt: expiresAt.toISOString(),
        },
        payloadExpiresAt: expiresAt,
        availableAt: input.occurredAt,
        outboxEventId: input.notificationOutboxEventId,
        occurredAt: input.occurredAt,
        correlationId: input.correlationId,
      });
    });
    return { invitationId: input.invitationId, expiresAt };
  }

  async resendWithDelivery(
    input: ResendInvitationDeliveryCommand,
  ): Promise<{ invitationId: string; expiresAt: Date }> {
    const expiresAt = new Date(input.occurredAt.getTime() + invitationDurations.ttlMs);
    await this.database.transaction(async (transaction) => {
      const actor = await findMembershipByUser(transaction, input.organizationId, input.actorId);
      const organization = await findOrganizationById(transaction, input.organizationId);
      if (actor?.status !== "active" || !organization) {
        throw new Error("organization action unavailable");
      }
      const resent = await resendInvitation(
        transaction,
        input.organizationId,
        input.previousInvitationId,
        {
          id: input.invitationId,
          actorMembershipId: actor.id,
          token: input.token,
          issuedAt: input.occurredAt,
          auditEventId: input.auditEventId,
          outboxEventId: input.invitationOutboxEventId,
          correlationId: input.correlationId,
          reason: input.reason,
          occurredAt: input.occurredAt,
        },
      );
      if (resent.status !== "reissued") throw new Error("invitation action unavailable");
      await notificationDeliver(transaction, {
        id: input.deliveryId,
        template: "invitation",
        recipient: resent.invitation.normalizedEmail,
        idempotencyKey: `invitation:${input.invitationId}`,
        encryptionKey: this.encryptionKey,
        payload: {
          recipient: resent.invitation.normalizedEmail,
          invitationToken: input.token,
          organizationName: organization.name,
          expiresAt: expiresAt.toISOString(),
        },
        payloadExpiresAt: expiresAt,
        availableAt: input.occurredAt,
        outboxEventId: input.notificationOutboxEventId,
        occurredAt: input.occurredAt,
        correlationId: input.correlationId,
      });
    });
    return { invitationId: input.invitationId, expiresAt };
  }

  async revoke(
    input: InvitationMutationIdentity & { invitationId: string; reason: string },
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const actor = await findMembershipByUser(transaction, input.organizationId, input.actorId);
      if (actor?.status !== "active") return false;
      return revokeInvitation(transaction, input.organizationId, input.invitationId, {
        actorMembershipId: actor.id,
        auditEventId: this.generateId(),
        outboxEventId: this.generateId(),
        correlationId: input.correlationId,
        reason: input.reason,
        occurredAt: input.occurredAt,
      });
    });
  }

  async preview(input: {
    actorId: string;
    token: string;
    now: Date;
  }): Promise<InvitationPreviewResponse> {
    const invitation = await findInvitationByToken(this.database, input.token);
    if (!invitation) return { status: "invalid" };
    const organization = await findOrganizationById(this.database, invitation.organizationId);
    if (!organization) return { status: "invalid" };
    if (invitation.acceptedAt) return { status: "used", organizationSlug: organization.slug };
    if (invitation.revokedAt || invitation.supersededAt) return { status: "revoked" };
    if (invitation.expiresAt <= input.now) return { status: "expired" };
    const inviterMembership = await findMembershipById(
      this.database,
      invitation.organizationId,
      invitation.invitedByMembershipId,
    );
    const inviter = inviterMembership
      ? await findUserById(this.database, inviterMembership.userId)
      : null;
    const verifiedEmail = await findVerifiedEmailForUser(this.database, input.actorId);
    const assignments = await assignmentPayloadSummary(
      this.database,
      invitation.organizationId,
      invitation.rolePayload,
    );
    return InvitationPreviewResponseSchema.parse({
      status: "valid",
      organization: { id: organization.id, name: organization.name, logoUrl: null },
      invitedBy: inviter?.displayName ?? "Organização",
      maskedEmail: maskEmail(invitation.normalizedEmail),
      organizationRole: invitation.organizationRole,
      assignments,
      expiresAt: invitation.expiresAt.toISOString(),
      emailMatches: verifiedEmail === invitation.normalizedEmail,
    });
  }

  async accept(input: {
    actorId: string;
    token: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<InvitationAcceptance> {
    const invitation = await findInvitationByToken(this.database, input.token);
    if (!invitation) return { status: "unavailable" };
    const membershipId = this.generateId();
    const result = await this.database.transaction((transaction) =>
      acceptInvitation(transaction, invitation.organizationId, input.token, input.actorId, {
        membershipId,
        assignmentIds: invitation.rolePayload.map(() => this.generateId()),
        auditEventId: this.generateId(),
        outboxEventId: this.generateId(),
        correlationId: input.correlationId,
        reason: "invitation accepted by verified recipient",
        occurredAt: input.occurredAt,
      }),
    );
    if (result.status !== "accepted") return { status: "unavailable" };
    const organization = await findOrganizationById(this.database, invitation.organizationId);
    const membership = await membershipSummary(
      this.database,
      invitation.organizationId,
      membershipId,
    );
    if (!organization || !membership) throw new Error("accepted invitation projection unavailable");
    return {
      status: "accepted",
      organization: {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        logoUrl: null,
        membershipRole: membership.organizationRole,
      },
      membership,
    };
  }

  async list(
    actorId: string,
    organizationId: string,
    now: Date,
  ): Promise<readonly InvitationListItem[]> {
    const actor = await findMembershipByUser(this.database, organizationId, actorId);
    if (actor?.status !== "active" || (actor.role !== "owner" && actor.role !== "admin")) {
      throw new Error("organization action unavailable");
    }
    const invitations = await listInvitationsForOrganization(this.database, organizationId);
    return Promise.all(
      invitations.map(async (invitation) => {
        const inviterMembership = await findMembershipById(
          this.database,
          organizationId,
          invitation.invitedByMembershipId,
        );
        const inviter = inviterMembership
          ? await findUserById(this.database, inviterMembership.userId)
          : null;
        return {
          id: invitation.id,
          maskedEmail: maskEmail(invitation.normalizedEmail),
          organizationRole: invitation.organizationRole,
          assignments: await assignmentPayloadSummary(
            this.database,
            organizationId,
            invitation.rolePayload,
          ),
          invitedBy: inviter?.displayName ?? "Organização",
          status: invitationStatus(invitation, now),
          createdAt: invitation.createdAt.toISOString(),
          expiresAt: invitation.expiresAt.toISOString(),
        };
      }),
    );
  }
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly repository: InvitationRepositoryPort,
    private readonly tokens: TokenGenerator,
    private readonly clock: InvitationsClock,
  ) {}

  async create(input: {
    actorId: string;
    organizationId: string;
    body: CreateInvitationRequest;
    correlationId: string;
  }): Promise<CreateInvitationResponse> {
    const body = CreateInvitationRequestSchema.parse(input.body);
    const occurredAt = this.clock.now();
    const created = await this.repository.createWithDelivery({
      actorId: input.actorId,
      organizationId: input.organizationId,
      invitationId: this.tokens.id(),
      deliveryId: this.tokens.id(),
      auditEventId: this.tokens.id(),
      invitationOutboxEventId: this.tokens.id(),
      notificationOutboxEventId: this.tokens.id(),
      correlationId: input.correlationId,
      occurredAt,
      email: body.email.trim().toLowerCase(),
      token: this.tokens.opaque(32),
      organizationRole: body.organizationRole,
      assignments: body.assignments,
    });
    return CreateInvitationResponseSchema.parse({
      status: "accepted",
      expiresAt: created.expiresAt.toISOString(),
    });
  }

  async resend(input: {
    actorId: string;
    organizationId: string;
    invitationId: string;
    reason: string;
    correlationId: string;
  }): Promise<InvitationActionResponse> {
    const occurredAt = this.clock.now();
    const resent = await this.repository.resendWithDelivery({
      actorId: input.actorId,
      organizationId: input.organizationId,
      previousInvitationId: input.invitationId,
      invitationId: this.tokens.id(),
      deliveryId: this.tokens.id(),
      auditEventId: this.tokens.id(),
      invitationOutboxEventId: this.tokens.id(),
      notificationOutboxEventId: this.tokens.id(),
      token: this.tokens.opaque(32),
      reason: input.reason,
      correlationId: input.correlationId,
      occurredAt,
    });
    return InvitationActionResponseSchema.parse({
      status: "reissued",
      expiresAt: resent.expiresAt.toISOString(),
    });
  }

  async revoke(input: {
    actorId: string;
    organizationId: string;
    invitationId: string;
    reason: string;
    correlationId: string;
  }): Promise<InvitationActionResponse> {
    const revoked = await this.repository.revoke({
      ...input,
      occurredAt: this.clock.now(),
    });
    if (!revoked) throw new Error("invitation action unavailable");
    return InvitationActionResponseSchema.parse({ status: "revoked" });
  }

  preview(actorId: string, token: string): Promise<InvitationPreviewResponse> {
    return this.repository.preview({ actorId, token, now: this.clock.now() });
  }

  async accept(input: {
    actorId: string;
    token: string;
    confirmation: boolean;
    correlationId: string;
  }): Promise<AcceptInvitationResponse> {
    if (input.confirmation !== true) throw new Error("invitation confirmation required");
    const result = await this.repository.accept({
      actorId: input.actorId,
      token: input.token,
      correlationId: input.correlationId,
      occurredAt: this.clock.now(),
    });
    if (result.status !== "accepted") throw new Error("invitation action unavailable");
    return AcceptInvitationResponseSchema.parse(result);
  }

  async list(actorId: string, organizationId: string) {
    const invitations = await this.repository.list(actorId, organizationId, this.clock.now());
    return InvitationListResponseSchema.parse({ invitations });
  }
}

async function membershipSummary(
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

async function assignmentPayloadSummary(
  database: DatabaseConnection["db"],
  organizationId: string,
  assignments: readonly {
    authorizationScopeId: string;
    role: OperationalAssignmentSummary["role"];
  }[],
): Promise<OperationalAssignmentSummary[]> {
  const summaries: OperationalAssignmentSummary[] = [];
  for (const assignment of assignments) {
    const rows = await database.query.authorizationScopes.findMany({
      where: (scope, operators) =>
        operators.and(
          operators.eq(scope.organizationId, organizationId),
          operators.eq(scope.id, assignment.authorizationScopeId),
        ),
      limit: 1,
    });
    const scope = rows[0];
    if (!scope) throw new Error("invitation scope unavailable");
    summaries.push({ ...assignment, scopeName: scope.label });
  }
  return summaries;
}

function maskEmail(email: string): string {
  const [local = "u", domain = "invalid.local"] = email.split("@", 2);
  return `${local.slice(0, 1)}***@${domain}`;
}

function invitationStatus(
  invitation: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    supersededAt: Date | null;
    expiresAt: Date;
  },
  now: Date,
): InvitationListItem["status"] {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt || invitation.supersededAt) return "revoked";
  if (invitation.expiresAt <= now) return "expired";
  return "active";
}
