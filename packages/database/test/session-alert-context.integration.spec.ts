import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  issueSessionForDevice,
  resolveAlertContextReadOnly,
  resolveSession,
  revokeOtherSessions,
  revokeSession,
  rotateSession,
  touchSession,
} from "../src/repositories/sessions.js";
import * as schema from "../src/schema.js";
import {
  notificationDeliveries,
  outboxEvents,
  sessionAlertContexts,
  sessions,
} from "../src/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for session repository integration tests");
}

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
    for (const statement of isolated
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await client.unsafe(statement);
    }
  }
}

function deterministicDependencies(now: Date) {
  let randomCounter = 0;
  return {
    clock: () => now,
    generateId: () => randomUUID(),
    randomBytes: (size: number) => Buffer.alloc(size, ++randomCounter),
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

describe("session repositories", () => {
  let client: Sql;
  let db: PostgresJsDatabase<typeof schema>;
  let schemaName: string;
  let userId: string;

  beforeAll(async () => {
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
    const issued = await db.transaction((tx) =>
      issueSessionForDevice(
        tx,
        {
          userId,
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
      ),
    );

    expect(Buffer.from(issued.token, "base64url")).toHaveLength(32);
    const [stored] = await db.select().from(sessions).where(eq(sessions.id, issued.session.id));
    expect(stored?.tokenDigest).not.toBe(issued.token);
    expect(JSON.stringify(stored)).not.toContain(issued.token);

    await expect(resolveSession(db, issued.token, () => now)).resolves.toMatchObject({
      session: { id: issued.session.id, userId },
    });

    const rotated = await rotateSession(
      db,
      { userId, sessionId: issued.session.id },
      deterministicDependencies(new Date(now.getTime() + 60_000)),
    );
    expect(rotated).not.toBeNull();
    await expect(resolveSession(db, issued.token, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, rotated!.token, () => now)).resolves.toMatchObject({
      session: { id: issued.session.id },
    });
  });

  it("coalesces activity writes and never crosses the 90-day absolute expiry", async () => {
    const issuedAt = new Date("2026-08-21T09:00:00.000Z");
    const issued = await issueSessionForDevice(
      db,
      {
        userId,
        deviceFingerprint: "desktop-browser-profile-2",
        device: { label: "Notebook", browser: "Firefox", operatingSystem: "Linux" },
        newDeviceNotification: notificationInput("new-device-notebook"),
      },
      deterministicDependencies(issuedAt),
    );

    const beforeWindow = await touchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 4 * 60_000),
    );
    expect(beforeWindow?.lastSeenAt).toEqual(issuedAt);

    let touched = await touchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 29 * 24 * 60 * 60_000),
    );
    touched = await touchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 58 * 24 * 60 * 60_000),
    );
    touched = await touchSession(
      db,
      issued.token,
      () => new Date(issuedAt.getTime() + 87 * 24 * 60 * 60_000),
    );
    expect(touched?.idleExpiresAt).toEqual(issued.session.absoluteExpiresAt);
  });

  it("revokes one session or every other session with next-lookup effect", async () => {
    const now = new Date("2026-08-21T10:00:00.000Z");
    const first = await issueSessionForDevice(
      db,
      {
        userId,
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
    await expect(resolveSession(db, rotated!.token, () => now)).resolves.not.toBeNull();
  });

  it("resolves alert context by digest and user without mutating or authorizing", async () => {
    const now = new Date("2026-08-21T11:00:00.000Z");
    const issued = await db.transaction((tx) =>
      issueSessionForDevice(
        tx,
        {
          userId,
          deviceFingerprint: "alert-context-device",
          device: { label: "Unknown PC", browser: "Edge", operatingSystem: "Windows" },
          newDeviceNotification: notificationInput("alert-context-device"),
        },
        deterministicDependencies(now),
      ),
    );
    expect(issued.alertToken).toBeDefined();

    await expect(
      resolveAlertContextReadOnly(db, randomUUID(), issued.alertToken!, () => now),
    ).resolves.toEqual({ status: "not-found-expired" });
    await expect(
      resolveAlertContextReadOnly(db, userId, issued.alertToken!, () => now),
    ).resolves.toEqual({ status: "active", sessionId: issued.session.id });

    const [contextBefore] = await db
      .select()
      .from(sessionAlertContexts)
      .where(eq(sessionAlertContexts.sessionId, issued.session.id));
    expect(contextBefore?.resolvedAt).toBeNull();

    await revokeSession(db, userId, issued.session.id, "alert-confirmed", () => now);
    await expect(
      resolveAlertContextReadOnly(db, userId, issued.alertToken!, () => now),
    ).resolves.toEqual({ status: "already-revoked", sessionId: issued.session.id });
    const [contextAfter] = await db
      .select()
      .from(sessionAlertContexts)
      .where(eq(sessionAlertContexts.sessionId, issued.session.id));
    expect(contextAfter?.resolvedAt).toBeNull();

    const [outbox] = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, issued.notificationDeliveryId!));
    expect(outbox?.payload).toEqual({ deliveryId: issued.notificationDeliveryId });
    expect(JSON.stringify(outbox)).not.toContain(issued.alertToken);
  });

  it("rolls device, session, alert, delivery and outbox back together", async () => {
    const rollbackUserId = randomUUID();
    await client`
      insert into users (id, display_name) values (${rollbackUserId}, 'Rollback organizer')
    `;
    await expect(
      db.transaction(async (tx) => {
        await issueSessionForDevice(
          tx,
          {
            userId: rollbackUserId,
            deviceFingerprint: "rollback-device",
            device: { label: "Rollback PC", browser: "Chrome", operatingSystem: "Windows" },
            newDeviceNotification: notificationInput("rollback-new-device"),
          },
          deterministicDependencies(new Date("2026-08-21T12:00:00.000Z")),
        );
        throw new Error("force session rollback");
      }),
    ).rejects.toThrow("force session rollback");

    const [counts] = await client`
      select
        (select count(*)::int from devices where user_id = ${rollbackUserId}) as devices,
        (select count(*)::int from sessions where user_id = ${rollbackUserId}) as sessions,
        (select count(*)::int from session_alert_contexts where user_id = ${rollbackUserId}) as alerts,
        (select count(*)::int from notification_deliveries where idempotency_key = 'rollback-new-device') as deliveries
    `;
    expect(counts).toMatchObject({ devices: 0, sessions: 0, alerts: 0, deliveries: 0 });
  });
});
