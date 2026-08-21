CREATE TYPE "public"."authorization_scope_kind" AS ENUM('tournament');--> statement-breakpoint
CREATE TYPE "public"."operational_role" AS ENUM('referee', 'registrations', 'broadcast', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."role_assignment_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."auth_challenge_purpose" AS ENUM('sign-in', 'link-email', 'change-email', 'step-up');--> statement-breakpoint
CREATE TYPE "public"."identity_provider" AS ENUM('discord', 'email');--> statement-breakpoint
CREATE TYPE "public"."identity_status" AS ENUM('pending', 'verified', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."oauth_purpose" AS ENUM('sign-in', 'link-identity', 'step-up');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('pending', 'sending', 'delivered', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invitation_organization_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"authorization_scope_id" uuid,
	"actor_membership_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_reason_check" CHECK (char_length(btrim("audit_events"."reason")) >= 1)
);
--> statement-breakpoint
CREATE TABLE "authorization_scopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "authorization_scope_kind" DEFAULT 'tournament' NOT NULL,
	"label" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authorization_scopes_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "authorization_scopes_label_check" CHECK (char_length(btrim("authorization_scopes"."label")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"authorization_scope_id" uuid NOT NULL,
	"role" "operational_role" NOT NULL,
	"status" "role_assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_by_membership_id" uuid NOT NULL,
	"assignment_reason" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	CONSTRAINT "role_assignments_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "role_assignments_reason_check" CHECK (char_length(btrim("role_assignments"."assignment_reason")) >= 8),
	CONSTRAINT "role_assignments_revocation_pair_check" CHECK (("role_assignments"."status" = 'active' and "role_assignments"."revoked_at" is null and "role_assignments"."revocation_reason" is null) or ("role_assignments"."status" = 'revoked' and "role_assignments"."revoked_at" is not null and "role_assignments"."revocation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"email_digest" text NOT NULL,
	"purpose" "auth_challenge_purpose" NOT NULL,
	"code_digest" text NOT NULL,
	"attempts_remaining" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_challenges_attempts_check" CHECK ("auth_challenges"."attempts_remaining" >= 0 and "auth_challenges"."attempts_remaining" <= 5),
	CONSTRAINT "auth_challenges_expiry_check" CHECK ("auth_challenges"."expires_at" > "auth_challenges"."created_at"),
	CONSTRAINT "auth_challenges_terminal_state_check" CHECK (num_nonnulls("auth_challenges"."superseded_at", "auth_challenges"."consumed_at") <= 1)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_digest" text NOT NULL,
	"label" text NOT NULL,
	"browser" text NOT NULL,
	"operating_system" text NOT NULL,
	"approximate_location" text,
	"summarized_user_agent" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "devices_user_digest_unique" UNIQUE("user_id","device_digest"),
	CONSTRAINT "devices_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "devices_seen_order_check" CHECK ("devices"."last_seen_at" >= "devices"."first_seen_at")
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_subject" text NOT NULL,
	"status" "identity_status" DEFAULT 'verified' NOT NULL,
	"display_name" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "identities_provider_subject_unique" UNIQUE("provider","provider_subject"),
	CONSTRAINT "identities_user_id_id_unique" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "oauth_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"purpose" "oauth_purpose" NOT NULL,
	"state_digest" text NOT NULL,
	"browser_binding_digest" text NOT NULL,
	"return_path" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_transactions_state_digest_unique" UNIQUE("state_digest"),
	CONSTRAINT "oauth_transactions_expiry_check" CHECK ("oauth_transactions"."expires_at" > "oauth_transactions"."created_at"),
	CONSTRAINT "oauth_transactions_session_user_check" CHECK ("oauth_transactions"."session_id" is null or "oauth_transactions"."user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "session_alert_contexts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"token_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_alert_contexts_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "session_alert_contexts_expiry_check" CHECK ("session_alert_contexts"."expires_at" > "session_alert_contexts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"token_digest" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"reauthenticated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "sessions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "sessions_lifecycle_order_check" CHECK ("sessions"."last_seen_at" >= "sessions"."issued_at" and "sessions"."idle_expires_at" <= "sessions"."absolute_expires_at"),
	CONSTRAINT "sessions_revocation_pair_check" CHECK (("sessions"."revoked_at" is null and "sessions"."revocation_reason" is null) or ("sessions"."revoked_at" is not null and "sessions"."revocation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"normalized_email" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verified_emails_normalized_email_unique" UNIQUE("normalized_email"),
	CONSTRAINT "verified_emails_identity_unique" UNIQUE("identity_id")
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"recipient_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"encryption_key_version" text,
	"payload_iv" text,
	"payload_ciphertext" text,
	"payload_auth_tag" text,
	"payload_expires_at" timestamp with time zone NOT NULL,
	"payload_cleared_at" timestamp with time zone,
	"status" "notification_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "notification_deliveries_attempts_check" CHECK ("notification_deliveries"."attempts" >= 0),
	CONSTRAINT "notification_deliveries_envelope_state_check" CHECK (("notification_deliveries"."payload_cleared_at" is null and num_nonnulls("notification_deliveries"."encryption_key_version", "notification_deliveries"."payload_iv", "notification_deliveries"."payload_ciphertext", "notification_deliveries"."payload_auth_tag") = 4) or ("notification_deliveries"."payload_cleared_at" is not null and num_nonnulls("notification_deliveries"."encryption_key_version", "notification_deliveries"."payload_iv", "notification_deliveries"."payload_ciphertext", "notification_deliveries"."payload_auth_tag") = 0))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"invited_by_membership_id" uuid NOT NULL,
	"accepted_by_membership_id" uuid,
	"normalized_email" text NOT NULL,
	"token_digest" text NOT NULL,
	"organization_role" "invitation_organization_role" NOT NULL,
	"role_payload" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"superseded_at" timestamp with time zone,
	"superseded_by_invitation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "invitations_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invitations_seven_day_expiry_check" CHECK ("invitations"."expires_at" = "invitations"."issued_at" + interval '7 days'),
	CONSTRAINT "invitations_role_payload_check" CHECK (jsonb_typeof("invitations"."role_payload") = 'array'),
	CONSTRAINT "invitations_terminal_state_check" CHECK (num_nonnulls("invitations"."accepted_at", "invitations"."revoked_at", "invitations"."superseded_at") <= 1),
	CONSTRAINT "invitations_acceptance_pair_check" CHECK (("invitations"."accepted_at" is null and "invitations"."accepted_by_membership_id" is null) or ("invitations"."accepted_at" is not null and "invitations"."accepted_by_membership_id" is not null)),
	CONSTRAINT "invitations_revocation_pair_check" CHECK (("invitations"."revoked_at" is null and "invitations"."revocation_reason" is null) or ("invitations"."revoked_at" is not null and "invitations"."revocation_reason" is not null)),
	CONSTRAINT "invitations_supersession_pair_check" CHECK (("invitations"."superseded_at" is null and "invitations"."superseded_by_invitation_id" is null) or ("invitations"."superseded_at" is not null and "invitations"."superseded_by_invitation_id" is not null)),
	CONSTRAINT "invitations_no_self_supersession_check" CHECK ("invitations"."superseded_by_invitation_id" is null or "invitations"."superseded_by_invitation_id" <> "invitations"."id")
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "organization_role" DEFAULT 'member' NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_organization_user_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "organization_memberships_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "organization_memberships_revocation_pair_check" CHECK (("organization_memberships"."status" = 'active' and "organization_memberships"."revoked_at" is null and "organization_memberships"."revocation_reason" is null) or ("organization_memberships"."status" = 'revoked' and "organization_memberships"."revoked_at" is not null and "organization_memberships"."revocation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_slug_check" CHECK ("organizations"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "organizations_name_check" CHECK (char_length(btrim("organizations"."name")) between 2 and 120)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_actor_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_scope_fk" FOREIGN KEY ("organization_id","authorization_scope_id") REFERENCES "public"."authorization_scopes"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_scopes" ADD CONSTRAINT "authorization_scopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_scope_fk" FOREIGN KEY ("organization_id","authorization_scope_id") REFERENCES "public"."authorization_scopes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_assigner_fk" FOREIGN KEY ("organization_id","assigned_by_membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_user_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_alert_contexts" ADD CONSTRAINT "session_alert_contexts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_alert_contexts" ADD CONSTRAINT "session_alert_contexts_user_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_device_fk" FOREIGN KEY ("user_id","device_id") REFERENCES "public"."devices"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_emails" ADD CONSTRAINT "verified_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_emails" ADD CONSTRAINT "verified_emails_user_identity_fk" FOREIGN KEY ("user_id","identity_id") REFERENCES "public"."identities"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_inviter_fk" FOREIGN KEY ("organization_id","invited_by_membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_accepted_membership_fk" FOREIGN KEY ("organization_id","accepted_by_membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_superseding_invitation_fk" FOREIGN KEY ("organization_id","superseded_by_invitation_id") REFERENCES "public"."invitations"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_organization_occurred_idx" ON "audit_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_organization_actor_idx" ON "audit_events" USING btree ("organization_id","actor_membership_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_organization_scope_idx" ON "audit_events" USING btree ("organization_id","authorization_scope_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_correlation_idx" ON "audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "authorization_scopes_organization_kind_idx" ON "authorization_scopes" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_active_role_unique" ON "role_assignments" USING btree ("organization_id","membership_id","authorization_scope_id","role") WHERE "role_assignments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "role_assignments_organization_membership_idx" ON "role_assignments" USING btree ("organization_id","membership_id","status");--> statement-breakpoint
CREATE INDEX "role_assignments_organization_scope_idx" ON "role_assignments" USING btree ("organization_id","authorization_scope_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_active_subject_purpose_unique" ON "auth_challenges" USING btree ("email_digest","purpose") WHERE "auth_challenges"."superseded_at" is null and "auth_challenges"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "auth_challenges_digest_expiry_idx" ON "auth_challenges" USING btree ("email_digest","expires_at");--> statement-breakpoint
CREATE INDEX "auth_challenges_expiry_idx" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "devices_user_last_seen_idx" ON "devices" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "identities_user_status_idx" ON "identities" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "oauth_transactions_binding_expiry_idx" ON "oauth_transactions" USING btree ("browser_binding_digest","expires_at");--> statement-breakpoint
CREATE INDEX "oauth_transactions_expiry_idx" ON "oauth_transactions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "session_alert_contexts_expiry_idx" ON "session_alert_contexts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "session_alert_contexts_session_idx" ON "session_alert_contexts" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","last_seen_at") WHERE "sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "sessions_idle_expiry_idx" ON "sessions" USING btree ("idle_expires_at");--> statement-breakpoint
CREATE INDEX "sessions_absolute_expiry_idx" ON "sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "verified_emails_active_user_unique" ON "verified_emails" USING btree ("user_id") WHERE "verified_emails"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_available_idx" ON "notification_deliveries" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_payload_expiry_idx" ON "notification_deliveries" USING btree ("payload_expires_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_recipient_idx" ON "notification_deliveries" USING btree ("recipient_digest","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_active_organization_email_unique" ON "invitations" USING btree ("organization_id","normalized_email") WHERE "invitations"."accepted_at" is null and "invitations"."revoked_at" is null and "invitations"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "invitations_organization_status_idx" ON "invitations" USING btree ("organization_id","expires_at","accepted_at","revoked_at","superseded_at");--> statement-breakpoint
CREATE INDEX "invitations_email_expiry_idx" ON "invitations" USING btree ("normalized_email","expires_at");--> statement-breakpoint
CREATE INDEX "organization_memberships_organization_status_idx" ON "organization_memberships" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "organization_memberships_organization_role_idx" ON "organization_memberships" USING btree ("organization_id","role","status");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."prevent_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_event_mutation"();
