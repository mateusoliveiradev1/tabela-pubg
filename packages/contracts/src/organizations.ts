import { z } from "zod";

const PublicIdSchema = z.uuid();
const TimestampSchema = z.iso.datetime();
const MaskedEmailSchema = z.string().regex(/^[^@\s]*[•*][^@\s]*@[^@\s]+\.[^@\s]+$/);

export const OrganizationRoleSchema = z.enum(["owner", "admin", "member"]);
export const AssignableOrganizationRoleSchema = z.enum(["admin", "member"]);
export const OperationalRoleSchema = z.enum(["referee", "registrations", "broadcast", "analyst"]);
export const MembershipStatusSchema = z.enum(["active", "revoked"]);

export const OperationalAssignmentInputSchema = z
  .object({
    authorizationScopeId: PublicIdSchema,
    role: OperationalRoleSchema,
  })
  .strict();

export const OperationalAssignmentSummarySchema = OperationalAssignmentInputSchema.extend({
  scopeName: z.string().trim().min(1).max(160),
}).strict();

export const OrganizationSummarySchema = z
  .object({
    id: PublicIdSchema,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    name: z.string().trim().min(2).max(120),
    logoUrl: z.url().nullable(),
    membershipRole: OrganizationRoleSchema,
  })
  .strict();

export const CreateOrganizationRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    logoAssetId: PublicIdSchema.optional(),
  })
  .strict();

export const CreateOrganizationResponseSchema = z
  .object({
    organization: OrganizationSummarySchema,
  })
  .strict();

export const OrganizationListResponseSchema = z
  .object({
    organizations: z.array(OrganizationSummarySchema).max(100),
  })
  .strict();

export const UpdateOrganizationRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    logoAssetId: PublicIdSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const MembershipUserSummarySchema = z
  .object({
    id: PublicIdSchema,
    displayName: z.string().trim().min(1).max(120),
    maskedEmail: MaskedEmailSchema.nullable(),
  })
  .strict();

export const MembershipSummarySchema = z
  .object({
    id: PublicIdSchema,
    user: MembershipUserSummarySchema,
    organizationRole: OrganizationRoleSchema,
    status: MembershipStatusSchema,
    assignments: z.array(OperationalAssignmentSummarySchema).max(200),
    joinedAt: TimestampSchema,
  })
  .strict();

export const MembershipListResponseSchema = z
  .object({
    members: z.array(MembershipSummarySchema).max(500),
  })
  .strict();

export const CreateInvitationRequestSchema = z
  .object({
    email: z.email().trim().max(254),
    organizationRole: AssignableOrganizationRoleSchema,
    assignments: z.array(OperationalAssignmentInputSchema).max(100).default([]),
  })
  .strict();

export const CreateInvitationResponseSchema = z
  .object({
    status: z.literal("accepted"),
    expiresAt: TimestampSchema,
  })
  .strict();

export const InvitationContextRequestSchema = z
  .object({
    context: z.string().min(16).max(1_024),
  })
  .strict();

const InvitationOrganizationSchema = z
  .object({
    id: PublicIdSchema,
    name: z.string().trim().min(2).max(120),
    logoUrl: z.url().nullable(),
  })
  .strict();

export const InvitationPreviewResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("valid"),
      organization: InvitationOrganizationSchema,
      invitedBy: z.string().trim().min(1).max(120),
      maskedEmail: MaskedEmailSchema,
      organizationRole: AssignableOrganizationRoleSchema,
      assignments: z.array(OperationalAssignmentSummarySchema).max(100),
      expiresAt: TimestampSchema,
      emailMatches: z.boolean(),
    })
    .strict(),
  z.object({ status: z.literal("expired") }).strict(),
  z.object({ status: z.literal("revoked") }).strict(),
  z
    .object({
      status: z.literal("used"),
      organizationSlug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(80),
    })
    .strict(),
  z.object({ status: z.literal("invalid") }).strict(),
]);

export const AcceptInvitationRequestSchema = z
  .object({
    confirmation: z.literal(true),
  })
  .strict();

export const AcceptInvitationResponseSchema = z
  .object({
    status: z.literal("accepted"),
    organization: OrganizationSummarySchema,
    membership: MembershipSummarySchema,
  })
  .strict();

export const InvitationActionRequestSchema = z
  .object({
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const InvitationActionResponseSchema = z
  .object({
    status: z.enum(["revoked", "reissued"]),
    expiresAt: TimestampSchema.optional(),
  })
  .strict();

export const InvitationListItemSchema = z
  .object({
    id: PublicIdSchema,
    maskedEmail: MaskedEmailSchema,
    organizationRole: AssignableOrganizationRoleSchema,
    assignments: z.array(OperationalAssignmentSummarySchema).max(100),
    invitedBy: z.string().trim().min(1).max(120),
    status: z.enum(["active", "accepted", "expired", "revoked"]),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict();

export const InvitationListResponseSchema = z
  .object({
    invitations: z.array(InvitationListItemSchema).max(500),
  })
  .strict();

export const UpdateMembershipRequestSchema = z
  .object({
    organizationRole: AssignableOrganizationRoleSchema,
    assignments: z.array(OperationalAssignmentInputSchema).max(100),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const RevokeMembershipRequestSchema = z
  .object({
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const MembershipMutationResponseSchema = z
  .object({
    status: z.enum(["updated", "revoked"]),
    membership: MembershipSummarySchema,
  })
  .strict();

export const TransferOwnershipRequestSchema = z
  .object({
    targetMembershipId: PublicIdSchema,
    organizationNameConfirmation: z.string().trim().min(2).max(120),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const TransferOwnershipResponseSchema = z
  .object({
    status: z.literal("transferred"),
    currentMembership: MembershipSummarySchema,
    newOwnerMembership: MembershipSummarySchema,
    otherSessionsRevoked: z.int().nonnegative(),
  })
  .strict();

export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;
export type OperationalRole = z.infer<typeof OperationalRoleSchema>;
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequestSchema>;
export type CreateOrganizationResponse = z.infer<typeof CreateOrganizationResponseSchema>;
export type MembershipSummary = z.infer<typeof MembershipSummarySchema>;
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponseSchema>;
export type UpdateMembershipRequest = z.infer<typeof UpdateMembershipRequestSchema>;
export type TransferOwnershipRequest = z.infer<typeof TransferOwnershipRequestSchema>;
