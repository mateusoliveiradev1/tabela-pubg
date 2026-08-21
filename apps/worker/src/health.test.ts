import { describe, expect, it } from "vitest";
import { live, ready } from "./health.js";

describe("worker health", () => {
  it("has dependency-free liveness", () => expect(live().state).toBe("ok"));
  it("reports PostgreSQL and Redis independently", async () => {
    await expect(
      ready({
        postgres: async () => undefined,
        redis: async () => Promise.reject(new Error("offline")),
      }),
    ).resolves.toMatchObject({
      state: "unavailable",
      checks: { postgres: "ok", redis: "unavailable" },
    });
  });
});
