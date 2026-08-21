import { Injectable } from "@nestjs/common";
import {
  AuditActionSchema,
  type AuditChange,
  type AuditEvent,
  type AuditEventPage,
  AuditEventPageSchema,
  type AuditQuery,
  AuditQuerySchema,
} from "@pubg-camp/contracts";
import {
  type AuditSnapshot,
  AuditWriter,
  type DatabaseConnection,
  findMembershipById,
  findMembershipByUser,
  findOrganizationById,
  findUserById,
  findVerifiedEmailForUser,
} from "@pubg-camp/database";

export type AuditVisibility = "all" | "self";

export interface ResolvedAuditQuery extends Omit<AuditQuery, "actorId" | "visibility"> {
  viewerActorId: string;
  visibility: AuditVisibility;
  actorId?: string;
}

export interface AuditRepositoryPort {
  resolveVisibility(actorId: string, organizationId: string): Promise<AuditVisibility | null>;
  query(input: ResolvedAuditQuery): Promise<AuditEventPage>;
}

export class PostgresAuditRepository implements AuditRepositoryPort {
  constructor(private readonly database: DatabaseConnection["db"]) {}

  async resolveVisibility(
    actorId: string,
    organizationId: string,
  ): Promise<AuditVisibility | null> {
    const membership = await findMembershipByUser(this.database, organizationId, actorId);
    if (membership?.status !== "active") return null;
    return membership.role === "owner" || membership.role === "admin" ? "all" : "self";
  }

  async query(input: ResolvedAuditQuery): Promise<AuditEventPage> {
    const viewerMembership = await findMembershipByUser(
      this.database,
      input.organizationId,
      input.viewerActorId,
    );
    if (!viewerMembership) throw new Error("audit unavailable");
    const actorMembership = input.actorId
      ? await findMembershipByUser(this.database, input.organizationId, input.actorId)
      : null;
    if (input.actorId && !actorMembership) {
      return emptyAuditPage(input);
    }
    const { rows, total } = await AuditWriter.listVisiblePage(this.database, {
      organizationId: input.organizationId,
      viewerMembershipId: viewerMembership.id,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
      ...(actorMembership === null ? {} : { actorMembershipId: actorMembership.id }),
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.authorizationScopeId === undefined
        ? {}
        : { authorizationScopeId: input.authorizationScopeId }),
      ...(input.from === undefined ? {} : { from: new Date(input.from) }),
      ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    });
    const projected: AuditEvent[] = [];
    for (const row of rows) {
      const rowActorMembership = await findMembershipById(
        this.database,
        input.organizationId,
        row.actorMembershipId,
      );
      if (!rowActorMembership) continue;
      const actor = await findUserById(this.database, rowActorMembership.userId);
      if (!actor) continue;
      const email = await findVerifiedEmailForUser(this.database, rowActorMembership.userId);
      const organization = await findOrganizationById(this.database, input.organizationId);
      const scope = row.authorizationScopeId
        ? (
            await this.database.query.authorizationScopes.findMany({
              where: (table, operators) =>
                operators.and(
                  operators.eq(table.organizationId, input.organizationId),
                  operators.eq(table.id, row.authorizationScopeId as string),
                ),
              limit: 1,
            })
          )[0]
        : null;
      const parsedAction = AuditActionSchema.safeParse(row.action);
      if (!parsedAction.success) continue;
      projected.push({
        id: row.id,
        actor: {
          displayName: actor.displayName,
          maskedEmail: email ? maskEmail(email) : null,
        },
        action: parsedAction.data,
        targetLabel: targetLabel(row.targetType),
        scopeLabel: scope?.label ?? organization?.name ?? "Organização",
        authorizationScopeId: row.authorizationScopeId,
        correlationId: row.correlationId,
        reason: row.reason,
        occurredAt: row.occurredAt.toISOString(),
        changes: projectAuditChanges(row.before, row.after),
      });
    }
    return AuditEventPageSchema.parse({
      visibility: input.visibility,
      events: projected,
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
    });
  }
}

function emptyAuditPage(input: ResolvedAuditQuery): AuditEventPage {
  return AuditEventPageSchema.parse({
    visibility: input.visibility,
    events: [],
    page: input.page,
    pageSize: input.pageSize,
    total: 0,
    totalPages: 0,
  });
}

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepositoryPort) {}

  async query(actorId: string, rawQuery: unknown): Promise<AuditEventPage> {
    const query = parseAuditQuery(rawQuery);
    const visibility = await this.repository.resolveVisibility(actorId, query.organizationId);
    if (!visibility) throw new Error("audit unavailable");
    return this.repository.query({
      organizationId: query.organizationId,
      page: query.page,
      pageSize: query.pageSize,
      viewerActorId: actorId,
      visibility,
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.authorizationScopeId === undefined
        ? {}
        : { authorizationScopeId: query.authorizationScopeId }),
      ...(visibility === "self"
        ? { actorId }
        : query.actorId === undefined
          ? {}
          : { actorId: query.actorId }),
    });
  }
}

const projectedFields: readonly AuditChange["field"][] = [
  "organizationName",
  "organizationLogo",
  "membershipStatus",
  "organizationRole",
  "operationalRoles",
  "ownership",
  "identityProvider",
  "sessionStatus",
  "invitationStatus",
];
const secretValue = /(?:ciphertext|cookie|otp|password|secret|token)|@/i;

export function projectAuditChanges(
  before: AuditSnapshot | null | undefined,
  after: AuditSnapshot | null | undefined,
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const key of projectedFields) {
    const beforeValue = safeDisplayValue(before?.[key]);
    const afterValue = safeDisplayValue(after?.[key]);
    if (beforeValue === afterValue) continue;
    changes.push({ field: key, before: beforeValue, after: afterValue });
  }
  return changes;
}

function parseAuditQuery(rawQuery: unknown): AuditQuery {
  const raw = (rawQuery ?? {}) as Record<string, unknown>;
  return AuditQuerySchema.parse({
    ...raw,
    page: raw.page === undefined ? 1 : Number(raw.page),
    pageSize: raw.pageSize === undefined ? 25 : Number(raw.pageSize),
  });
}

function safeDisplayValue(value: string | null | undefined): string | null {
  if (value === undefined || value === null || secretValue.test(value)) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

function maskEmail(email: string): string {
  const [local = "u", domain = "invalid.local"] = email.split("@", 2);
  return `${local.slice(0, 1)}***@${domain}`;
}

function targetLabel(targetType: string): string {
  switch (targetType) {
    case "organization":
      return "Organização";
    case "organization-membership":
      return "Membro";
    case "invitation":
      return "Convite";
    case "session":
      return "Sessão";
    default:
      return "Alteração";
  }
}
