import { describe, expect, it } from "vitest";
import { createHealthResponse, EventEnvelopeSchema } from "./index.js";

describe("shared contracts", () => {
  it("creates a valid health response", () => {
    const response = createHealthResponse("api", "ok", { postgres: "ok" });

    expect(response.service).toBe("api");
    expect(response.checks?.postgres).toBe("ok");
    expect(() => new Date(response.timestamp)).not.toThrow();
  });

  it("rejects event envelopes without a valid identifier", () => {
    const result = EventEnvelopeSchema.safeParse({
      id: "not-a-uuid",
      type: "match.imported",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregate: { type: "match", id: "match-1" },
      payload: {},
    });

    expect(result.success).toBe(false);
  });
});
