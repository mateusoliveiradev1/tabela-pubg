import { createHash } from "node:crypto";
import { and, desc, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import { devices, type SessionRow, sessionAlertContexts, sessions, users } from "../schema.js";
import type { Clock, RepositoryExecutor } from "./identity.js";
import { createEncryptedNotificationDelivery, type EncryptionKey } from "./notifications.js";

const IDLE_TTL_MS = 30 * 24 * 60 * 60_000;
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60_000;
const ALERT_TTL_MS = 24 * 60 * 60_000;
const TOUCH_COALESCE_MS = 5 * 60_000;

type DeviceRow = typeof devices.$inferSelect;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeOpaqueToken(bytes: Uint8Array): string {
  if (bytes.byteLength !== 32) {
    throw new Error("opaque session and alert tokens must contain exactly 32 random bytes");
  }
  return Buffer.from(bytes).toString("base64url");
}

export interface SessionRepositoryDependencies {
  clock: Clock;
  generateId: () => string;
  randomBytes: (size: number) => Uint8Array;
}

export interface DeviceMetadata {
  label: string;
  browser: string;
  operatingSystem: string;
  approximateLocation?: string;
  summarizedUserAgent?: string;
}

export interface NewDeviceNotification {
  recipient: string;
  template: string;
  idempotencyKey: string;
  encryptionKey: EncryptionKey;
}

export interface IssueSessionForDeviceInput {
  userId: string;
  deviceFingerprint: string;
  device: DeviceMetadata;
  newDeviceNotification: NewDeviceNotification;
}

export interface IssuedSession {
  token: string;
  session: SessionRow;
  device: DeviceRow;
  isNewDevice: boolean;
  alertToken?: string;
  notificationDeliveryId?: string;
}

export async function issueSessionForDevice(
  executor: RepositoryExecutor,
  input: IssueSessionForDeviceInput,
  dependencies: SessionRepositoryDependencies,
): Promise<IssuedSession> {
  const now = dependencies.clock();
  const deviceDigest = digest(input.deviceFingerprint);
  const [createdDevice] = await executor
    .insert(devices)
    .values({
      id: dependencies.generateId(),
      userId: input.userId,
      deviceDigest,
      label: input.device.label,
      browser: input.device.browser,
      operatingSystem: input.device.operatingSystem,
      firstSeenAt: now,
      lastSeenAt: now,
      ...(input.device.approximateLocation === undefined
        ? {}
        : { approximateLocation: input.device.approximateLocation }),
      ...(input.device.summarizedUserAgent === undefined
        ? {}
        : { summarizedUserAgent: input.device.summarizedUserAgent }),
    })
    .onConflictDoNothing({ target: [devices.userId, devices.deviceDigest] })
    .returning();

  const [existingDevice] = createdDevice
    ? [createdDevice]
    : await executor
        .select()
        .from(devices)
        .where(and(eq(devices.userId, input.userId), eq(devices.deviceDigest, deviceDigest)))
        .limit(1);
  if (!existingDevice) {
    throw new Error("device could not be created or resolved");
  }

  if (!createdDevice) {
    await executor
      .update(devices)
      .set({
        label: input.device.label,
        browser: input.device.browser,
        operatingSystem: input.device.operatingSystem,
        lastSeenAt: now,
        ...(input.device.approximateLocation === undefined
          ? {}
          : { approximateLocation: input.device.approximateLocation }),
        ...(input.device.summarizedUserAgent === undefined
          ? {}
          : { summarizedUserAgent: input.device.summarizedUserAgent }),
      })
      .where(and(eq(devices.userId, input.userId), eq(devices.id, existingDevice.id)));
  }

  const token = encodeOpaqueToken(dependencies.randomBytes(32));
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TTL_MS);
  const [session] = await executor
    .insert(sessions)
    .values({
      id: dependencies.generateId(),
      userId: input.userId,
      deviceId: existingDevice.id,
      tokenDigest: digest(token),
      issuedAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + IDLE_TTL_MS),
      absoluteExpiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!session) {
    throw new Error("session was not persisted");
  }

  if (!createdDevice) {
    return { token, session, device: existingDevice, isNewDevice: false };
  }

  const alertToken = encodeOpaqueToken(dependencies.randomBytes(32));
  await createAlertContext(executor, {
    id: dependencies.generateId(),
    userId: input.userId,
    sessionId: session.id,
    token: alertToken,
    expiresAt: new Date(now.getTime() + ALERT_TTL_MS),
    createdAt: now,
  });

  const notificationDeliveryId = dependencies.generateId();
  await createEncryptedNotificationDelivery(executor, {
    id: notificationDeliveryId,
    template: input.newDeviceNotification.template,
    recipient: input.newDeviceNotification.recipient,
    idempotencyKey: input.newDeviceNotification.idempotencyKey,
    encryptionKey: input.newDeviceNotification.encryptionKey,
    payload: {
      recipient: input.newDeviceNotification.recipient,
      alertToken,
      sessionId: session.id,
      device: {
        label: input.device.label,
        browser: input.device.browser,
        operatingSystem: input.device.operatingSystem,
        approximateLocation: input.device.approximateLocation ?? null,
        summarizedUserAgent: input.device.summarizedUserAgent ?? null,
      },
    },
    payloadExpiresAt: new Date(now.getTime() + ALERT_TTL_MS),
    availableAt: now,
    occurredAt: now,
    outboxEventId: dependencies.generateId(),
  });

  return {
    token,
    session,
    device: existingDevice,
    isNewDevice: true,
    alertToken,
    notificationDeliveryId,
  };
}

export async function issueIdentitySession(
  executor: RepositoryExecutor,
  input: {
    id: string;
    userId: string;
    token: string;
    issuedAt: Date;
    absoluteExpiresAt: Date;
    deviceId: string;
  },
): Promise<{ sessionId: string }> {
  const deviceDigest = digest(`identity:${input.userId}`);
  await executor
    .insert(devices)
    .values({
      id: input.deviceId,
      userId: input.userId,
      deviceDigest,
      label: "Discord OAuth",
      browser: "Unknown",
      operatingSystem: "Unknown",
      firstSeenAt: input.issuedAt,
      lastSeenAt: input.issuedAt,
    })
    .onConflictDoNothing({ target: [devices.userId, devices.deviceDigest] });
  const [device] = await executor
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, input.userId), eq(devices.deviceDigest, deviceDigest)))
    .limit(1);
  if (!device) throw new Error("identity device unavailable");
  const idleExpiresAt = new Date(
    Math.min(input.issuedAt.getTime() + IDLE_TTL_MS, input.absoluteExpiresAt.getTime()),
  );
  const [session] = await executor
    .insert(sessions)
    .values({
      id: input.id,
      userId: input.userId,
      deviceId: device.id,
      tokenDigest: digest(input.token),
      issuedAt: input.issuedAt,
      lastSeenAt: input.issuedAt,
      idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      createdAt: input.issuedAt,
      updatedAt: input.issuedAt,
    })
    .returning({ id: sessions.id });
  if (!session) throw new Error("session was not persisted");
  return { sessionId: session.id };
}

export async function rotateIdentitySession(
  executor: RepositoryExecutor,
  input: { userId: string; sessionId: string; token: string; reauthenticatedAt: Date },
): Promise<{ sessionId: string } | null> {
  const idleCandidate = new Date(input.reauthenticatedAt.getTime() + IDLE_TTL_MS);
  const [session] = await executor
    .update(sessions)
    .set({
      tokenDigest: digest(input.token),
      lastSeenAt: input.reauthenticatedAt,
      idleExpiresAt: sql`least(${sessions.absoluteExpiresAt}, ${idleCandidate.toISOString()}::timestamptz)`,
      reauthenticatedAt: input.reauthenticatedAt,
      updatedAt: input.reauthenticatedAt,
    })
    .where(
      and(
        eq(sessions.userId, input.userId),
        eq(sessions.id, input.sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, input.reauthenticatedAt),
        gt(sessions.absoluteExpiresAt, input.reauthenticatedAt),
      ),
    )
    .returning({ id: sessions.id });
  return session ? { sessionId: session.id } : null;
}

export async function findSessionForStepUp(
  executor: RepositoryExecutor,
  userId: string,
  sessionId: string,
) {
  const [resolved] = await executor
    .select({ session: sessions, device: devices })
    .from(sessions)
    .innerJoin(devices, and(eq(devices.userId, sessions.userId), eq(devices.id, sessions.deviceId)))
    .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
    .limit(1);
  return resolved ?? null;
}

export async function markSessionStepUp(
  executor: RepositoryExecutor,
  input: { userId: string; sessionId: string; confirmedAt: Date },
): Promise<boolean> {
  const [session] = await executor
    .update(sessions)
    .set({ reauthenticatedAt: input.confirmedAt, updatedAt: input.confirmedAt })
    .where(
      and(
        eq(sessions.userId, input.userId),
        eq(sessions.id, input.sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, input.confirmedAt),
        gt(sessions.absoluteExpiresAt, input.confirmedAt),
      ),
    )
    .returning({ id: sessions.id });
  return Boolean(session);
}

export async function resolveAlertContextByDigest(
  executor: RepositoryExecutor,
  input: { actorId: string; contextDigest: string; now: Date },
): Promise<
  | { status: "active"; sessionId: string }
  | { status: "already-revoked"; sessionId: string }
  | { status: "expired" }
  | { status: "not-found" }
> {
  const [resolved] = await executor
    .select({
      sessionId: sessionAlertContexts.sessionId,
      contextExpiresAt: sessionAlertContexts.expiresAt,
      sessionRevokedAt: sessions.revokedAt,
      idleExpiresAt: sessions.idleExpiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
    })
    .from(sessionAlertContexts)
    .innerJoin(
      sessions,
      and(
        eq(sessions.userId, sessionAlertContexts.userId),
        eq(sessions.id, sessionAlertContexts.sessionId),
      ),
    )
    .where(
      and(
        eq(sessionAlertContexts.userId, input.actorId),
        eq(sessionAlertContexts.tokenDigest, input.contextDigest),
      ),
    )
    .limit(1);
  if (!resolved) return { status: "not-found" };
  if (resolved.contextExpiresAt <= input.now) return { status: "expired" };
  if (resolved.sessionRevokedAt) {
    return { status: "already-revoked", sessionId: resolved.sessionId };
  }
  if (resolved.idleExpiresAt <= input.now || resolved.absoluteExpiresAt <= input.now) {
    return { status: "expired" };
  }
  return { status: "active", sessionId: resolved.sessionId };
}

export async function resolveSession(executor: RepositoryExecutor, token: string, clock: Clock) {
  const now = clock();
  const [resolved] = await executor
    .select({ session: sessions, device: devices })
    .from(sessions)
    .innerJoin(devices, and(eq(devices.userId, sessions.userId), eq(devices.id, sessions.deviceId)))
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenDigest, digest(token)),
        eq(users.status, "active"),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
      ),
    )
    .limit(1);

  return resolved ?? null;
}

export async function touchSession(
  executor: RepositoryExecutor,
  token: string,
  clock: Clock,
): Promise<SessionRow | null> {
  const now = clock();
  const coalescingCutoff = new Date(now.getTime() - TOUCH_COALESCE_MS);
  const idleCandidate = new Date(now.getTime() + IDLE_TTL_MS);
  const [touched] = await executor
    .update(sessions)
    .set({
      lastSeenAt: now,
      idleExpiresAt: sql`least(${sessions.absoluteExpiresAt}, ${idleCandidate.toISOString()}::timestamptz)`,
      updatedAt: now,
    })
    .where(
      and(
        eq(sessions.tokenDigest, digest(token)),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
        lte(sessions.lastSeenAt, coalescingCutoff),
      ),
    )
    .returning();

  if (touched) {
    return touched;
  }

  const resolved = await resolveSession(executor, token, clock);
  return resolved?.session ?? null;
}

export async function rotateSession(
  executor: RepositoryExecutor,
  input: { userId: string; sessionId: string },
  dependencies: SessionRepositoryDependencies,
): Promise<{ token: string; session: SessionRow } | null> {
  const now = dependencies.clock();
  const token = encodeOpaqueToken(dependencies.randomBytes(32));
  const idleCandidate = new Date(now.getTime() + IDLE_TTL_MS);
  const [rotated] = await executor
    .update(sessions)
    .set({
      tokenDigest: digest(token),
      lastSeenAt: now,
      idleExpiresAt: sql`least(${sessions.absoluteExpiresAt}, ${idleCandidate.toISOString()}::timestamptz)`,
      reauthenticatedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(sessions.userId, input.userId),
        eq(sessions.id, input.sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
      ),
    )
    .returning();

  return rotated ? { token, session: rotated } : null;
}

export async function revokeSession(
  executor: RepositoryExecutor,
  userId: string,
  sessionId: string,
  reason: string,
  clock: Clock,
): Promise<boolean> {
  const now = clock();
  const [revoked] = await executor
    .update(sessions)
    .set({ revokedAt: now, revocationReason: reason, updatedAt: now })
    .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return Boolean(revoked);
}

export async function revokeOtherSessions(
  executor: RepositoryExecutor,
  userId: string,
  preservedSessionId: string,
  reason: string,
  clock: Clock,
): Promise<number> {
  const now = clock();
  const revoked = await executor
    .update(sessions)
    .set({ revokedAt: now, revocationReason: reason, updatedAt: now })
    .where(
      and(
        eq(sessions.userId, userId),
        ne(sessions.id, preservedSessionId),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });
  return revoked.length;
}

export async function hasRecentReauthentication(
  executor: RepositoryExecutor,
  userId: string,
  sessionId: string,
  now: Date,
  lifetimeMs = 10 * 60_000,
): Promise<boolean> {
  const threshold = new Date(now.getTime() - lifetimeMs);
  const [session] = await executor
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.id, sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
        gt(sessions.reauthenticatedAt, threshold),
      ),
    )
    .limit(1);
  return Boolean(session);
}

export async function listSessionsForUser(executor: RepositoryExecutor, userId: string) {
  return executor
    .select({ session: sessions, device: devices })
    .from(sessions)
    .innerJoin(devices, and(eq(devices.userId, sessions.userId), eq(devices.id, sessions.deviceId)))
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastSeenAt));
}

export interface CreateAlertContextInput {
  id: string;
  userId: string;
  sessionId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function createAlertContext(
  executor: RepositoryExecutor,
  input: CreateAlertContextInput,
): Promise<void> {
  await executor.insert(sessionAlertContexts).values({
    id: input.id,
    userId: input.userId,
    sessionId: input.sessionId,
    tokenDigest: digest(input.token),
    expiresAt: input.expiresAt,
    createdAt: input.createdAt,
  });
}

export type ResolveAlertContextResult =
  | { status: "active"; sessionId: string }
  | { status: "already-revoked"; sessionId: string }
  | { status: "not-found-expired" };

export async function resolveAlertContextReadOnly(
  executor: RepositoryExecutor,
  userId: string,
  token: string,
  clock: Clock,
): Promise<ResolveAlertContextResult> {
  const now = clock();
  const [resolved] = await executor
    .select({
      sessionId: sessionAlertContexts.sessionId,
      sessionRevokedAt: sessions.revokedAt,
      idleExpiresAt: sessions.idleExpiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
    })
    .from(sessionAlertContexts)
    .innerJoin(
      sessions,
      and(
        eq(sessions.userId, sessionAlertContexts.userId),
        eq(sessions.id, sessionAlertContexts.sessionId),
      ),
    )
    .where(
      and(
        eq(sessionAlertContexts.userId, userId),
        eq(sessionAlertContexts.tokenDigest, digest(token)),
        gt(sessionAlertContexts.expiresAt, now),
      ),
    )
    .limit(1);

  if (!resolved) {
    return { status: "not-found-expired" };
  }
  if (resolved.sessionRevokedAt) {
    return { status: "already-revoked", sessionId: resolved.sessionId };
  }
  if (resolved.idleExpiresAt <= now || resolved.absoluteExpiresAt <= now) {
    return { status: "not-found-expired" };
  }
  return { status: "active", sessionId: resolved.sessionId };
}

export const sessionDurations = {
  idleMs: IDLE_TTL_MS,
  absoluteMs: ABSOLUTE_TTL_MS,
  alertMs: ALERT_TTL_MS,
  touchCoalescingMs: TOUCH_COALESCE_MS,
};
