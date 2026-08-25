import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateLogo,
  createOrganization,
  createPendingLogo,
  getActiveLogo,
  StorageCleanupRepository,
} from "../src/repositories/organizations.js";
import type * as schemaType from "../src/schema.js";
import * as schema from "../src/schema.js";

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

function logoKey(organizationId: string): string {
  return `branding/${organizationId}/${randomUUID()}`;
}

function logoInput(organizationId: string, createdByMembershipId: string) {
  const objectKey = logoKey(organizationId);
  return {
    id: randomUUID(),
    objectKey,
    detectedMime: "image/png" as const,
    byteSize: 128,
    sha256: createHash("sha256").update(objectKey).digest("hex"),
    createdByMembershipId,
    createdAt: new Date("2026-08-21T05:00:00.000Z"),
  };
}

async function connectToSchema(databaseUrlValue: string, schemaName: string): Promise<Sql> {
  const connection = postgres(databaseUrlValue, {
    max: 1,
    connect_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  });
  await connection.unsafe(`set search_path to ${quoteIdentifier(schemaName)}`);
  return connection;
}

describe.runIf(Boolean(databaseUrl))("organization logo repositories", () => {
  let client: Sql;
  let db: PostgresJsDatabase<typeof schemaType>;
  let schemaName: string;
  let organizationA: string;
  let organizationB: string;
  let ownerMembershipA: string;
  let ownerMembershipB: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for logo repository integration");
    schemaName = `phase2_logo_${process.pid}_${randomBytes(6).toString("hex")}`;
    client = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      prepare: false,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    });
    await applyMigrations(client, schemaName);
    db = drizzle(client, { schema });

    const userA = randomUUID();
    const userB = randomUUID();
    organizationA = randomUUID();
    organizationB = randomUUID();
    ownerMembershipA = randomUUID();
    ownerMembershipB = randomUUID();
    await client`
      insert into users (id, display_name) values
      (${userA}, 'Logo owner A'), (${userB}, 'Logo owner B')
    `;
    for (const input of [
      {
        id: organizationA,
        ownerUserId: userA,
        ownerMembershipId: ownerMembershipA,
        slug: `logo-a-${randomUUID()}`,
      },
      {
        id: organizationB,
        ownerUserId: userB,
        ownerMembershipId: ownerMembershipB,
        slug: `logo-b-${randomUUID()}`,
      },
    ]) {
      await db.transaction((tx) =>
        createOrganization(tx, {
          ...input,
          name: input.slug,
          auditEventId: randomUUID(),
          outboxEventId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: new Date("2026-08-21T04:00:00.000Z"),
        }),
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (client) {
      await client.unsafe("set search_path to public");
      await client.unsafe(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
      await client.end({ timeout: 5 });
    }
  }, 30_000);

  it("activates and replaces one tenant-owned logo without a partial swap", async () => {
    const first = logoInput(organizationA, ownerMembershipA);
    await db.transaction((tx) => createPendingLogo(tx, organizationA, first));
    await db.transaction((tx) =>
      activateLogo(tx, organizationA, first.id, new Date("2026-08-21T05:01:00.000Z")),
    );
    await expect(getActiveLogo(db, organizationA)).resolves.toMatchObject({ id: first.id });
    await expect(getActiveLogo(db, organizationB)).resolves.toBeNull();

    const crossTenant = logoInput(organizationB, ownerMembershipA);
    await expect(
      db.transaction((tx) => createPendingLogo(tx, organizationA, crossTenant)),
    ).rejects.toThrow();
    const missingOrganizationId = randomUUID();
    const missingOrganization = logoInput(missingOrganizationId, ownerMembershipA);
    await expect(
      db.transaction((tx) => createPendingLogo(tx, missingOrganizationId, missingOrganization)),
    ).rejects.toThrow();

    const second = logoInput(organizationA, ownerMembershipA);
    await db.transaction((tx) => createPendingLogo(tx, organizationA, second));
    await expect(
      db.transaction(async (tx) => {
        await activateLogo(tx, organizationA, second.id, new Date("2026-08-21T05:02:00.000Z"));
        throw new Error("force logo rollback");
      }),
    ).rejects.toThrow("force logo rollback");
    await expect(getActiveLogo(db, organizationA)).resolves.toMatchObject({ id: first.id });

    const previous = await db.transaction((tx) =>
      activateLogo(tx, organizationA, second.id, new Date("2026-08-21T05:03:00.000Z")),
    );
    expect(previous?.id).toBe(first.id);
    await expect(getActiveLogo(db, organizationA)).resolves.toMatchObject({ id: second.id });

    if (!databaseUrl) throw new Error("DATABASE_URL is required for concurrent logo activation");
    const concurrentA = logoInput(organizationA, ownerMembershipA);
    const concurrentB = logoInput(organizationA, ownerMembershipA);
    await db.transaction(async (tx) => {
      await createPendingLogo(tx, organizationA, concurrentA);
      await createPendingLogo(tx, organizationA, concurrentB);
    });
    const connectionA = await connectToSchema(databaseUrl, schemaName);
    const connectionB = await connectToSchema(databaseUrl, schemaName);
    try {
      const databaseA = drizzle(connectionA, { schema });
      const databaseB = drizzle(connectionB, { schema });
      await Promise.all([
        databaseA.transaction((tx) =>
          activateLogo(tx, organizationA, concurrentA.id, new Date("2026-08-21T05:04:00.000Z")),
        ),
        databaseB.transaction((tx) =>
          activateLogo(tx, organizationA, concurrentB.id, new Date("2026-08-21T05:05:00.000Z")),
        ),
      ]);
    } finally {
      await Promise.all([connectionA.end({ timeout: 5 }), connectionB.end({ timeout: 5 })]);
    }

    const [{ activeCount }] = await client`
      select count(*)::int as "activeCount" from organization_logo_assets
      where organization_id = ${organizationA} and status = 'active'
    `;
    expect(activeCount).toBe(1);
  }, 20_000);

  it("enqueues, claims, retries and completes orphan cleanup without an organization", async () => {
    const deletedOrganizationId = randomUUID();
    const objectKey = logoKey(deletedOrganizationId);
    const cleanupId = randomUUID();
    await expect(
      StorageCleanupRepository.enqueueOrphanCleanup(db, {
        cleanupId,
        provider: "s3",
        objectKey,
        outboxEventId: randomUUID(),
        occurredAt: new Date("2026-08-21T06:00:00.000Z"),
      }),
    ).resolves.toBe(cleanupId);

    const [outbox] = await client`
      select payload from outbox_events where aggregate_id = ${cleanupId}
    `;
    expect(outbox?.payload).toEqual({ cleanupId });
    expect(Object.keys(outbox?.payload as object)).toEqual(["cleanupId"]);

    if (!databaseUrl) throw new Error("DATABASE_URL is required for concurrent cleanup claim");
    const connectionA = await connectToSchema(databaseUrl, schemaName);
    const connectionB = await connectToSchema(databaseUrl, schemaName);
    let firstClaim: Array<
      Awaited<ReturnType<typeof StorageCleanupRepository.claimOrphanCleanup>>
    > = [];
    try {
      const databaseA = drizzle(connectionA, { schema });
      const databaseB = drizzle(connectionB, { schema });
      firstClaim = await Promise.all([
        StorageCleanupRepository.claimOrphanCleanup(
          databaseA,
          cleanupId,
          new Date("2026-08-21T06:01:00.000Z"),
        ),
        StorageCleanupRepository.claimOrphanCleanup(
          databaseB,
          cleanupId,
          new Date("2026-08-21T06:01:00.000Z"),
        ),
      ]);
    } finally {
      await Promise.all([connectionA.end({ timeout: 5 }), connectionB.end({ timeout: 5 })]);
    }
    expect(firstClaim.filter((claim) => claim.status === "claimed")).toHaveLength(1);

    await expect(
      StorageCleanupRepository.retryOrphanCleanup(db, cleanupId, {
        now: new Date("2026-08-21T06:02:00.000Z"),
        nextAttemptAt: new Date("2026-08-21T06:05:00.000Z"),
        error: "temporary object storage failure",
      }),
    ).resolves.toBe(true);
    await expect(
      StorageCleanupRepository.claimOrphanCleanup(
        db,
        cleanupId,
        new Date("2026-08-21T06:04:00.000Z"),
      ),
    ).resolves.toEqual({
      status: "retry-at",
      retryAt: new Date("2026-08-21T06:05:00.000Z"),
    });
    await expect(
      StorageCleanupRepository.claimOrphanCleanup(
        db,
        cleanupId,
        new Date("2026-08-21T06:05:00.000Z"),
      ),
    ).resolves.toMatchObject({
      status: "claimed",
      cleanup: { cleanupId, attempts: 1 },
    });
    await expect(
      StorageCleanupRepository.completeOrphanCleanup(
        db,
        cleanupId,
        new Date("2026-08-21T06:06:00.000Z"),
      ),
    ).resolves.toBe(true);
    await expect(
      StorageCleanupRepository.completeOrphanCleanup(
        db,
        cleanupId,
        new Date("2026-08-21T06:07:00.000Z"),
      ),
    ).resolves.toBe(true);
    const [completed] = await client`
      select status, attempts from orphan_storage_cleanup_ledger where cleanup_id = ${cleanupId}
    `;
    expect(completed).toEqual({ status: "completed", attempts: 2 });
  }, 20_000);

  it("rolls ledger creation back when its cleanup outbox cannot commit", async () => {
    const duplicateOutboxId = randomUUID();
    await client`
      insert into outbox_events
        (id, event_type, event_version, aggregate_type, aggregate_id, payload, status,
         attempts, available_at, occurred_at)
      values
        (${duplicateOutboxId}, 'test.existing', 1, 'test', 'existing', '{}'::jsonb, 'pending',
         0, now(), now())
    `;
    const cleanupId = randomUUID();
    await expect(
      StorageCleanupRepository.enqueueOrphanCleanup(db, {
        cleanupId,
        provider: "s3",
        objectKey: logoKey(randomUUID()),
        outboxEventId: duplicateOutboxId,
        occurredAt: new Date("2026-08-21T07:00:00.000Z"),
      }),
    ).rejects.toThrow();
    const [ledger] = await client`
      select count(*)::int as count from orphan_storage_cleanup_ledger
      where cleanup_id = ${cleanupId}
    `;
    expect(ledger?.count).toBe(0);
  });
});
