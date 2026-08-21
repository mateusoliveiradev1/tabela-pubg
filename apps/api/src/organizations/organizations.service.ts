import { Injectable } from "@nestjs/common";
import {
  type CreateOrganizationRequest,
  CreateOrganizationRequestSchema,
  type CreateOrganizationResponse,
  CreateOrganizationResponseSchema,
  type OrganizationListResponse,
  OrganizationListResponseSchema,
  type OrganizationLogoResponse,
  OrganizationLogoResponseSchema,
  type OrganizationSummary,
  UpdateOrganizationLogoMultipartRequestSchema,
} from "@pubg-camp/contracts";
import {
  AuditWriter,
  activateLogo,
  appendOutboxEvent,
  createOrganization,
  createPendingLogo,
  type DatabaseConnection,
  enqueueOrphanCleanup,
  findMembershipByUser,
  getActiveLogo,
  listOrganizationsForUser,
  StorageCleanupRepository,
} from "@pubg-camp/database";
import type { StoredOrganizationLogo } from "@pubg-camp/storage/organization-logo";
import type { TokenGenerator } from "../identity/ports/token-generator.js";
import type { OrganizationLogoStorage } from "./ports/organization-logo-storage.js";

export interface OrganizationsClock {
  now(): Date;
}

export interface OrganizationLogoProjection {
  id: string;
  objectKey: string;
  detectedMime: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
}

export interface CreateOrganizationCommand {
  id: string;
  ownerMembershipId: string;
  actorId: string;
  slug: string;
  name: string;
  logo?: OrganizationLogoProjection & { sha256: string; createdAt: Date };
  auditEventId: string;
  outboxEventId: string;
  correlationId: string;
  occurredAt: Date;
}

export interface ReplaceOrganizationLogoCommand {
  actorId: string;
  organizationId: string;
  actorMembershipId: string;
  logo: OrganizationLogoProjection & { sha256: string; createdAt: Date };
  auditEventId: string;
  outboxEventId: string;
  cleanupId: string;
  cleanupOutboxEventId: string;
  correlationId: string;
  occurredAt: Date;
}

export interface OrganizationRepositoryPort {
  create(input: CreateOrganizationCommand): Promise<OrganizationSummary>;
  listForUser(userId: string): Promise<readonly OrganizationSummary[]>;
  authorizeLogoMutation(
    actorId: string,
    organizationId: string,
  ): Promise<{ membershipId: string; role: "owner" | "admin" } | null>;
  getActiveLogoForActor(
    actorId: string,
    organizationId: string,
  ): Promise<OrganizationLogoProjection | null>;
  getActiveLogo(organizationId: string): Promise<OrganizationLogoProjection | null>;
  replaceLogo(
    input: ReplaceOrganizationLogoCommand,
  ): Promise<{ logo: OrganizationLogoProjection; previousObjectKey: string | null }>;
  enqueueOrphanCleanup(input: {
    cleanupId: string;
    objectKey: string;
    outboxEventId: string;
    occurredAt: Date;
  }): Promise<void>;
}

export class PostgresOrganizationRepository implements OrganizationRepositoryPort {
  constructor(private readonly database: DatabaseConnection["db"]) {}

  async create(input: CreateOrganizationCommand): Promise<OrganizationSummary> {
    await this.database.transaction(async (transaction) => {
      await createOrganization(transaction, {
        id: input.id,
        slug: input.slug,
        name: input.name,
        ownerUserId: input.actorId,
        ownerMembershipId: input.ownerMembershipId,
        auditEventId: input.auditEventId,
        outboxEventId: input.outboxEventId,
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
      });
      if (input.logo) {
        await createPendingLogo(transaction, input.id, {
          ...input.logo,
          createdByMembershipId: input.ownerMembershipId,
        });
        await activateLogo(transaction, input.id, input.logo.id, input.occurredAt);
      }
    });
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

  async authorizeLogoMutation(actorId: string, organizationId: string) {
    const membership = await findMembershipByUser(this.database, organizationId, actorId);
    if (
      membership?.status !== "active" ||
      (membership.role !== "owner" && membership.role !== "admin")
    ) {
      return null;
    }
    return { membershipId: membership.id, role: membership.role };
  }

  async getActiveLogoForActor(
    actorId: string,
    organizationId: string,
  ): Promise<OrganizationLogoProjection | null> {
    const membership = await findMembershipByUser(this.database, organizationId, actorId);
    if (membership?.status !== "active") throw new Error("organization action unavailable");
    return this.getActiveLogo(organizationId);
  }

  async getActiveLogo(organizationId: string): Promise<OrganizationLogoProjection | null> {
    const logo = await getActiveLogo(this.database, organizationId);
    return logo
      ? {
          id: logo.id,
          objectKey: logo.objectKey,
          detectedMime: logo.detectedMime,
          byteSize: logo.byteSize,
        }
      : null;
  }

  async replaceLogo(input: ReplaceOrganizationLogoCommand) {
    return this.database.transaction(async (transaction) => {
      const liveMembership = await findMembershipByUser(
        transaction,
        input.organizationId,
        input.actorId,
      );
      if (
        liveMembership?.id !== input.actorMembershipId ||
        liveMembership.status !== "active" ||
        (liveMembership.role !== "owner" && liveMembership.role !== "admin")
      ) {
        throw new Error("organization action unavailable");
      }

      await createPendingLogo(transaction, input.organizationId, {
        ...input.logo,
        createdByMembershipId: input.actorMembershipId,
      });
      const previous = await activateLogo(
        transaction,
        input.organizationId,
        input.logo.id,
        input.occurredAt,
      );
      if (previous) {
        await enqueueOrphanCleanup(transaction, {
          cleanupId: input.cleanupId,
          provider: "s3",
          objectKey: previous.objectKey,
          outboxEventId: input.cleanupOutboxEventId,
          occurredAt: input.occurredAt,
        });
      }
      await AuditWriter.append(transaction, {
        id: input.auditEventId,
        organizationId: input.organizationId,
        actorMembershipId: input.actorMembershipId,
        action: "organization.logo.updated",
        targetType: "organization",
        targetId: input.organizationId,
        reason: "organization branding updated",
        before: previous ? { logoAssetId: previous.id } : null,
        after: { logoAssetId: input.logo.id },
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
      });
      await appendOutboxEvent(transaction, {
        id: input.outboxEventId,
        type: "organization.logo.updated",
        version: 1,
        occurredAt: input.occurredAt.toISOString(),
        correlationId: input.correlationId,
        aggregate: { type: "organization", id: input.organizationId },
        payload: { organizationId: input.organizationId, logoAssetId: input.logo.id },
      });
      return { logo: input.logo, previousObjectKey: previous?.objectKey ?? null };
    });
  }

  async enqueueOrphanCleanup(input: {
    cleanupId: string;
    objectKey: string;
    outboxEventId: string;
    occurredAt: Date;
  }): Promise<void> {
    await StorageCleanupRepository.enqueueOrphanCleanup(this.database, {
      ...input,
      provider: "s3",
    });
  }
}

export interface OrganizationLogoOptions {
  fallbackUrl: string;
  signedUrlTtlSeconds: number;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly repository: OrganizationRepositoryPort,
    private readonly tokens: TokenGenerator,
    private readonly clock: OrganizationsClock,
    private readonly logoStorage: OrganizationLogoStorage,
    private readonly logoOptions: OrganizationLogoOptions,
  ) {
    new URL(logoOptions.fallbackUrl);
    if (
      !Number.isInteger(logoOptions.signedUrlTtlSeconds) ||
      logoOptions.signedUrlTtlSeconds < 1 ||
      logoOptions.signedUrlTtlSeconds > 300
    ) {
      throw new Error("organization logo signed URL TTL must be between 1 and 300 seconds");
    }
  }

  async create(input: {
    actorId: string;
    body: CreateOrganizationRequest;
    logoBytes?: Uint8Array;
    correlationId: string;
  }): Promise<CreateOrganizationResponse> {
    const body = CreateOrganizationRequestSchema.parse(input.body);
    const logoBytes = validateLogoPair(body.logo, input.logoBytes);
    const organizationId = this.tokens.id();
    const occurredAt = this.clock.now();
    let stored: StoredOrganizationLogo | undefined;
    if (body.logo && logoBytes) {
      stored = await this.logoStorage.store({
        organizationId,
        declaredMime: body.logo.declaredMime,
        bytes: logoBytes,
      });
    }

    try {
      const created = await this.repository.create({
        id: organizationId,
        ownerMembershipId: this.tokens.id(),
        actorId: input.actorId,
        slug: organizationSlug(body.name, organizationId),
        name: body.name,
        ...(stored ? { logo: { id: this.tokens.id(), ...stored, createdAt: occurredAt } } : {}),
        auditEventId: this.tokens.id(),
        outboxEventId: this.tokens.id(),
        correlationId: input.correlationId,
        occurredAt,
      });
      return CreateOrganizationResponseSchema.parse({
        organization: {
          ...created,
          logoUrl: stored
            ? await this.signedUrlOrFallback(stored.objectKey)
            : this.logoOptions.fallbackUrl,
        },
      });
    } catch (error) {
      if (stored) await this.compensateStoredObject(stored.objectKey, occurredAt);
      throw error;
    }
  }

  async updateLogo(input: {
    actorId: string;
    organizationId: string;
    body: unknown;
    logoBytes?: Uint8Array;
    correlationId: string;
  }): Promise<OrganizationLogoResponse> {
    const body = UpdateOrganizationLogoMultipartRequestSchema.parse(input.body);
    const logoBytes = validateLogoPair(body.logo, input.logoBytes);
    if (!logoBytes) throw new Error("organization logo bytes are required");
    const authorization = await this.repository.authorizeLogoMutation(
      input.actorId,
      input.organizationId,
    );
    if (!authorization) throw new Error("organization action unavailable");

    const occurredAt = this.clock.now();
    const stored = await this.logoStorage.store({
      organizationId: input.organizationId,
      declaredMime: body.logo.declaredMime,
      bytes: logoBytes,
    });
    const logo = { id: this.tokens.id(), ...stored, createdAt: occurredAt };
    try {
      await this.repository.replaceLogo({
        actorId: input.actorId,
        organizationId: input.organizationId,
        actorMembershipId: authorization.membershipId,
        logo,
        auditEventId: this.tokens.id(),
        outboxEventId: this.tokens.id(),
        cleanupId: this.tokens.id(),
        cleanupOutboxEventId: this.tokens.id(),
        correlationId: input.correlationId,
        occurredAt,
      });
    } catch (error) {
      await this.compensateStoredObject(stored.objectKey, occurredAt);
      throw error;
    }
    return OrganizationLogoResponseSchema.parse({
      id: logo.id,
      detectedMime: logo.detectedMime,
      byteSize: logo.byteSize,
      url: await this.signedUrlOrFallback(logo.objectKey),
    });
  }

  async getLogo(
    actorId: string,
    organizationId: string,
  ): Promise<OrganizationLogoResponse | { url: string; fallback: true }> {
    const logo = await this.repository.getActiveLogoForActor(actorId, organizationId);
    if (!logo) return { url: this.logoOptions.fallbackUrl, fallback: true };
    return OrganizationLogoResponseSchema.parse({
      id: logo.id,
      detectedMime: logo.detectedMime,
      byteSize: logo.byteSize,
      url: await this.signedUrlOrFallback(logo.objectKey),
    });
  }

  async publicLogoUrl(organizationId: string): Promise<string> {
    const logo = await this.repository.getActiveLogo(organizationId);
    return logo ? this.signedUrlOrFallback(logo.objectKey) : this.logoOptions.fallbackUrl;
  }

  async list(actorId: string): Promise<OrganizationListResponse> {
    const organizations = await this.repository.listForUser(actorId);
    const projected = await Promise.all(
      organizations.map(async (organization) => ({
        ...organization,
        logoUrl: await this.publicLogoUrl(organization.id),
      })),
    );
    return OrganizationListResponseSchema.parse({ organizations: projected });
  }

  private async signedUrlOrFallback(objectKey: string): Promise<string> {
    try {
      const signed = await this.logoStorage.createDownloadUrl(
        objectKey,
        this.logoOptions.signedUrlTtlSeconds,
      );
      new URL(signed);
      return signed;
    } catch {
      return this.logoOptions.fallbackUrl;
    }
  }

  private async compensateStoredObject(objectKey: string, occurredAt: Date): Promise<void> {
    try {
      await this.logoStorage.deleteObject(objectKey);
    } catch {
      await this.repository.enqueueOrphanCleanup({
        cleanupId: this.tokens.id(),
        objectKey,
        outboxEventId: this.tokens.id(),
        occurredAt,
      });
    }
  }
}

function validateLogoPair(
  metadata: CreateOrganizationRequest["logo"],
  bytes: Uint8Array | undefined,
): Uint8Array | undefined {
  if ((metadata === undefined) !== (bytes === undefined)) {
    throw new Error("organization logo metadata and bytes must be provided together");
  }
  if (metadata && bytes && metadata.byteSize !== bytes.byteLength) {
    throw new Error("organization logo byte size does not match multipart metadata");
  }
  return bytes;
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
