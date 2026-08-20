import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createHealthResponse, type HealthResponse } from "@pubg-camp/contracts";
import { createDatabase } from "@pubg-camp/database";
import { createRedisConnection, pingRedis } from "@pubg-camp/queue";

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly database = createDatabase(
    process.env.DATABASE_URL ?? "postgresql://pubg:pubg@127.0.0.1:5432/pubg_camp",
  );
  private readonly redis = createRedisConnection(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

  live(): HealthResponse {
    return createHealthResponse("api", "ok");
  }

  async ready(): Promise<HealthResponse> {
    const [postgres, redis] = await Promise.all([
      this.check(() => this.database.ping()),
      this.check(() => pingRedis(this.redis)),
    ]);
    const checks = { postgres, redis };
    const state = Object.values(checks).every((value) => value === "ok") ? "ok" : "unavailable";
    return createHealthResponse("api", state, checks);
  }

  async onModuleDestroy(): Promise<void> {
    await this.database.close();
    this.redis.disconnect();
  }

  private async check(probe: () => Promise<void>): Promise<HealthResponse["state"]> {
    try {
      await Promise.race([
        probe(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("readiness timeout")), 2_500),
        ),
      ]);
      return "ok";
    } catch {
      return "unavailable";
    }
  }
}
