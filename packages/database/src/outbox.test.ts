import type { EventEnvelope } from "@pubg-camp/contracts";
import { describe, expect, it } from "vitest";
import { toOutboxRecord } from "./outbox.js";

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
});
