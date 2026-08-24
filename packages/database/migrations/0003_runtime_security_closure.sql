CREATE TYPE "public"."session_trust" AS ENUM('provisional', 'trusted');--> statement-breakpoint
CREATE TABLE "identity_link_proofs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_subject" text NOT NULL,
	"display_name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_link_proofs_expiry_check" CHECK ("identity_link_proofs"."expires_at" > "identity_link_proofs"."created_at"),
	CONSTRAINT "identity_link_proofs_consumption_order_check" CHECK ("identity_link_proofs"."consumed_at" is null or "identity_link_proofs"."consumed_at" >= "identity_link_proofs"."created_at")
);
--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD COLUMN "current_method_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "trust" "session_trust";--> statement-breakpoint
UPDATE "sessions" AS "session"
SET "trust" = CASE
	WHEN EXISTS (
		SELECT 1
		FROM "verified_emails" AS "verified_email"
		WHERE "verified_email"."user_id" = "session"."user_id"
			AND "verified_email"."revoked_at" IS NULL
	) THEN 'trusted'::"session_trust"
	ELSE 'provisional'::"session_trust"
END;--> statement-breakpoint
UPDATE "sessions"
SET
	"absolute_expires_at" = LEAST("absolute_expires_at", "issued_at" + interval '15 minutes'),
	"idle_expires_at" = LEAST("idle_expires_at", "issued_at" + interval '15 minutes')
WHERE "trust" = 'provisional';--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "trust" SET NOT NULL;--> statement-breakpoint
DELETE FROM "auth_challenges" WHERE "purpose" <> 'sign-in';--> statement-breakpoint
DELETE FROM "oauth_transactions" WHERE "purpose" <> 'sign-in';--> statement-breakpoint
ALTER TABLE "identity_link_proofs" ADD CONSTRAINT "identity_link_proofs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link_proofs" ADD CONSTRAINT "identity_link_proofs_user_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_link_proofs_actor_session_active_idx" ON "identity_link_proofs" USING btree ("user_id","session_id","provider") WHERE "identity_link_proofs"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "identity_link_proofs_expiry_idx" ON "identity_link_proofs" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_purpose_binding_check" CHECK (("auth_challenges"."purpose" = 'sign-in' and "auth_challenges"."user_id" is null and "auth_challenges"."session_id" is null) or ("auth_challenges"."purpose" <> 'sign-in' and "auth_challenges"."user_id" is not null and "auth_challenges"."session_id" is not null));--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_purpose_binding_check" CHECK (("oauth_transactions"."purpose" = 'sign-in' and "oauth_transactions"."user_id" is null and "oauth_transactions"."session_id" is null and "oauth_transactions"."current_method_confirmed_at" is null)
        or ("oauth_transactions"."purpose" = 'link-identity' and "oauth_transactions"."user_id" is not null and "oauth_transactions"."session_id" is not null and "oauth_transactions"."current_method_confirmed_at" is not null)
        or ("oauth_transactions"."purpose" = 'step-up' and "oauth_transactions"."user_id" is not null and "oauth_transactions"."session_id" is not null and "oauth_transactions"."current_method_confirmed_at" is null));--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_current_method_order_check" CHECK ("oauth_transactions"."current_method_confirmed_at" is null or "oauth_transactions"."current_method_confirmed_at" <= "oauth_transactions"."created_at");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_provisional_absolute_expiry_check" CHECK ("sessions"."trust" = 'trusted' or "sessions"."absolute_expires_at" <= "sessions"."issued_at" + interval '15 minutes');
