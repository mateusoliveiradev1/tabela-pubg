import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  issueIdentitySession,
  issueSessionForDevice,
  resolveAlertContextReadOnly,
  resolveAndTouchSession,
  resolveSession,
  revokeOtherSessions,
  revokeSession,
  rotateSession,
} from "../src/repositories/sessions.js";
import * as schema from "../src/schema.js";
import { outboxEvents, sessionAlertContexts, sessions } from "../src/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function applyMigrations(client: Sql, schemaName: string): Promise<void> {
  const quotedSchema = quoteIdentifier(schemaName);
  await client.unsafe(`create schema ${quotedSchema}`);
  await client.unsafe(`set search_path to ${quotedSchema}`);

  const migrations = (await readdir(migrationsFolder))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .toSorted();
  for (const migration of migrations) {
    const source = await readFile(path.join(migrationsFolder, migration), "utf8");
    const isolated = source.replaceAll('"public".', `${quotedSchema}.`);
    const batch = isolated.replaceAll("--> statement-breakpoint", "\n").trim();
    if (batch) await client.unsafe(batch);
  }
}

let dependencySeed = 0;

function deterministicDependencies(now: Date) {
  const seed = ++dependencySeed;
  let randomCounter = 0;
  return {
    clock: () => now,
    generateId: () => randomUUID(),
    randomBytes: (size: number) => Buffer.alloc(size, seed + randomCounter++),
  };
}

function notificationInput(idempotencyKey: string) {
  return {
    recipient: "organizer@example.test",
    template: "identity.new-device",
    idempotencyKey,
    encryptionKey: { version: "v1", key: Buffer.alloc(32, 31) },
  };
}

describe.runIf(Boolean(databaseUrl))("session repositories", () => {
  let client: Sql;
  let db: PostgresJsDatabase<typeof schema>;
  let schemaName: string;
  let userId: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for session repository integration tests");
    }
    schemaName = `phase2_sessions_${process.pid}_${randomBytes(6).toString("hex")}`;
    client = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      prepare: false,
      onnotice: () => undefined,
    });
    await applyMigrations(client, schemaName);
    db = drizzle(client, { schema });
    userId = randomUUID();
    await client`insert into users (id, display_name) values (${userId}, 'Session organizer')`;
  }, 30_000);

  afterAll(async () => {
    if (client) {
      await client.unsafe("set search_path to public");
      await client.unsafe(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
      await client.end({ timeout: 5 });
    }
  }, 30_000);

  it("stores only a digest and invalidates the old token during rotation", async () => {
    const now = new Date("2026-08-21T08:00:00.000Z");
    const issued = await issueSessionForDevice(
      db,
      {
          userId,
          trust: "trusted",
          deviceFingerprint: "desktop-browser-profile-1",
          device: {
            label: "PC principal",
            browser: "Chrome",
            operatingSystem: "Windows",
            approximateLocation: "Sao Paulo, BR",
            summarizedUserAgent: "Chrome on Windows",
          },
          newDeviceNotification: notificationInput("new-device-primary"),
      },
      deterministicDependencies(now),
    );

    expect(Buffer.from(issued.token, "base64url")).toHaveLength(32);
    const [stored] = await db.select().from(sessions).where(eq(sessions.id, issued.session.id));
    expect(stored?.tokenDigest).toBe(
      createHash("sha256").update(issued.token, "utf8").digest("hex"),
    );
    expect(JSON.stringify(stored)).not.toContain(issued.token);

    await expect(resolveSession(db, issued.token, () => now)).resolves.toMatchObject({
      session: { id: issued.session.id, userId },
    });
    await expect(
      resolveAndTouchSession(
        db,
        Buffer.alloc(32, 99).toString("base64url"),
        () => new Date(now.getTime() + 6 * 60_000),
      ),
    ).resolves.toBeNull();

    const rotated = await rotateSession(
      db,
      { userId, sessionId: issued.session.id },
      deterministicDependencies(new Date(now.getTime() + 60_000)),
    );
    expect(rotated).not.toBeNull();
    if (!rotated) {
      throw new Error("session rotation did not return a replacement token");
    }
    await expect(resolveSession(db, issued.token, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, rotated.token, () => now)).resolves.toMatchObject({
      session: { id: issued.session.id },
    });
  });

  it("coalesces activity writes and never crosses the 90-day absolute expiry", async () => {
    const issuedAt = new Date("2026-08-21T09:00:00.000Z");
    const issued = await issueSessionForDevice(
      db,
      {
        userId,
        trust: "trusted",
        deviceFingerprint: "desktop-browser-profile-2",
        device: { label: "Notebook", browser: "Firefox", operatingSystem: "Linux" },
        newDeviceNotification: notificationInput("new-device-notebook"),
      },
      deterministicDependencies(issuedAt),
    );

    const beforeWindow = await resolveAndTouchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 4 * 60_000),
    );
    expect(beforeWindow).toMatchObject({
      session: { lastSeenAt: issuedAt },
      trust: "trusted",
    });

    let touched = await resolveAndTouchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 29 * 24 * 60 * 60_000),
    );
    touched = await resolveAndTouchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 58 * 24 * 60 * 60_000),
    );
    touched = await resolveAndTouchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 87 * 24 * 60 * 60_000),
    );
    expect(touched?.session.idleExpiresAt).toEqual(issued.session.absoluteExpiresAt);
    expect(touched?.session.absoluteExpiresAt).toEqual(issued.session.absoluteExpiresAt);
  });

  it("persists and touches sessions with injected non-default security policy", async () => {
    const issuedAt = new Date("2026-08-21T09:20:00.000Z");
    const policy = {
      idleMs: 7 * 60_000,
      absoluteMs: 20 * 60_000,
      activityWriteIntervalMs: 45_000,
    };
    const issued = await issueSessionForDevice(
      db,
      {
        userId,
        trust: "trusted",
        deviceFingerprint: "configured-policy-device",
        device: { label: "Policy", browser: "Firefox", operatingSystem: "Linux" },
        newDeviceNotification: notificationInput("configured-policy-device"),
      },
      { ...deterministicDependencies(issuedAt), policy },
    );
    expect(issued.session.idleExpiresAt).toEqual(new Date(issuedAt.getTime() + policy.idleMs));
    expect(issued.session.absoluteExpiresAt).toEqual(
      new Date(issuedAt.getTime() + policy.absoluteMs),
    );

    const coalesced = await resolveAndTouchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 44_000),
      policy,
    );
    expect(coalesced?.session.lastSeenAt).toEqual(issuedAt);
    const touchedAt = new Date(issuedAt.getTime() + 46_000);
    expect(touchedAt.getTime()).toBeLessThan(issued.session.idleExpiresAt.getTime());
    const touched = await resolveAndTouchSession(db, issued.token, () => touchedAt, policy);
    expect(touched).not.toBeNull();
    expect(touched?.session.lastSeenAt).toEqual(touchedAt);
    expect(touched?.session.idleExpiresAt).toEqual(
      new Date(touchedAt.getTime() + policy.idleMs),
    );
  });

  it("persists explicit trust for identity and device issue paths", async () => {
    const issuedAt = new Date("2026-08-21T09:30:00.000Z");
    const provisionalToken = Buffer.alloc(32, 71).toString("base64url");
    const identitySessionId = randomUUID();
    await issueIdentitySession(db, {
      id: identitySessionId,
      userId,
      token: provisionalToken,
      trust: "provisional",
      issuedAt,
      absoluteExpiresAt: new Date(issuedAt.getTime() + 15 * 60_000),
      deviceId: randomUUID(),
    });
    const identityResolved = await resolveAndTouchSession(db, provisionalToken, () => issuedAt);
    expect(identityResolved).toMatchObject({
      session: { id: identitySessionId, trust: "provisional" },
      trust: "provisional",
    });

    const deviceIssued = await issueSessionForDevice(
      db,
      {
        userId,
        trust: "provisional",
        deviceFingerprint: "provisional-device",
        device: { label: "Temporary", browser: "Firefox", operatingSystem: "Linux" },
        newDeviceNotification: notificationInput("provisional-device"),
      },
      deterministicDependencies(issuedAt),
    );
    expect(deviceIssued.session.trust).toBe("provisional");
    expect(deviceIssued.session.idleExpiresAt).toEqual(new Date(issuedAt.getTime() + 15 * 60_000));
    expect(deviceIssued.session.absoluteExpiresAt).toEqual(
      new Date(issuedAt.getTime() + 15 * 60_000),
    );
    await expect(
      resolveAndTouchSession(db, deviceIssued.token, () => issuedAt),
    ).resolves.toMatchObject({ trust: "provisional" });
  });

  it("leaves revoked, expired and suspended sessions unresolved and untouched", async () => {
    const requestAt = new Date("2026-08-21T10:30:00.000Z");
    const cases = [
      { name: "revoked", issuedAt: new Date("2026-08-21T10:00:00.000Z") },
      { name: "idle-expired", issuedAt: new Date("2026-07-21T10:00:00.000Z") },
      { name: "absolute-expired", issuedAt: new Date("2026-05-22T10:00:00.000Z") },
    ] as const;
    const issuedCases = [];
    for (const current of cases) {
      const issued = await issueSessionForDevice(
        db,
        {
          userId,
          trust: "trusted",
          deviceFingerprint: `inactive-${current.name}`,
          device: { label: current.name, browser: "Chrome", operatingSystem: "Windows" },
          newDeviceNotification: notificationInput(`inactive-${current.name}`),
        },
        deterministicDependencies(current.issuedAt),
      );
      issuedCases.push({ ...current, issued });
    }
    const revokedCase = issuedCases[0];
    if (!revokedCase) throw new Error("revoked lifecycle fixture was not issued");
    await revokeSession(db, userId, revokedCase.issued.session.id, "test", () => requestAt);

    const suspendedUserId = randomUUID();
    await client`
      insert into users (id, display_name, status)
      values (${suspendedUserId}, 'Suspended organizer', 'active')
    `;
    const suspended = await issueSessionForDevice(
      db,
      {
        userId: suspendedUserId,
        trust: "trusted",
        deviceFingerprint: "suspended-device",
        device: { label: "Suspended", browser: "Chrome", operatingSystem: "Windows" },
        newDeviceNotification: notificationInput("suspended-device"),
      },
      deterministicDependencies(new Date("2026-08-21T10:00:00.000Z")),
    );
    await client`update users set status = 'suspended' where id = ${suspendedUserId}`;

    for (const candidate of [...issuedCases, { name: "suspended", issued: suspended }]) {
      await expect(
        resolveAndTouchSession(db, candidate.issued.token, () => requestAt),
      ).resolves.toBeNull();
      const [stored] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, candidate.issued.session.id));
      expect(stored?.lastSeenAt).toEqual(candidate.issued.session.lastSeenAt);
      expect(stored?.idleExpiresAt).toEqual(candidate.issued.session.idleExpiresAt);
    }
  });

  it("revokes one session or every other session with next-lookup effect", async () => {
    const now = new Date("2026-08-21T10:00:00.000Z");
    const first = await issueSessionForDevice(
      db,
      {
        userId,
        trust: "trusted",
        deviceFingerprint: "revocation-device-1",
        device: { label: "Desktop", browser: "Chrome", operatingSystem: "Windows" },
        newDeviceNotification: notificationInput("revoke-device-1"),
      },
      deterministicDependencies(now),
    );
    const second = await issueSessionForDevice(
      db,
      {
        userId,
        trust: "trusted",
        deviceFingerprint: "revocation-device-2",
        device: { label: "Phone", browser: "Safari", operatingSystem: "iOS" },
        newDeviceNotification: notificationInput("revoke-device-2"),
      },
      deterministicDependencies(now),
    );

    await revokeSession(db, userId, first.session.id, "user-request", () => now);
    await expect(resolveSession(db, first.token, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, second.token, () => now)).resolves.not.toBeNull();

    const rotated = await rotateSession(
      db,
      { userId, sessionId: second.session.id },
      deterministicDependencies(new Date(now.getTime() + 60_000)),
    );
    await revokeOtherSessions(
      db,
      userId,
      second.session.id,
      "sensitive-operation",
      () => new Date(now.getTime() + 60_000),
    );
    if (!rotated) {
      throw new Error("reauthenticated session was not rotated");
    }
    await expect(resolveSession(db, rotated.token, () => now)).resolves.not.toBeNull();
  });

  it("resolves alert context by digest and user without mutating or authorizing", async () => {
    const now = new Date("2026-08-21T11:00:00.000Z");
    const issued = await issueSessionForDevice(
      db,
      {
          userId,
          trust: "trusted",
          deviceFingerprint: "alert-context-device",
          device: { label: "Unknown PC", browser: "Edge", operatingSystem: "Windows" },
          newDeviceNotification: notificationInput("alert-context-device"),
      },
      deterministicDependencies(now),
    );
    expect(issued.alertToken).toBeDefined();
    if (!issued.alertToken || !issued.notificationDeliveryId) {
      throw new Error("new device did not create its alert context and delivery");
    }

    await expect(
      resolveAlertContextReadOnly(db, randomUUID(), issued.alertToken, () => now),
    ).resolves.toEqual({ status: "not-found-expired" });
    await expect(
      resolveAlertContextReadOnly(db, userId, issued.alertToken, () => now),
    ).resolves.toEqual({ status: "active", sessionId: issued.session.id });

    const [contextBefore] = await db
      .select()
      .from(sessionAlertContexts)
      .where(eq(sessionAlertContexts.sessionId, issued.session.id));
    expect(contextBefore?.resolvedAt).toBeNull();

    await revokeSession(db, userId, issued.session.id, "alert-confirmed", () => now);
    await expect(
      resolveAlertContextReadOnly(db, userId, issued.alertToken, () => now),
    ).resolves.toEqual({ status: "already-revoked", sessionId: issued.session.id });
    const [contextAfter] = await db
      .select()
      .from(sessionAlertContexts)
      .where(eq(sessionAlertContexts.sessionId, issued.session.id));
    expect(contextAfter?.resolvedAt).toBeNull();

    const [outbox] = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, issued.notificationDeliveryId));
    expect(outbox?.payload).toEqual({ deliveryId: issued.notificationDeliveryId });
    expect(JSON.stringify(outbox)).not.toContain(issued.alertToken);
  });

  it.each([
      "device",
      "session",
      "alert-context",
      "delivery",
      "outbox",
    ] as const)(
    "rolls back the %s new-device mutation boundary and retries with exactly one alert",
    async (failureStage) => {
      const rollbackUserId = randomUUID();
      await client`
        insert into users (id, display_name) values (${rollbackUserId}, 'Rollback organizer')
      `;
      const deviceFingerprint = `rollback-device-${failureStage}`;
      const idempotencyKey = `rollback-new-device-${failureStage}`;
      await expect(
        issueSessionForDevice(
          db,
          {
            userId: rollbackUserId,
            trust: "trusted",
            deviceFingerprint,
            device: { label: "Rollback PC", browser: "Chrome", operatingSystem: "Windows" },
            newDeviceNotification: notificationInput(idempotencyKey),
          },
          {
            ...deterministicDependencies(new Date("2026-08-21T12:00:00.000Z")),
            afterMutation: (stage) => {
              if (stage === failureStage) throw new Error(`fail after ${stage}`);
            },
          },
        ),
      ).rejects.toThrow(`fail after ${failureStage}`);

      const [counts] = await client`
        select
          (select count(*)::int from devices where user_id = ${rollbackUserId}) as devices,
          (select count(*)::int from sessions where user_id = ${rollbackUserId}) as sessions,
          (select count(*)::int from session_alert_contexts where user_id = ${rollbackUserId}) as alerts,
          (select count(*)::int from notification_deliveries where idempotency_key = ${idempotencyKey}) as deliveries,
          (select count(*)::int from outbox_events where aggregate_id in (
            select id::text from notification_deliveries where idempotency_key = ${idempotencyKey}
          )) as outbox
      `;
      expect(counts).toMatchObject({ devices: 0, sessions: 0, alerts: 0, deliveries: 0, outbox: 0 });

      const retry = await issueSessionForDevice(
        db,
        {
          userId: rollbackUserId,
          trust: "trusted",
          deviceFingerprint,
          device: { label: "Rollback PC", browser: "Chrome", operatingSystem: "Windows" },
          newDeviceNotification: notificationInput(idempotencyKey),
        },
        deterministicDependencies(new Date("2026-08-21T12:01:00.000Z")),
      );
      expect(retry).toMatchObject({ isNewDevice: true });
      expect(retry.notificationDeliveryId).toBeDefined();
    },
  );
});
