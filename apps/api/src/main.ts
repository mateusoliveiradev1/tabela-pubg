import "reflect-metadata";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
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
  resolveAndTouchSession,
} from "@pubg-camp/database";
import { migrateDatabase } from "@pubg-camp/database/migrator";
import { createLogger } from "@pubg-camp/logger";
import { initializeTelemetry } from "@pubg-camp/observability";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { registerAppModule } from "./app.module.js";
import { createIdentityRuntime, type IdentityRedisScope } from "./identity/identity.runtime.js";
import { S3OrganizationLogoStorage } from "./organizations/adapters/s3-organization-logo-storage.js";
import {
  collectOrganizationMultipartBody,
  ORGANIZATION_LOGO_MULTIPART_MAX_BYTES,
} from "./organizations/organizations.controller.js";
import { CsrfService, registerCsrfPlugins } from "./security/csrf.service.js";
import { HttpExceptionFilter } from "./security/http-exception.filter.js";

const E2E_RUN_ID = /^run-[a-z0-9][a-z0-9-]{14,62}$/;
const BROAD_E2E_RUN_ID = /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/;
const E2E_ROOT_PREFIX = "pubg-camp-phase2-e2e-";

export interface ApiProviderEnvironment {
  NODE_ENV?: string | undefined;
  E2E_PROVIDER_MODE?: string | undefined;
  E2E_RUN_ID?: string | undefined;
  E2E_OBJECT_ROOT?: string | undefined;
  E2E_LOGO_ORIGIN?: string | undefined;
}

export type ApiProviderMode =
  | { mode: "production"; redisScope: { mode: "production" } }
  | {
      mode: "fake";
      runId: string;
      objectRoot: string;
      logoOrigin?: string;
      redisScope: { mode: "run"; runScopeId: string };
      discordFetch: typeof globalThis.fetch;
    };

export async function resolveApiProviderMode(
  environment: ApiProviderEnvironment,
): Promise<ApiProviderMode> {
  const fakeFieldsPresent =
    environment.E2E_PROVIDER_MODE !== undefined ||
    environment.E2E_RUN_ID !== undefined ||
    environment.E2E_OBJECT_ROOT !== undefined ||
    environment.E2E_LOGO_ORIGIN !== undefined;
  if (!fakeFieldsPresent) return { mode: "production", redisScope: { mode: "production" } };
  if (
    environment.NODE_ENV !== "test" ||
    environment.E2E_PROVIDER_MODE !== "fake" ||
    !environment.E2E_RUN_ID ||
    !environment.E2E_OBJECT_ROOT
  ) {
    throw new Error("E2E fake providers require the complete test-only provider conjunction");
  }
  if (!E2E_RUN_ID.test(environment.E2E_RUN_ID) || BROAD_E2E_RUN_ID.test(environment.E2E_RUN_ID)) {
    throw new Error("E2E run scope is invalid");
  }
  const objectRoot = await resolveOwnedE2ERoot(environment.E2E_OBJECT_ROOT);
  const logoOrigin =
    environment.E2E_LOGO_ORIGIN === undefined
      ? undefined
      : resolveLoopbackE2ELogoOrigin(environment.E2E_LOGO_ORIGIN);
  return {
    mode: "fake",
    runId: environment.E2E_RUN_ID,
    objectRoot,
    ...(logoOrigin === undefined ? {} : { logoOrigin }),
    redisScope: { mode: "run", runScopeId: environment.E2E_RUN_ID },
    discordFetch: createFakeDiscordFetch(environment.E2E_RUN_ID),
  };
}

export function createFakeDiscordFetch(runId: string): typeof globalThis.fetch {
  if (!E2E_RUN_ID.test(runId) || BROAD_E2E_RUN_ID.test(runId)) {
    throw new Error("E2E Discord run scope is invalid");
  }
  const token = createHash("sha256").update(`discord-token:${runId}`, "utf8").digest("base64url");
  const profileSuffix = BigInt(`0x${createHash("sha256").update(runId).digest("hex").slice(0, 12)}`)
    .toString(10)
    .padStart(14, "0")
    .slice(0, 14);
  return async (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== "https://discord.com")
      throw new Error("E2E Discord transport rejected origin");
    if (url.pathname === "/api/oauth2/token") {
      return Response.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 300,
        scope: "identify email",
      });
    }
    if (url.pathname === "/api/users/@me") {
      return Response.json({
        id: `1000${profileSuffix}`,
        username: `e2e-${profileSuffix.slice(-8)}`,
        verified: false,
      });
    }
    if (url.pathname === "/api/oauth2/token/revoke") return new Response(null, { status: 200 });
    throw new Error("E2E Discord transport rejected endpoint");
  };
}

function resolveLoopbackE2ELogoOrigin(candidate: string): string {
  const origin = new URL(candidate);
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    !origin.port ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("E2E logo origin must be an exact loopback HTTP origin");
  }
  return origin.origin;
}

async function resolveOwnedE2ERoot(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) throw new Error("E2E object root must be absolute");
  let root: string;
  let systemTemp: string;
  try {
    [root, systemTemp] = await Promise.all([realpath(candidate), realpath(tmpdir())]);
  } catch {
    throw new Error("E2E object root must be an existing mkdtemp directory");
  }
  const relative = path.relative(systemTemp, root);
  if (
    !(await stat(root)).isDirectory() ||
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(root).startsWith(E2E_ROOT_PREFIX) ||
    path.basename(root).length <= E2E_ROOT_PREFIX.length
  ) {
    throw new Error("E2E object root is outside the owned mkdtemp scope");
  }
  return root;
}

function requireProductionLogoStorage(
  storage: S3OrganizationLogoStorage | undefined,
): S3OrganizationLogoStorage {
  if (!storage) throw new Error("production logo storage is unavailable");
  return storage;
}

const ApiEnvSchema = Phase2EnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  RUN_MIGRATIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().trim().min(1).max(120),
  S3_BUCKET: z.string().trim().min(3).max(63),
  S3_ACCESS_KEY: z.string().min(1).max(512),
  S3_SECRET_KEY: z.string().min(8).max(512),
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
  const providerMode = await resolveApiProviderMode(process.env);
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
  const logoStorage =
    providerMode.mode === "production"
      ? new S3OrganizationLogoStorage({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
          forcePathStyle: true,
        })
      : undefined;
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
  const identity = await createIdentityRuntime({
    database: database.db,
    redisUrl: env.REDIS_URL,
    redisScope: providerMode.redisScope satisfies IdentityRedisScope,
    discord: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      redirectUri: env.DISCORD_REDIRECT_URI,
      pkceMode: env.DISCORD_PKCE_MODE,
      ...(env.DISCORD_PKCE_EXCEPTION_ID === undefined
        ? {}
        : { pkceExceptionId: env.DISCORD_PKCE_EXCEPTION_ID }),
    },
    ...(providerMode.mode === "fake" ? { discordFetch: providerMode.discordFetch } : {}),
    csrf,
    tokens,
    otpPepper: Buffer.from(env.OTP_PEPPER, "utf8"),
    encryptionKey: {
      version: env.ENCRYPTION_KEY_VERSION,
      key: Buffer.from(env.AES_GCM_KEY_V1, "hex"),
    },
    securityLog: {
      record: (event) => logger.warn(event, "identity security event"),
    },
  });
  const adapter = new FastifyAdapter({
    bodyLimit: 1_048_576,
    trustProxy: trustedProxyConfiguration(env.TRUSTED_PROXY),
  });
  adapter
    .getInstance()
    .addContentTypeParser(
      /^multipart\/form-data(?:;|$)/i,
      { bodyLimit: ORGANIZATION_LOGO_MULTIPART_MAX_BYTES },
      async (_request: FastifyRequest, payload: IncomingMessage) =>
        collectOrganizationMultipartBody(payload),
    );
  const app = await NestFactory.create<NestFastifyApplication>(
    registerAppModule({
      csrf,
      authorization: {
        sessionCookieName: env.SESSION_COOKIE_NAME,
        authenticate: async (opaqueToken) => {
          const resolved = await resolveAndTouchSession(database.db, opaqueToken, () => new Date());
          return resolved
            ? {
                actorId: resolved.session.userId,
                sessionId: resolved.session.id,
                trust: resolved.trust,
              }
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
        securityLog: {
          record: (event) => logger.warn(event, "authorization security event"),
        },
        denialRecorder: {
          record: (event) => logger.warn(event, "authorization denial"),
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
        ...(providerMode.mode === "production"
          ? { logoStorage: requireProductionLogoStorage(logoStorage) }
          : {
              environment: process.env,
              e2eObjectRoot: providerMode.objectRoot,
              ...(providerMode.logoOrigin === undefined
                ? {}
                : { e2eLogoPublicBasePath: `${providerMode.logoOrigin}/objects` }),
            }),
        logoFallbackUrl: `${env.APP_ORIGIN.replace(/\/$/, "")}/images/organization-fallback.svg`,
        logoSignedUrlTtlSeconds: 300,
      },
      audit: { database: database.db },
      identity: identity.services,
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
    await identity.close();
    logoStorage?.close();
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
