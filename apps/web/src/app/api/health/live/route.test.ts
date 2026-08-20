import { describe, expect, it } from "vitest";
import { GET } from "./route.js";

describe("web liveness", () => {
  it("returns an ok response without external dependencies", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ service: "web", state: "ok" });
  });
});
