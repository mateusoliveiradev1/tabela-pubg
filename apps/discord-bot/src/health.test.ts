import { describe, expect, it } from "vitest";
import { discordHealth } from "./health.js";

describe("discord bot health", () => {
  it("reports gateway readiness", () => {
    expect(discordHealth(true)).toMatchObject({ service: "discord-bot", state: "ok" });
    expect(discordHealth(false).state).toBe("unavailable");
  });
});
