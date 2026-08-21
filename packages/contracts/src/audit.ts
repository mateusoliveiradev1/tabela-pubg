import { z } from "zod";

const PublicIdSchema = z.uuid();
const TimestampSchema = z.iso.datetime();
const MaskedEmailSchema = z.string().regex(/^[^@\s]*[•*][^@\s]*@[^@\s]+\.[^@\s]+$/);

export const AuditVisibilitySchema = z.enum(["all", "self"]);
export const AuditActionSchema = z.enum([
  "identity.linked",
  "identity.email.changed",
  "session.revoked",
  "organization.created",
  "organization.updated",
  "invitation.created",
  "invitation.revoked",
  "invitation.accepted",
  "membership.roles.updated",
  "membership.revoked",
  "ownership.transferred",
]);

export const AuditChangeFieldSchema = z.enum([
  "organizationName",
  "organizationLogo",
  "membershipStatus",
  "organizationRole",
  "operationalRoles",
  "ownership",
  "identityProvider",
  "emailAddress",
  "sessionStatus",
  "invitationStatus",
]);

export const AuditQuerySchema = z
  .object({
    organizationId: PublicIdSchema,
    visibility: AuditVisibilitySchema,
    page: z.int().positive().default(1),
    pageSize: z.int().min(1).max(100).default(25),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
    actorId: PublicIdSchema.optional(),
    action: AuditActionSchema.optional(),
    authorizationScopeId: PublicIdSchema.optional(),
  })
  .strict();

export const AuditActorSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    maskedEmail: MaskedEmailSchema.nullable(),
  })
  .strict();

const AuditDisplayValueSchema = z.string().trim().min(1).max(500).nullable();

export const AuditChangeSchema = z
  .object({
    field: AuditChangeFieldSchema,
    before: AuditDisplayValueSchema,
    after: AuditDisplayValueSchema,
  })
  .strict();

export const AuditEventSchema = z
  .object({
    id: PublicIdSchema,
    actor: AuditActorSchema,
    action: AuditActionSchema,
    targetLabel: z.string().trim().min(1).max(160),
    scopeLabel: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(500),
    occurredAt: TimestampSchema,
    changes: z.array(AuditChangeSchema).max(100),
  })
  .strict();

export const AuditEventPageSchema = z
  .object({
    visibility: AuditVisibilitySchema,
    events: z.array(AuditEventSchema).max(100),
    page: z.int().positive(),
    pageSize: z.int().min(1).max(100),
    total: z.int().nonnegative(),
    totalPages: z.int().nonnegative(),
  })
  .strict();

export type AuditQuery = z.infer<typeof AuditQuerySchema>;
export type AuditActor = z.infer<typeof AuditActorSchema>;
export type AuditChange = z.infer<typeof AuditChangeSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AuditEventPage = z.infer<typeof AuditEventPageSchema>;
