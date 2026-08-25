import type { EventEnvelope } from "@pubg-camp/contracts";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  claimOutboxBatch,
  markOutboxPublished,
  retryOutboxEvent,
  toOutboxRecord,
} from "./outbox.js";

class RecordingExecutor {
  readonly queries: { sql: string; params: unknown[] }[] = [];
  private readonly dialect = new PgDialect();

  constructor(private readonly results: unknown[][]) {}

  async execute(query: SQLWrapper): Promise<unknown[]> {
    this.queries.push(this.dialect.sqlToQuery(query.getSQL()));
    return this.results.shift() ?? [];
  }
}

describe("transactional outbox", () => {
  it("maps an event envelope to a pending outbox row", () => {
    const event: EventEnvelope = {
      id: "2cd2130b-7cae-4cce-8869-b6e9b45d14f5",
      type: "match.imported",
      version: 1,
      occurredAt: "2026-08-20T20:00:00.000Z",
      aggregate: { type: "match", id: "match-42" },
      payload: { tournamentId: "t-1" },
    };
    const availableAt = new Date("2026-08-20T20:00:01.000Z");

    expect(toOutboxRecord(event, availableAt)).toMatchObject({
      id: event.id,
      eventType: "match.imported",
      aggregateId: "match-42",
      attempts: 0,
      status: "pending",
      availableAt,
    });
  });

  it("claims eligible events with a lease and skip-locked ownership", async () => {
    const now = new Date("2026-08-24T08:00:00.000Z");
    const executor = new RecordingExecutor([
      [
        {
          id: "2cd2130b-7cae-4cce-8869-b6e9b45d14f5",
          status: "publishing",
          attempts: 1,
          claimToken: "claim-1",
          leaseExpiresAt: new Date("2026-08-24T08:01:00.000Z"),
        },
      ],
    ]);

    const claimed = await claimOutboxBatch(executor, {
      now,
      claimToken: "claim-1",
      leaseMs: 60_000,
      batchSize: 10,
      maxAttempts: 5,
      eventTypes: ["notification.delivery.requested", "storage.logo.cleanup"],
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ status: "publishing", attempts: 1 });
    expect(executor.queries[0]?.sql.toLowerCase()).toContain("for update skip locked");
    expect(executor.queries[0]?.sql).toContain("lease_expires_at");
    expect(executor.queries[0]?.params).toEqual(
      expect.arrayContaining([
        now.toISOString(),
        "claim-1",
        new Date("2026-08-24T08:01:00.000Z").toISOString(),
        "notification.delivery.requested",
        "storage.logo.cleanup",
        10,
        5,
      ]),
    );
  });

  it("requires the current claim token to publish and makes published terminal", async () => {
    const publishedAt = new Date("2026-08-24T08:00:30.000Z");
    const staleExecutor = new RecordingExecutor([[]]);
    const currentExecutor = new RecordingExecutor([[{ id: "event-1" }]]);

    await expect(
      markOutboxPublished(staleExecutor, {
        eventId: "event-1",
        claimToken: "stale-claim",
        publishedAt,
      }),
    ).resolves.toBe(false);
    await expect(
      markOutboxPublished(currentExecutor, {
        eventId: "event-1",
        claimToken: "current-claim",
        publishedAt,
      }),
    ).resolves.toBe(true);

    const query = currentExecutor.queries[0];
    expect(query?.sql).toContain("claim_token");
    expect(query?.sql).toContain("published_at");
    expect(query?.params).toEqual(
      expect.arrayContaining(["event-1", "current-claim", publishedAt.toISOString()]),
    );
  });

  it("retries only the current lease with a bounded redacted failure code", async () => {
    const now = new Date("2026-08-24T08:00:30.000Z");
    const executor = new RecordingExecutor([[{ id: "event-1" }]]);

    await expect(
      retryOutboxEvent(executor, {
        eventId: "event-1",
        claimToken: "current-claim",
        now,
        errorCode: "provider rejected recipient test@example.com token=secret",
        baseRetryMs: 1_000,
        maxRetryMs: 60_000,
        maxAttempts: 5,
      }),
    ).resolves.toBe(true);

    const query = executor.queries[0];
    expect(query?.sql).toContain("claim_token");
    expect(query?.sql).toContain("available_at");
    expect(query?.params).toContain("publish_failed");
    expect(query?.params.join(" ")).not.toContain("test@example.com");
    expect(query?.params.join(" ")).not.toContain("secret");
  });
});
