import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";
import type { HealthService } from "./health.service.js";

describe("api health controller", () => {
  it("keeps liveness independent from infrastructure", () => {
    const service = {
      live: () => ({ service: "api", state: "ok", timestamp: new Date().toISOString() }),
    };
    const controller = new HealthController(service as HealthService);
    expect(controller.live()).toMatchObject({ service: "api", state: "ok" });
  });
});
