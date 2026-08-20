import { describe, expect, it } from "vitest";
import { live, ready } from "./health.js";

describe("worker health", () => {
  it("has dependency-free liveness", () => expect(live().state).toBe("ok"));
  it("marks failed Redis readiness", async () => {
    await expect(ready(async () => Promise.reject(new Error("offline")))).resolves.toMatchObject({
      state: "unavailable",
    });
  });
});
