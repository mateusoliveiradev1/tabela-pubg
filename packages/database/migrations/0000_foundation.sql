CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'publishing', 'published', 'failed');

CREATE TABLE "outbox_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "event_version" integer NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "correlation_id" uuid,
  "causation_id" uuid,
  "status" "outbox_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "published_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "outbox_pending_available_idx" ON "outbox_events" USING btree ("status", "available_at");
CREATE INDEX "outbox_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type", "aggregate_id");
