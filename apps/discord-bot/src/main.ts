import { BaseEnvSchema, loadEnv } from "@pubg-camp/config";
import { createHealthResponse } from "@pubg-camp/contracts";
import { createLogger } from "@pubg-camp/logger";
import { initializeTelemetry } from "@pubg-camp/observability";
import { Client, GatewayIntentBits } from "discord.js";
import Fastify from "fastify";
import { z } from "zod";
import { discordHealth } from "./health.js";

const env = loadEnv(
  BaseEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(3003),
    DISCORD_BOT_TOKEN: z.string().min(1),
  }),
  { ...process.env, SERVICE_NAME: process.env.SERVICE_NAME ?? "discord-bot" },
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
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const server = Fastify({ loggerInstance: logger });

server.get("/health/live", async () => createHealthResponse("discord-bot", "ok"));
server.get("/health/ready", async (_request, reply) => {
  const response = discordHealth(client.isReady());
  return reply.code(response.state === "ok" ? 200 : 503).send(response);
});

client.once("ready", () => logger.info({ user: client.user?.tag }, "discord gateway ready"));
await Promise.all([
  server.listen({ port: env.PORT, host: "0.0.0.0" }),
  client.login(env.DISCORD_BOT_TOKEN),
]);

async function shutdown(signal: string) {
  logger.info({ signal }, "discord bot shutting down");
  client.destroy();
  await server.close();
  await telemetry.shutdown();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
