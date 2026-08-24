import {
  consumeAuthChallengeByDigest,
  consumeOAuthTransaction,
  createDiscordAccount,
  createEncryptedNotificationDelivery,
  createOAuthTransaction,
  type DatabaseConnection,
  type EncryptionKey,
  findActiveAuthChallenge,
  findDiscordIdentity,
  findSessionForStepUp,
  issueIdentitySession,
  issueSessionForDevice,
  linkIdentity,
  listSessionsForUser,
  markSessionStepUp,
  recordAuthChallengeFailure,
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
import { type IdentityRepository, IdentityService } from "./identity.service.js";
import { OAuthService, type OAuthTransactionRepository } from "./oauth.service.js";
import { type OtpRepository, OtpService, type SecureOtpDeliveryPort } from "./otp.service.js";
import type { TokenGenerator } from "./ports/token-generator.js";
import { type SessionRepositoryPort, SessionService } from "./session.service.js";

export interface IdentityRuntimeOptions {
  database: DatabaseConnection["db"];
  redisUrl: string;
  discord: DiscordOAuthConfig;
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
  const redis = createRedisConnection(options.redisUrl);
  await pingRedis(redis);

  const sessions = new SessionService(
    sessionRepository(options.database, options.tokens, options.encryptionKey, clock),
    options.tokens,
    clock,
  );
  const identity = new IdentityService(
    identityRepository(options.database, options.tokens, clock),
    sessions,
    options.tokens,
    clock,
  );
  const oauth = new OAuthService(
    new DiscordOAuthAdapter(
      options.discord,
      new RedisDiscordOAuthVerifierStore(redis, "pubg-camp:oauth:pkce"),
      { now: () => clock.now() },
    ),
    oauthRepository(options.database, clock),
    identity,
    options.tokens,
    clock,
  );
  const otp = new OtpService(
    otpRepository(options.database),
    new RedisAuthRateLimiter(redis),
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
    services: { oauth, otp, session: sessions, csrf: options.csrf },
    close: async () => {
      await redis.quit();
    },
  };
}

function oauthRepository(
  database: DatabaseConnection["db"],
  clock: { now(): Date },
): OAuthTransactionRepository {
  return {
    create: (input) => createOAuthTransaction(database, input, () => clock.now()),
    consume: async (input) => {
      const consumed = await consumeOAuthTransaction(database, input, () => input.now);
      return consumed
        ? {
            purpose: consumed.purpose,
            ...(consumed.returnPath === null ? {} : { returnPath: consumed.returnPath }),
            ...(consumed.userId === null ? {} : { userId: consumed.userId }),
            ...(consumed.sessionId === null ? {} : { sessionId: consumed.sessionId }),
          }
        : null;
    },
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
  };
}

function otpRepository(database: DatabaseConnection["db"]): OtpRepository {
  return {
    replace: (challenge) => replaceAuthChallengeDigest(database, { ...challenge, now: new Date() }),
    findActive: async (challengeId, purpose) => {
      const challenge = await findActiveAuthChallenge(database, challengeId, purpose);
      return challenge
        ? {
            id: challenge.id,
            emailDigest: challenge.emailDigest,
            purpose: challenge.purpose,
            codeDigest: challenge.codeDigest,
            attemptsRemaining: challenge.attemptsRemaining,
            expiresAt: challenge.expiresAt,
          }
        : null;
    },
    recordFailure: (challengeId, now) => recordAuthChallengeFailure(database, challengeId, now),
    consumeIfActive: async (input) => ({
      consumed: await consumeAuthChallengeByDigest(database, input),
    }),
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
