import {
  completeOtpChallenge,
  consumeOAuthTransaction,
  createDiscordAccount,
  createEncryptedNotificationDelivery,
  createIdentityLinkProof,
  createOAuthTransaction,
  type DatabaseConnection,
  type EncryptionKey,
  executeIdentitySecurityChange,
  findActiveAuthChallenge,
  findDiscordIdentity,
  findPendingIdentityLink,
  findSessionForStepUp,
  issueIdentitySession,
  issueSessionForDevice,
  linkIdentity,
  listIdentitiesForUser,
  listSessionsForUser,
  markSessionStepUp,
  recordAuthChallengeFailure,
  removeOwnedIdentity,
  replaceAuthChallengeDigest,
  resolveAlertContextByDigest,
  revokeOtherSessions,
  revokeSession,
  rotateIdentitySession,
  sessionDurations,
} from "@pubg-camp/database";
import { createRedisConnection, pingRedis } from "@pubg-camp/queue";
import type { CsrfService } from "../security/csrf.service.js";
import { DiscordOAuthAdapter, type DiscordOAuthConfig } from "./adapters/discord-oauth.js";
import {
  RedisAuthRateLimiter,
  RedisDiscordOAuthVerifierStore,
} from "./adapters/redis-auth-rate-limiter.js";
import type { IdentityModuleServices } from "./identity.module.js";
import type { IdentitySecurityChangeApplicationPort } from "./identity.service.js";
import { type IdentityRepository, IdentityService } from "./identity.service.js";
import { OAuthService, type OAuthTransactionRepository } from "./oauth.service.js";
import { type OtpRepository, OtpService, type SecureOtpDeliveryPort } from "./otp.service.js";
import type { TokenGenerator } from "./ports/token-generator.js";
import { type SessionRepositoryPort, SessionService } from "./session.service.js";

export interface IdentityRuntimeOptions {
  database: DatabaseConnection["db"];
  redisUrl: string;
  redisScope?: IdentityRedisScope;
  discord: DiscordOAuthConfig;
  discordFetch?: typeof globalThis.fetch;
  csrf: CsrfService;
  tokens: TokenGenerator;
  otpPepper: Uint8Array;
  encryptionKey: EncryptionKey;
  clock?: { now(): Date };
  securityLog?: { record(event: { correlationId: string; category: string }): void };
}

export interface IdentityRuntime {
  services: IdentityModuleServices;
  close(): Promise<void>;
}

export type IdentityRedisScope = { mode: "production" } | { mode: "run"; runScopeId: string };

export interface IdentityRedisPrefixes {
  authKeyPrefix: string;
  oauthPkceKeyPrefix: string;
}

const identityRedisRunScopePattern = /^run-[a-z0-9][a-z0-9-]{14,62}$/;
const broadIdentityRedisRunScopePattern =
  /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/;

export function resolveIdentityRedisPrefixes(
  scope: IdentityRedisScope = { mode: "production" },
): IdentityRedisPrefixes {
  if (scope.mode === "production") {
    return {
      authKeyPrefix: "pubg-camp:auth",
      oauthPkceKeyPrefix: "pubg-camp:oauth:pkce",
    };
  }

  if (
    typeof scope.runScopeId !== "string" ||
    !identityRedisRunScopePattern.test(scope.runScopeId) ||
    broadIdentityRedisRunScopePattern.test(scope.runScopeId)
  ) {
    throw new Error("identity Redis run scope is invalid");
  }

  return {
    authKeyPrefix: `pubg-camp:${scope.runScopeId}:auth`,
    oauthPkceKeyPrefix: `pubg-camp:${scope.runScopeId}:oauth:pkce`,
  };
}

export function buildOtpNotificationDelivery(
  input: Parameters<SecureOtpDeliveryPort["enqueue"]>[0],
  now = new Date(),
) {
  return {
    id: input.deliveryId,
    template: "otp" as const,
    recipient: input.recipient,
    idempotencyKey: `otp:${input.challengeId}`,
    payload: {
      recipient: input.recipient,
      code: input.code,
      expiresAt: input.expiresAt.toISOString(),
    },
    payloadExpiresAt: input.expiresAt,
    availableAt: now,
    occurredAt: now,
    correlationId: input.correlationId,
  };
}

export async function createIdentityRuntime(
  options: IdentityRuntimeOptions,
): Promise<IdentityRuntime> {
  const clock = options.clock ?? { now: () => new Date() };
  const redisPrefixes = resolveIdentityRedisPrefixes(options.redisScope);
  const redis = createRedisConnection(options.redisUrl);
  await pingRedis(redis);

  const sessions = new SessionService(
    sessionRepository(options.database, options.tokens, options.encryptionKey, clock),
    options.tokens,
    clock,
  );
  const securityChanges = buildIdentitySecurityChangeApplication({
    database: options.database,
    tokens: options.tokens,
    clock,
  });
  const identity = new IdentityService(
    identityRepository(options.database, options.tokens, clock),
    sessions,
    options.tokens,
    clock,
    securityChanges,
  );
  const oauth = new OAuthService(
    new DiscordOAuthAdapter(
      options.discord,
      new RedisDiscordOAuthVerifierStore(redis, redisPrefixes.oauthPkceKeyPrefix),
      {
        now: () => clock.now(),
        ...(options.discordFetch === undefined ? {} : { fetch: options.discordFetch }),
      },
    ),
    oauthRepository(options.database, clock),
    identity,
    sessions,
    options.tokens,
    clock,
  );
  const otp = new OtpService(
    otpRepository(options.database, clock),
    new RedisAuthRateLimiter(redis, { keyPrefix: redisPrefixes.authKeyPrefix }),
    {
      enqueue: async (input) => {
        const now = clock.now();
        await createEncryptedNotificationDelivery(options.database, {
          ...buildOtpNotificationDelivery(input, now),
          encryptionKey: options.encryptionKey,
          outboxEventId: options.tokens.id(),
        });
      },
    },
    options.securityLog ?? { record: () => undefined },
    options.tokens,
    clock,
    options.otpPepper,
  );

  return {
    services: {
      oauth,
      otp,
      identity,
      session: sessions,
      csrf: options.csrf,
      securityChanges,
    },
    close: async () => {
      await redis.quit();
    },
  };
}

export function buildIdentitySecurityChangeApplication(input: {
  database: DatabaseConnection["db"];
  tokens: TokenGenerator;
  clock: { now(): Date };
  execute?: typeof executeIdentitySecurityChange;
}): IdentitySecurityChangeApplicationPort {
  const execute = input.execute ?? executeIdentitySecurityChange;
  return {
    execute: async (command) => {
      const committed = await execute({
        database: input.database,
        actorId: command.actorId,
        currentSessionId: command.currentSessionId,
        proofId: command.proofId,
        change: command.change,
        now: command.now,
        generateId: () => input.tokens.id(),
        generateCorrelationId: () => command.correlationId,
        generateOpaqueToken: () => Buffer.from(input.tokens.opaque(32), "base64url"),
      });
      return {
        sessionId: committed.sessionId,
        sessionToken: committed.newSessionToken,
        otherSessionsRevoked: committed.revokedOtherSessions,
      };
    },
  };
}

function oauthRepository(
  database: DatabaseConnection["db"],
  clock: { now(): Date },
): OAuthTransactionRepository {
  return {
    create: (input) =>
      createOAuthTransaction(
        database,
        {
          ...input,
          ...(input.actorId === undefined ? {} : { userId: input.actorId }),
        },
        () => clock.now(),
      ),
    consume: async (input) => {
      const consumed = await consumeOAuthTransaction(database, input, () => input.now);
      return consumed ? projectOAuthTransaction(consumed) : null;
    },
    createPendingLinkProof: (input) => createIdentityLinkProof(database, input, () => clock.now()),
  };
}

export function projectOAuthTransaction(input: {
  purpose: "sign-in" | "link-identity" | "step-up";
  returnPath: string | null;
  userId: string | null;
  sessionId: string | null;
  currentMethodConfirmedAt: Date | null;
}) {
  return {
    purpose: input.purpose,
    ...(input.returnPath === null ? {} : { returnPath: input.returnPath }),
    ...(input.userId === null ? {} : { actorId: input.userId }),
    ...(input.sessionId === null ? {} : { sessionId: input.sessionId }),
    ...(input.currentMethodConfirmedAt === null
      ? {}
      : { currentMethodConfirmedAt: input.currentMethodConfirmedAt }),
  };
}

function identityRepository(
  database: DatabaseConnection["db"],
  tokens: TokenGenerator,
  clock: { now(): Date },
): IdentityRepository {
  return {
    findDiscordIdentity: (subject) => findDiscordIdentity(database, subject),
    createDiscordAccount: (input) =>
      createDiscordAccount(database, {
        ...input,
        now: clock.now(),
        ...(input.verifiedEmail === undefined ? {} : { verifiedEmailId: tokens.id() }),
      }),
    link: async (input) => {
      const linked = await linkIdentity(database, {
        id: input.identityId,
        userId: input.userId,
        provider: input.provider,
        providerSubject: input.subject,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        verifiedAt: input.verifiedAt,
      });
      return { status: linked.status };
    },
    listForUser: (userId) => listIdentitiesForUser(database, userId),
    findPendingLink: (input) => findPendingIdentityLink(database, input),
    removeOwned: (input) => removeOwnedIdentity(database, input),
  };
}

function otpRepository(database: DatabaseConnection["db"], clock: { now(): Date }): OtpRepository {
  return {
    replace: (challenge) =>
      replaceAuthChallengeDigest(database, { ...challenge, now: clock.now() }),
    findActive: async (input) => {
      const challenge = await findActiveAuthChallenge(database, input);
      return challenge
        ? {
            id: challenge.id,
            emailDigest: challenge.emailDigest,
            purpose: challenge.purpose,
            codeDigest: challenge.codeDigest,
            attemptsRemaining: challenge.attemptsRemaining,
            expiresAt: challenge.expiresAt,
            ...(challenge.userId === null ? {} : { actorId: challenge.userId }),
            ...(challenge.sessionId === null ? {} : { sessionId: challenge.sessionId }),
          }
        : null;
    },
    recordFailure: (input) => recordAuthChallengeFailure(database, input),
    complete: (input) => completeOtpChallenge(database, input),
  };
}

function sessionRepository(
  database: DatabaseConnection["db"],
  tokens: TokenGenerator,
  encryptionKey: EncryptionKey,
  clock: { now(): Date },
): SessionRepositoryPort {
  return {
    issue: (input) =>
      issueIdentitySession(database, {
        id: input.id,
        userId: input.userId,
        token: input.token,
        trust: input.trust,
        issuedAt: input.issuedAt,
        absoluteExpiresAt:
          input.expiresAt ?? new Date(input.issuedAt.getTime() + sessionDurations.absoluteMs),
        deviceId: tokens.id(),
      }),
    issueForDevice: async (input) => {
      const issued = await issueSessionForDevice(
        database,
        {
          userId: input.userId,
          trust: input.trust,
          deviceFingerprint: input.deviceFingerprint,
          device: input.device,
          newDeviceNotification: {
            recipient: input.newDeviceNotification.recipient,
            template: "new-device",
            idempotencyKey: `new-device:${tokens.id()}`,
            encryptionKey,
          },
        },
        {
          clock: () => clock.now(),
          generateId: () => tokens.id(),
          randomBytes: (size) => Buffer.from(tokens.opaque(size), "base64url"),
        },
      );
      return {
        sessionId: issued.session.id,
        token: issued.token,
        isNewDevice: issued.isNewDevice,
        notificationScheduled: issued.notificationDeliveryId !== undefined,
      };
    },
    list: async (userId) =>
      (await listSessionsForUser(database, userId)).map(({ session, device }) => ({
        id: session.id,
        userId: session.userId,
        device: {
          label: device.label,
          browser: device.browser,
          operatingSystem: device.operatingSystem,
          ...(device.approximateLocation === null
            ? {}
            : { approximateLocation: device.approximateLocation }),
        },
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        ...(session.revokedAt === null ? {} : { revokedAt: session.revokedAt }),
        ...(session.reauthenticatedAt === null
          ? {}
          : { reauthenticatedAt: session.reauthenticatedAt }),
      })),
    revoke: (input) =>
      revokeSession(database, input.userId, input.sessionId, input.reason, () => input.now),
    revokeOthers: (input) =>
      revokeOtherSessions(
        database,
        input.userId,
        input.preservedSessionId,
        input.reason,
        () => input.now,
      ),
    rotate: (input) => rotateIdentitySession(database, input),
    findForStepUp: async (userId, sessionId) => {
      const resolved = await findSessionForStepUp(database, userId, sessionId);
      return resolved
        ? {
            id: resolved.session.id,
            userId: resolved.session.userId,
            device: {
              label: resolved.device.label,
              browser: resolved.device.browser,
              operatingSystem: resolved.device.operatingSystem,
              ...(resolved.device.approximateLocation === null
                ? {}
                : { approximateLocation: resolved.device.approximateLocation }),
            },
            createdAt: resolved.session.createdAt,
            lastSeenAt: resolved.session.lastSeenAt,
            idleExpiresAt: resolved.session.idleExpiresAt,
            absoluteExpiresAt: resolved.session.absoluteExpiresAt,
            ...(resolved.session.revokedAt === null
              ? {}
              : { revokedAt: resolved.session.revokedAt }),
            ...(resolved.session.reauthenticatedAt === null
              ? {}
              : { reauthenticatedAt: resolved.session.reauthenticatedAt }),
          }
        : null;
    },
    markStepUp: (input) => markSessionStepUp(database, input),
    resolveAlertContextReadOnly: (input) => resolveAlertContextByDigest(database, input),
  };
}
