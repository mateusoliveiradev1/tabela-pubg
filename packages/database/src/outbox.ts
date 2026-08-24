import type { EventEnvelope } from "@pubg-camp/contracts";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type NewOutboxEventRow, type OutboxEventRow, outboxEvents } from "./schema.js";

export interface InsertExecutor {
  insert(table: typeof outboxEvents): {
    values(value: NewOutboxEventRow): PromiseLike<unknown>;
  };
}

export function toOutboxRecord(event: EventEnvelope, availableAt = new Date()): NewOutboxEventRow {
  return {
    id: event.id,
    eventType: event.type,
    eventVersion: event.version,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id,
    payload: event.payload,
    correlationId: event.correlationId,
    causationId: event.causationId,
    status: "pending",
    attempts: 0,
    availableAt,
    occurredAt: new Date(event.occurredAt),
  };
}

export async function appendOutboxEvent(
  executor: InsertExecutor,
  event: EventEnvelope,
): Promise<void> {
  await executor.insert(outboxEvents).values(toOutboxRecord(event));
}

export interface OutboxExecutor {
  execute(query: SQL): PromiseLike<unknown>;
}

export interface ClaimOutboxBatchInput {
  now: Date;
  claimToken: string;
  leaseMs: number;
  batchSize: number;
  maxAttempts: number;
}

export interface MarkOutboxPublishedInput {
  eventId: string;
  claimToken: string;
  publishedAt: Date;
}

export interface RetryOutboxEventInput {
  eventId: string;
  claimToken: string;
  now: Date;
  errorCode: string;
  baseRetryMs: number;
  maxRetryMs: number;
  maxAttempts: number;
}

function assertNonEmptyBounded(value: string, name: string, maximumLength: number): void {
  if (!value.trim() || value.length > maximumLength) {
    throw new Error(`${name} must contain between 1 and ${maximumLength} characters`);
  }
}

function assertIntegerInRange(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function toRows(result: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(result)) {
    throw new Error("outbox executor returned an invalid row collection");
  }
  return result as readonly Record<string, unknown>[];
}

function returnedOutboxColumns() {
  return sql`
    "event"."id",
    "event"."event_type" as "eventType",
    "event"."event_version" as "eventVersion",
    "event"."aggregate_type" as "aggregateType",
    "event"."aggregate_id" as "aggregateId",
    "event"."payload",
    "event"."correlation_id" as "correlationId",
    "event"."causation_id" as "causationId",
    "event"."status",
    "event"."attempts",
    "event"."available_at" as "availableAt",
    "event"."occurred_at" as "occurredAt",
    "event"."published_at" as "publishedAt",
    "event"."claim_token" as "claimToken",
    "event"."lease_expires_at" as "leaseExpiresAt",
    "event"."last_error" as "lastError",
    "event"."created_at" as "createdAt"`;
}

export async function claimOutboxBatch(
  executor: OutboxExecutor,
  input: ClaimOutboxBatchInput,
): Promise<readonly OutboxEventRow[]> {
  assertNonEmptyBounded(input.claimToken, "outbox claim token", 128);
  assertIntegerInRange(input.leaseMs, "outbox lease", 1, 5 * 60_000);
  assertIntegerInRange(input.batchSize, "outbox batch size", 1, 100);
  assertIntegerInRange(input.maxAttempts, "outbox maximum attempts", 1, 100);
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);

  const result = await executor.execute(sql`
    /* outbox:claim */
    with "eligible" as (
      select "candidate"."id"
      from "outbox_events" as "candidate"
      where "candidate"."attempts" < ${input.maxAttempts}
        and (
          (
            "candidate"."status" in ('pending', 'failed')
            and "candidate"."available_at" <= ${input.now}
          )
          or (
            "candidate"."status" = 'publishing'
            and "candidate"."lease_expires_at" <= ${input.now}
          )
        )
      order by "candidate"."available_at", "candidate"."occurred_at", "candidate"."id"
      for update skip locked
      limit ${input.batchSize}
    )
    update "outbox_events" as "event"
    set
      "status" = 'publishing',
      "attempts" = "event"."attempts" + 1,
      "claim_token" = ${input.claimToken},
      "lease_expires_at" = ${leaseExpiresAt},
      "last_error" = null
    from "eligible"
    where "event"."id" = "eligible"."id"
    returning ${returnedOutboxColumns()}
  `);

  return toRows(result) as unknown as readonly OutboxEventRow[];
}

export async function markOutboxPublished(
  executor: OutboxExecutor,
  input: MarkOutboxPublishedInput,
): Promise<boolean> {
  assertNonEmptyBounded(input.eventId, "outbox event id", 128);
  assertNonEmptyBounded(input.claimToken, "outbox claim token", 128);

  const result = await executor.execute(sql`
    /* outbox:publish */
    update "outbox_events" as "event"
    set
      "status" = 'published',
      "published_at" = ${input.publishedAt},
      "claim_token" = null,
      "lease_expires_at" = null,
      "last_error" = null
    where "event"."id" = ${input.eventId}
      and "event"."status" = 'publishing'
      and "event"."claim_token" = ${input.claimToken}
      and "event"."lease_expires_at" > ${input.publishedAt}
    returning "event"."id"
  `);

  return toRows(result).length === 1;
}

function redactErrorCode(errorCode: string): string {
  const normalized = errorCode.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized) ? normalized : "publish_failed";
}

export async function retryOutboxEvent(
  executor: OutboxExecutor,
  input: RetryOutboxEventInput,
): Promise<boolean> {
  assertNonEmptyBounded(input.eventId, "outbox event id", 128);
  assertNonEmptyBounded(input.claimToken, "outbox claim token", 128);
  assertIntegerInRange(input.baseRetryMs, "outbox base retry", 1, 60_000);
  assertIntegerInRange(input.maxRetryMs, "outbox maximum retry", input.baseRetryMs, 3_600_000);
  assertIntegerInRange(input.maxAttempts, "outbox maximum attempts", 1, 100);
  const lastError = redactErrorCode(input.errorCode);

  const result = await executor.execute(sql`
    /* outbox:retry */
    update "outbox_events" as "event"
    set
      "status" = 'failed',
      "available_at" = ${input.now} + (
        least(
          ${input.maxRetryMs}::numeric,
          ${input.baseRetryMs}::numeric * power(2::numeric, greatest("event"."attempts" - 1, 0))
        ) * interval '1 millisecond'
      ),
      "claim_token" = null,
      "lease_expires_at" = null,
      "last_error" = ${lastError}
    where "event"."id" = ${input.eventId}
      and "event"."status" = 'publishing'
      and "event"."claim_token" = ${input.claimToken}
      and "event"."lease_expires_at" > ${input.now}
      and "event"."attempts" <= ${input.maxAttempts}
    returning "event"."id"
  `);

  return toRows(result).length === 1;
}

export type SchemaColumn = AnyPgColumn;
