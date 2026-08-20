import { createHealthResponse, type HealthResponse } from "@pubg-camp/contracts";

export function live(): HealthResponse {
  return createHealthResponse("worker", "ok");
}

export async function ready(probe: () => Promise<void>): Promise<HealthResponse> {
  try {
    await probe();
    return createHealthResponse("worker", "ok", { redis: "ok" });
  } catch {
    return createHealthResponse("worker", "unavailable", { redis: "unavailable" });
  }
}
