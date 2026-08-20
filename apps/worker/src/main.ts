import { BaseEnvSchema, loadEnv } from "@pubg-camp/config";
import { createLogger } from "@pubg-camp/logger";
import { initializeTelemetry } from "@pubg-camp/observability";
import { createRedisConnection, createWorker, pingRedis } from "@pubg-camp/queue";
import Fastify from "fastify";
import { z } from "zod";
import { live, ready } from "./health.js";

const env = loadEnv(
  BaseEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(3002),
    REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  }),
  { ...process.env, SERVICE_NAME: process.env.SERVICE_NAME ?? "worker" },
);
const logger = createLogger({
  service: env.SERVICE_NAME,
  level: env.LOG_LEVEL,
  environment: env.NODE_ENV,
});
const telemetry = initializeTelemetry({
  serviceName: env.SERVICE_NAME,
  enabled: env.NODE_ENV !== "test",
});
const redis = createRedisConnection(env.REDIS_URL);
const outboxWorker = createWorker(
  "outbox-delivery",
  redis,
  async (data: Record<string, unknown>) => data,
);
const server = Fastify({ loggerInstance: logger });

server.get("/health/live", async () => live());
server.get("/health/ready", async (_request, reply) => {
  const response = await ready(() => pingRedis(redis));
  return reply.code(response.state === "ok" ? 200 : 503).send(response);
});

await server.listen({ port: env.PORT, host: "0.0.0.0" });
logger.info({ port: env.PORT }, "worker health server listening");

async function shutdown(signal: string) {
  logger.info({ signal }, "worker shutting down");
  await outboxWorker.close();
  await server.close();
  redis.disconnect();
  await telemetry.shutdown();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
