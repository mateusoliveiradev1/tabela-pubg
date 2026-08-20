import { createHealthResponse, type HealthResponse } from "@pubg-camp/contracts";

export function discordHealth(ready: boolean): HealthResponse {
  return createHealthResponse("discord-bot", ready ? "ok" : "unavailable", {
    discord: ready ? "ok" : "unavailable",
  });
}
