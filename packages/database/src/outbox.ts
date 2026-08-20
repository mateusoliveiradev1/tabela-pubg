import type { EventEnvelope } from "@pubg-camp/contracts";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type NewOutboxEventRow, outboxEvents } from "./schema.js";

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

export type SchemaColumn = AnyPgColumn;
