import { BaseEnvSchema, loadEnv, Phase2EnvSchema } from "@pubg-camp/config";
import {
  clearNotificationPayload,
  createDatabase,
  type NotificationDeliveryRow,
} from "@pubg-camp/database";
import { createLogger } from "@pubg-camp/logger";
import { initializeTelemetry } from "@pubg-camp/observability";
import { createRedisConnection, createWorker, pingRedis } from "@pubg-camp/queue";
import Fastify from "fastify";
import { z } from "zod";
import { live, ready } from "./health.js";
import { createNotificationProcessor } from "./notifications/processor.js";
import { ResendEmailSender } from "./notifications/resend-email-sender.js";

const env = loadEnv(
  BaseEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(3002),
    DATABASE_URL: z.url().default("postgresql://pubg:pubg@127.0.0.1:5432/pubg_camp"),
    APP_ORIGIN: Phase2EnvSchema.shape.APP_ORIGIN,
    REDIS_URL: Phase2EnvSchema.shape.REDIS_URL,
    AES_GCM_KEY_V1: Phase2EnvSchema.shape.AES_GCM_KEY_V1,
    ENCRYPTION_KEY_VERSION: Phase2EnvSchema.shape.ENCRYPTION_KEY_VERSION,
    RESEND_API_KEY: Phase2EnvSchema.shape.RESEND_API_KEY,
    EMAIL_FROM: Phase2EnvSchema.shape.EMAIL_FROM,
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
const database = createDatabase(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);
const sender = new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
const notificationProcessor = createNotificationProcessor({
  store: {
    findById: async (deliveryId: string): Promise<NotificationDeliveryRow | undefined> =>
      database.db.query.notificationDeliveries.findFirst({
        where: (delivery, operators) => operators.eq(delivery.id, deliveryId),
      }),
    clear: (deliveryId, outcome) => clearNotificationPayload(database.db, deliveryId, outcome),
  },
  sender,
  encryptionKeys: {
    [env.ENCRYPTION_KEY_VERSION]: Buffer.from(env.AES_GCM_KEY_V1, "hex"),
  },
  clock: { now: () => new Date() },
  appBaseUrl: env.APP_ORIGIN,
});
const notificationWorker = createWorker("outbox-delivery", redis, notificationProcessor);
const server = Fastify({ loggerInstance: logger });

server.get("/health/live", async () => live());
server.get("/health/ready", async (_request, reply) => {
  const response = await ready({
    postgres: () => database.ping(),
    redis: () => pingRedis(redis),
  });
  return reply.code(response.state === "ok" ? 200 : 503).send(response);
});

await server.listen({ port: env.PORT, host: "0.0.0.0" });
logger.info({ port: env.PORT }, "worker health server listening");

let shutdownStarted = false;
async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info({ signal }, "worker shutting down");
  const failures: unknown[] = [];
  try {
    await notificationWorker.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await server.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await database.close();
  } catch (error) {
    failures.push(error);
  }
  redis.disconnect();
  try {
    await telemetry.shutdown();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    logger.error({ failureCount: failures.length }, "worker shutdown incomplete");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
