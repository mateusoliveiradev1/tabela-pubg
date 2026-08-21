import { createHealthResponse, type HealthResponse } from "@pubg-camp/contracts";

export function live(): HealthResponse {
  return createHealthResponse("worker", "ok");
}

export interface WorkerReadinessProbes {
  postgres(): Promise<void>;
  redis(): Promise<void>;
}

export async function ready(probes: WorkerReadinessProbes): Promise<HealthResponse> {
  const checks = {
    postgres: await settle(probes.postgres),
    redis: await settle(probes.redis),
  };
  const state = Object.values(checks).every((check) => check === "ok") ? "ok" : "unavailable";
  return createHealthResponse("worker", state, checks);
}

async function settle(probe: () => Promise<void>): Promise<"ok" | "unavailable"> {
  try {
    await probe();
    return "ok";
  } catch {
    return "unavailable";
  }
}
