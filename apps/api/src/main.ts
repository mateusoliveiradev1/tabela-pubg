import "reflect-metadata";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { AuthorizationSnapshot } from "@pubg-camp/authorization";
import { loadEnv, Phase2EnvSchema } from "@pubg-camp/config";
import {
  createDatabase,
  hasRecentReauthentication,
  loadAuthorizationSnapshot,
  resolveSession,
} from "@pubg-camp/database";
import { migrateDatabase } from "@pubg-camp/database/migrator";
import { createLogger } from "@pubg-camp/logger";
import { initializeTelemetry } from "@pubg-camp/observability";
import { z } from "zod";
import { registerAppModule } from "./app.module.js";
import { CsrfService, registerCsrfPlugins } from "./security/csrf.service.js";
import { HttpExceptionFilter } from "./security/http-exception.filter.js";

const ApiEnvSchema = Phase2EnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  RUN_MIGRATIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export function trustedProxyConfiguration(mode: "none" | "loopback" | "private"): false | string[] {
  switch (mode) {
    case "none":
      return false;
    case "loopback":
      return ["127.0.0.1", "::1"];
    case "private":
      return ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
  }
}

export async function bootstrap(): Promise<NestFastifyApplication> {
  const env = loadEnv(ApiEnvSchema, {
    ...process.env,
    SERVICE_NAME: process.env.SERVICE_NAME ?? "api",
  });
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
  const database = createDatabase(env.DATABASE_URL);
  const tokens = {
    id: () => randomUUID(),
    opaque: (bytes: number) => randomBytes(bytes).toString("base64url"),
    numericCode: (digits: number) =>
      Array.from({ length: digits }, () => randomInt(0, 10).toString()).join(""),
    digest: (value: string) => createHash("sha256").update(value, "utf8").digest("hex"),
  };

  const csrf = new CsrfService({
    appOrigin: env.APP_ORIGIN,
    csrfSecret: env.CSRF_SECRET,
    cookieSigningKey: env.SESSION_COOKIE_SECRET,
    secureCookies: env.SESSION_COOKIE_SECURE,
    sessionCookieName: env.SESSION_COOKIE_NAME,
  });
  const adapter = new FastifyAdapter({
    bodyLimit: 1_048_576,
    trustProxy: trustedProxyConfiguration(env.TRUSTED_PROXY),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    registerAppModule({
      csrf,
      authorization: {
        sessionCookieName: env.SESSION_COOKIE_NAME,
        authenticate: async (opaqueToken) => {
          const resolved = await resolveSession(database.db, opaqueToken, () => new Date());
          return resolved
            ? { actorId: resolved.session.userId, sessionId: resolved.session.id }
            : null;
        },
        loadSnapshot: async ({ actorId, organizationId }) => {
          const current = await loadAuthorizationSnapshot(database.db, organizationId, actorId);
          return {
            actorId: actorId as AuthorizationSnapshot["actorId"],
            organizationId: organizationId as AuthorizationSnapshot["organizationId"],
            membershipStatus: current?.membershipStatus ?? "revoked",
            organizationRole: current?.organizationRole ?? null,
            assignments:
              current?.assignments.map((assignment) => ({
                ...assignment,
                organizationId:
                  assignment.organizationId as AuthorizationSnapshot["organizationId"],
                authorizationScopeId:
                  assignment.authorizationScopeId as AuthorizationSnapshot["assignments"][number]["authorizationScopeId"],
              })) ?? [],
          };
        },
      },
      organizations: {
        database: database.db,
        encryptionKey: {
          version: env.ENCRYPTION_KEY_VERSION,
          key: Buffer.from(env.AES_GCM_KEY_V1, "hex"),
        },
        tokens,
        sessions: {
          requireRecentReauthentication: async (userId, sessionId) => {
            if (!(await hasRecentReauthentication(database.db, userId, sessionId, new Date()))) {
              throw new Error("recent authentication required");
            }
          },
        },
      },
      audit: { database: database.db },
    }),
    adapter,
    { bufferLogs: true },
  );

  type RegisterablePlugin = Parameters<typeof app.register>[0];
  await registerCsrfPlugins(adapter.getInstance(), csrf, { cookie, csrfProtection });
  await app.register(helmet as unknown as RegisterablePlugin, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit as unknown as RegisterablePlugin, {
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({ statusCode: 429, error: "Too Many Requests" }),
  });
  app.enableCors({
    origin: env.APP_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "x-correlation-id",
      "x-csrf-token",
      "x-organization-id",
      "x-authorization-scope-id",
      "x-auth-browser-binding",
    ],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(env.PORT, "0.0.0.0");
  logger.info({ port: env.PORT }, "api listening");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "api shutting down");
    await app.close();
    await database.close();
    await telemetry.shutdown();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  return app;
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  void bootstrap().catch(() => {
    process.stderr.write("api bootstrap failed\n");
    process.exitCode = 1;
  });
}
