import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { BaseEnvSchema, loadEnv } from "@pubg-camp/config";
import { migrateDatabase } from "@pubg-camp/database";
import { createLogger } from "@pubg-camp/logger";
import { initializeTelemetry } from "@pubg-camp/observability";
import { z } from "zod";
import { AppModule } from "./app.module.js";

const env = loadEnv(
  BaseEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1).default("postgresql://pubg:pubg@127.0.0.1:5432/pubg_camp"),
    RUN_MIGRATIONS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  }),
  { ...process.env, SERVICE_NAME: process.env.SERVICE_NAME ?? "api" },
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

if (env.RUN_MIGRATIONS) {
  logger.info("applying database migrations");
  await migrateDatabase(env.DATABASE_URL);
}

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  bufferLogs: true,
});
app.enableShutdownHooks();
await app.listen(env.PORT, "0.0.0.0");
logger.info({ port: env.PORT }, "api listening");

async function shutdown(signal: string) {
  logger.info({ signal }, "api shutting down");
  await app.close();
  await telemetry.shutdown();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
