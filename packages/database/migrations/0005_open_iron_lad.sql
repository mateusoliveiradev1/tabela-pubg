CREATE TYPE "public"."identity_link_proof_purpose" AS ENUM('link-identity', 'link-email', 'change-email');--> statement-breakpoint
ALTER TABLE "identity_link_proofs" ADD COLUMN "purpose" "identity_link_proof_purpose";--> statement-breakpoint
UPDATE "identity_link_proofs"
SET "purpose" = CASE
  WHEN "provider" = 'discord' THEN 'link-identity'::"identity_link_proof_purpose"
  ELSE 'link-email'::"identity_link_proof_purpose"
END;--> statement-breakpoint
UPDATE "identity_link_proofs"
SET "consumed_at" = greatest("created_at", current_timestamp)
WHERE "provider" = 'email' AND "consumed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "identity_link_proofs" ALTER COLUMN "purpose" SET NOT NULL;
