import { createHealthResponse, type HealthResponse } from "@pubg-camp/contracts";
import { createDatabase } from "@pubg-camp/database";
import { createRedisConnection, pingRedis } from "@pubg-camp/queue";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function settle(check: () => Promise<void>): Promise<HealthResponse["state"]> {
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("readiness timeout")), 2_500),
      ),
    ]);
    return "ok";
  } catch {
    return "unavailable";
  }
}

export async function GET() {
  const database = createDatabase(
    process.env.DATABASE_URL ?? "postgresql://pubg:pubg@127.0.0.1:5432/pubg_camp",
  );
  const redis = createRedisConnection(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

  const [postgres, redisState] = await Promise.all([
    settle(() => database.ping()),
    settle(() => pingRedis(redis)),
  ]);
  await database.close();
  redis.disconnect();

  const checks = { postgres, redis: redisState };
  const state = Object.values(checks).every((value) => value === "ok") ? "ok" : "unavailable";
  return NextResponse.json(createHealthResponse("web", state, checks), {
    status: state === "ok" ? 200 : 503,
  });
}
