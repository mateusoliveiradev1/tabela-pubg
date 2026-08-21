CREATE TYPE "public"."organization_logo_mime" AS ENUM('image/png', 'image/jpeg', 'image/webp');--> statement-breakpoint
CREATE TYPE "public"."organization_logo_status" AS ENUM('pending', 'active', 'delete_pending');--> statement-breakpoint
CREATE TYPE "public"."storage_cleanup_provider" AS ENUM('s3');--> statement-breakpoint
CREATE TYPE "public"."storage_cleanup_status" AS ENUM('pending', 'claimed', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "organization_logo_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"detected_mime" "organization_logo_mime" NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"status" "organization_logo_status" DEFAULT 'pending' NOT NULL,
	"activated_at" timestamp with time zone,
	"delete_pending_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_logo_assets_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "organization_logo_assets_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "organization_logo_assets_object_key_tenant_check" CHECK ("organization_logo_assets"."object_key" ~ ('^branding/' || "organization_logo_assets"."organization_id"::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
	CONSTRAINT "organization_logo_assets_byte_size_check" CHECK ("organization_logo_assets"."byte_size" between 1 and 2097152),
	CONSTRAINT "organization_logo_assets_sha256_check" CHECK ("organization_logo_assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "organization_logo_assets_lifecycle_check" CHECK (("organization_logo_assets"."status" = 'pending' and "organization_logo_assets"."activated_at" is null and "organization_logo_assets"."delete_pending_at" is null)
        or ("organization_logo_assets"."status" = 'active' and "organization_logo_assets"."activated_at" is not null and "organization_logo_assets"."delete_pending_at" is null)
        or ("organization_logo_assets"."status" = 'delete_pending' and "organization_logo_assets"."delete_pending_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "orphan_storage_cleanup_ledger" (
	"cleanup_id" uuid PRIMARY KEY NOT NULL,
	"provider" "storage_cleanup_provider" NOT NULL,
	"object_key" text NOT NULL,
	"object_key_digest" text NOT NULL,
	"status" "storage_cleanup_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orphan_storage_cleanup_provider_digest_unique" UNIQUE("provider","object_key_digest"),
	CONSTRAINT "orphan_storage_cleanup_object_key_check" CHECK ("orphan_storage_cleanup_ledger"."object_key" ~ '^branding/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "orphan_storage_cleanup_digest_check" CHECK ("orphan_storage_cleanup_ledger"."object_key_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "orphan_storage_cleanup_attempts_check" CHECK ("orphan_storage_cleanup_ledger"."attempts" >= 0),
	CONSTRAINT "orphan_storage_cleanup_lifecycle_check" CHECK (("orphan_storage_cleanup_ledger"."status" = 'pending' and "orphan_storage_cleanup_ledger"."claimed_at" is null and "orphan_storage_cleanup_ledger"."completed_at" is null)
        or ("orphan_storage_cleanup_ledger"."status" = 'claimed' and "orphan_storage_cleanup_ledger"."claimed_at" is not null and "orphan_storage_cleanup_ledger"."completed_at" is null)
        or ("orphan_storage_cleanup_ledger"."status" = 'completed' and "orphan_storage_cleanup_ledger"."claimed_at" is not null and "orphan_storage_cleanup_ledger"."completed_at" is not null)
        or ("orphan_storage_cleanup_ledger"."status" = 'failed' and "orphan_storage_cleanup_ledger"."completed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "organization_logo_assets" ADD CONSTRAINT "organization_logo_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_logo_assets" ADD CONSTRAINT "organization_logo_assets_organization_creator_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_logo_assets_one_active_per_organization_unique" ON "organization_logo_assets" USING btree ("organization_id") WHERE "organization_logo_assets"."status" = 'active';--> statement-breakpoint
CREATE INDEX "organization_logo_assets_organization_status_idx" ON "organization_logo_assets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "orphan_storage_cleanup_claim_idx" ON "orphan_storage_cleanup_ledger" USING btree ("status","next_attempt_at","claimed_at");