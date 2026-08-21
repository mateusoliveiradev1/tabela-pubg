import { z } from "zod";

const PublicIdSchema = z.uuid();
const TimestampSchema = z.iso.datetime();
const MaskedIdentifierSchema = z.string().trim().min(1).max(160);

export const IdentityProviderSchema = z.enum(["discord", "email"]);
export const IdentityStatusSchema = z.enum(["pending", "verified", "revoked"]);
export const OAuthPurposeSchema = z.enum(["sign-in", "link-identity", "step-up"]);

export const OAuthStartRequestSchema = z
  .object({
    purpose: OAuthPurposeSchema,
    returnPath: z.string().startsWith("/").max(512).optional(),
  })
  .strict();

export const OAuthStartResponseSchema = z
  .object({
    status: z.literal("redirect-required"),
  })
  .strict();

export const OAuthCallbackResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("authenticated"),
      nextPath: z.string().startsWith("/").max(512),
    })
    .strict(),
  z
    .object({
      status: z.literal("link-confirmation-required"),
      nextPath: z.string().startsWith("/").max(512),
    })
    .strict(),
  z
    .object({
      status: z.literal("cancelled"),
    })
    .strict(),
]);

export const EmailOtpPurposeSchema = z.enum(["sign-in", "link-email", "change-email", "step-up"]);

export const EmailOtpRequestSchema = z
  .object({
    email: z.email().trim().max(254),
    purpose: EmailOtpPurposeSchema.default("sign-in"),
  })
  .strict();

export const EmailOtpResponseSchema = z
  .object({
    status: z.literal("accepted"),
    retryAfterSeconds: z.int().min(1).max(3_600),
  })
  .strict();

export const VerifyEmailOtpRequestSchema = z
  .object({
    challengeId: PublicIdSchema,
    code: z.string().regex(/^\d{8}$/),
    purpose: EmailOtpPurposeSchema,
  })
  .strict();

export const VerifyEmailOtpResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authenticated"), nextPath: z.string().startsWith("/") }).strict(),
  z.object({ status: z.literal("identity-link-ready") }).strict(),
  z.object({ status: z.literal("email-change-ready") }).strict(),
  z.object({ status: z.literal("step-up-confirmed"), validUntil: TimestampSchema }).strict(),
]);

export const IdentitySummarySchema = z
  .object({
    id: PublicIdSchema,
    provider: IdentityProviderSchema,
    status: IdentityStatusSchema,
    displayIdentifier: MaskedIdentifierSchema,
    linkedAt: TimestampSchema,
  })
  .strict();

export const IdentityListResponseSchema = z
  .object({
    identities: z.array(IdentitySummarySchema).min(1).max(8),
  })
  .strict();

export const ConfirmIdentityLinkRequestSchema = z
  .object({
    candidateIdentityId: PublicIdSchema,
    confirmation: z.literal(true),
  })
  .strict();

export const ConfirmIdentityLinkResponseSchema = z
  .object({
    status: z.literal("linked"),
    provider: IdentityProviderSchema,
    otherSessionsRevoked: z.int().nonnegative(),
  })
  .strict();

export const RemoveIdentityRequestSchema = z
  .object({
    identityId: PublicIdSchema,
  })
  .strict();

export const RemoveIdentityResponseSchema = z
  .object({
    status: z.literal("removed"),
  })
  .strict();

export const StepUpRequestSchema = z
  .object({
    method: IdentityProviderSchema,
    action: z.enum([
      "membership-role-change",
      "membership-revocation",
      "ownership-transfer",
      "identity-link",
      "email-change",
    ]),
  })
  .strict();

export const StepUpStatusResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("required") }).strict(),
  z.object({ status: z.literal("pending") }).strict(),
  z.object({ status: z.literal("confirmed"), validUntil: TimestampSchema }).strict(),
  z.object({ status: z.literal("expired") }).strict(),
]);

export const DeviceSummarySchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    browser: z.string().trim().min(1).max(80),
    operatingSystem: z.string().trim().min(1).max(80),
  })
  .strict();

export const SessionStatusSchema = z.enum(["active", "revoked", "expired"]);

export const SessionSummarySchema = z
  .object({
    id: PublicIdSchema,
    device: DeviceSummarySchema,
    approximateLocation: z.string().trim().min(1).max(120).nullable(),
    createdAt: TimestampSchema,
    lastSeenAt: TimestampSchema,
    idleExpiresAt: TimestampSchema,
    absoluteExpiresAt: TimestampSchema,
    isCurrent: z.boolean(),
    status: SessionStatusSchema,
  })
  .strict();

export const SessionListResponseSchema = z
  .object({
    sessions: z.array(SessionSummarySchema).min(1).max(100),
  })
  .strict();

export const RevokeSessionRequestSchema = z
  .object({
    sessionId: PublicIdSchema,
  })
  .strict();

export const RevokeSessionResponseSchema = z
  .object({
    status: z.literal("revoked"),
    revokedSessionId: PublicIdSchema,
  })
  .strict();

export const RevokeOtherSessionsResponseSchema = z
  .object({
    status: z.literal("revoked"),
    revokedCount: z.int().nonnegative(),
  })
  .strict();

export const SessionAlertContextRequestSchema = z
  .object({
    context: z.string().min(16).max(1_024),
  })
  .strict();

export const SessionAlertContextResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("active") }).strict(),
  z.object({ status: z.literal("revoked") }).strict(),
  z.object({ status: z.literal("expired") }).strict(),
  z.object({ status: z.literal("not-found") }).strict(),
]);

export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;
export type OAuthStartRequest = z.infer<typeof OAuthStartRequestSchema>;
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;
export type OAuthCallbackResponse = z.infer<typeof OAuthCallbackResponseSchema>;
export type EmailOtpRequest = z.infer<typeof EmailOtpRequestSchema>;
export type EmailOtpResponse = z.infer<typeof EmailOtpResponseSchema>;
export type VerifyEmailOtpRequest = z.infer<typeof VerifyEmailOtpRequestSchema>;
export type VerifyEmailOtpResponse = z.infer<typeof VerifyEmailOtpResponseSchema>;
export type IdentitySummary = z.infer<typeof IdentitySummarySchema>;
export type IdentityListResponse = z.infer<typeof IdentityListResponseSchema>;
export type ConfirmIdentityLinkRequest = z.infer<typeof ConfirmIdentityLinkRequestSchema>;
export type ConfirmIdentityLinkResponse = z.infer<typeof ConfirmIdentityLinkResponseSchema>;
export type StepUpRequest = z.infer<typeof StepUpRequestSchema>;
export type StepUpStatusResponse = z.infer<typeof StepUpStatusResponseSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;
export type SessionAlertContextRequest = z.infer<typeof SessionAlertContextRequestSchema>;
export type SessionAlertContextResponse = z.infer<typeof SessionAlertContextResponseSchema>;
