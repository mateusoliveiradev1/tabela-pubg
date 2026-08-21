import { Injectable } from "@nestjs/common";
import {
  type CreateOrganizationRequest,
  CreateOrganizationRequestSchema,
  type CreateOrganizationResponse,
  CreateOrganizationResponseSchema,
  type OrganizationListResponse,
  OrganizationListResponseSchema,
  type OrganizationSummary,
} from "@pubg-camp/contracts";
import {
  createOrganization,
  type DatabaseConnection,
  listOrganizationsForUser,
} from "@pubg-camp/database";
import type { TokenGenerator } from "../identity/ports/token-generator.js";

export interface OrganizationsClock {
  now(): Date;
}

export interface CreateOrganizationCommand {
  id: string;
  ownerMembershipId: string;
  actorId: string;
  slug: string;
  name: string;
  logo?: CreateOrganizationRequest["logo"];
  auditEventId: string;
  outboxEventId: string;
  correlationId: string;
  occurredAt: Date;
}

export interface OrganizationRepositoryPort {
  create(input: CreateOrganizationCommand): Promise<OrganizationSummary>;
  listForUser(userId: string): Promise<readonly OrganizationSummary[]>;
}

export class PostgresOrganizationRepository implements OrganizationRepositoryPort {
  constructor(private readonly database: DatabaseConnection["db"]) {}

  async create(input: CreateOrganizationCommand): Promise<OrganizationSummary> {
    await this.database.transaction((transaction) =>
      createOrganization(transaction, {
        id: input.id,
        slug: input.slug,
        name: input.name,
        ownerUserId: input.actorId,
        ownerMembershipId: input.ownerMembershipId,
        auditEventId: input.auditEventId,
        outboxEventId: input.outboxEventId,
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
      }),
    );
    return {
      id: input.id,
      slug: input.slug,
      name: input.name,
      logoUrl: null,
      membershipRole: "owner",
    };
  }

  async listForUser(userId: string): Promise<readonly OrganizationSummary[]> {
    const rows = await listOrganizationsForUser(this.database, userId);
    return rows.map(({ organization, membership }) => ({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      logoUrl: null,
      membershipRole: membership.role,
    }));
  }
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly repository: OrganizationRepositoryPort,
    private readonly tokens: TokenGenerator,
    private readonly clock: OrganizationsClock,
  ) {}

  async create(input: {
    actorId: string;
    body: CreateOrganizationRequest;
    correlationId: string;
  }): Promise<CreateOrganizationResponse> {
    const body = CreateOrganizationRequestSchema.parse(input.body);
    const organizationId = this.tokens.id();
    const created = await this.repository.create({
      id: organizationId,
      ownerMembershipId: this.tokens.id(),
      actorId: input.actorId,
      slug: organizationSlug(body.name, organizationId),
      name: body.name,
      ...(body.logo === undefined ? {} : { logo: body.logo }),
      auditEventId: this.tokens.id(),
      outboxEventId: this.tokens.id(),
      correlationId: input.correlationId,
      occurredAt: this.clock.now(),
    });
    return CreateOrganizationResponseSchema.parse({ organization: created });
  }

  async list(actorId: string): Promise<OrganizationListResponse> {
    const organizations = await this.repository.listForUser(actorId);
    return OrganizationListResponseSchema.parse({ organizations });
  }
}

function organizationSlug(name: string, id: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
  const suffix = id.replaceAll("-", "").slice(0, 12).toLowerCase();
  return `${base || "organizacao"}-${suffix}`;
}
