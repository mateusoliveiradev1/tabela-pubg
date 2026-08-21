import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeMembership, transferOwnership } from "../src/repositories/organizations.js";
import * as schema from "../src/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const concurrencyDatabaseUrl = databaseUrl?.replace(/-pooler(?=\.)/, "");
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
    for (const statement of isolated
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await client.unsafe(statement);
    }
  }
}

function createBarrier(participants: number): () => Promise<void> {
  let arrivals = 0;
  let release: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === participants) release();
    await ready;
  };
}

describe.runIf(Boolean(databaseUrl))("last owner concurrency", () => {
  let adminClient: Sql;
  let firstClient: Sql;
  let secondClient: Sql;
  let firstDb: PostgresJsDatabase<typeof schema>;
  let secondDb: PostgresJsDatabase<typeof schema>;
  let schemaName: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for owner concurrency tests");
    schemaName = `phase2_owner_${process.pid}_${randomBytes(6).toString("hex")}`;
    adminClient = postgres(concurrencyDatabaseUrl ?? databaseUrl, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    await applyMigrations(adminClient, schemaName);
    firstClient = postgres(concurrencyDatabaseUrl ?? databaseUrl, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    secondClient = postgres(concurrencyDatabaseUrl ?? databaseUrl, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    await Promise.all([
      firstClient.unsafe(`set search_path to ${quoteIdentifier(schemaName)}`),
      secondClient.unsafe(`set search_path to ${quoteIdentifier(schemaName)}`),
    ]);
    expect(firstClient).not.toBe(secondClient);
    firstDb = drizzle(firstClient, { schema });
    secondDb = drizzle(secondClient, { schema });
  }, 30_000);

  afterAll(async () => {
    if (firstClient) await firstClient.end({ timeout: 5 });
    if (secondClient) await secondClient.end({ timeout: 5 });
    if (adminClient) {
      await adminClient.unsafe("set search_path to public");
      await adminClient.unsafe(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
      await adminClient.end({ timeout: 5 });
    }
  }, 30_000);

  async function seedOrganization(ownerCount: 1 | 2) {
    const organizationId = randomUUID();
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    const adminUserId = randomUUID();
    const firstMembershipId = randomUUID();
    const secondMembershipId = randomUUID();
    const adminMembershipId = randomUUID();
    await adminClient`
      insert into users (id, display_name) values
      (${firstUserId}, 'First owner'), (${secondUserId}, 'Second member'),
      (${adminUserId}, 'Race administrator')
    `;
    await adminClient`
      insert into organizations (id, slug, name)
      values (${organizationId}, ${`owner-${randomUUID()}`}, 'Owner race')
    `;
    await adminClient`
      insert into organization_memberships (id, organization_id, user_id, role, status)
      values
        (${firstMembershipId}, ${organizationId}, ${firstUserId}, 'owner', 'active'),
        (${secondMembershipId}, ${organizationId}, ${secondUserId}, ${ownerCount === 2 ? "owner" : "member"}, 'active'),
        (${adminMembershipId}, ${organizationId}, ${adminUserId}, 'admin', 'active')
    `;
    return { organizationId, firstMembershipId, secondMembershipId, adminMembershipId };
  }

  const mutationMeta = (reason: string) => ({
    auditEventId: randomUUID(),
    outboxEventId: randomUUID(),
    correlationId: randomUUID(),
    reason,
    occurredAt: new Date("2026-08-21T12:00:00.000Z"),
  });

  it("serializes two owner removals and preserves exactly one active owner", async () => {
    const seeded = await seedOrganization(2);
    const barrier = createBarrier(2);
    const results = await Promise.all([
      firstDb.transaction(async (tx) => {
        await barrier();
        return revokeMembership(
          tx,
          seeded.organizationId,
          seeded.firstMembershipId,
          seeded.adminMembershipId,
          mutationMeta("concurrent removal of first owner"),
        );
      }),
      secondDb.transaction(async (tx) => {
        await barrier();
        return revokeMembership(
          tx,
          seeded.organizationId,
          seeded.secondMembershipId,
          seeded.adminMembershipId,
          mutationMeta("concurrent removal of second owner"),
        );
      }),
    ]);
    expect(results.map((result) => result.status).toSorted()).toEqual(["last-owner", "revoked"]);
    const [state] = await adminClient`
      select
        count(*) filter (where role = 'owner' and status = 'active')::int as owners,
        count(*) filter (where status = 'revoked')::int as revoked
      from organization_memberships where organization_id = ${seeded.organizationId}
    `;
    expect(state).toEqual({ owners: 1, revoked: 1 });
    const [effects] = await adminClient`
      select
        (select count(*)::int from audit_events where organization_id = ${seeded.organizationId}
          and action = 'membership.revoked') as audits,
        (select count(*)::int from outbox_events where aggregate_type = 'organization-membership'
          and payload->>'organizationId' = ${seeded.organizationId}) as outbox
    `;
    expect(effects).toEqual({ audits: 1, outbox: 1 });
  }, 30_000);

  it("coordinates removal with explicit transfer and never reaches zero owners", async () => {
    const seeded = await seedOrganization(1);
    const barrier = createBarrier(2);
    const results = await Promise.all([
      firstDb.transaction(async (tx) => {
        await barrier();
        return revokeMembership(
          tx,
          seeded.organizationId,
          seeded.firstMembershipId,
          seeded.secondMembershipId,
          mutationMeta("owner requested removal during transfer"),
        );
      }),
      secondDb.transaction(async (tx) => {
        await barrier();
        return transferOwnership(
          tx,
          seeded.organizationId,
          seeded.firstMembershipId,
          seeded.secondMembershipId,
          mutationMeta("explicit ownership transfer under contention"),
        );
      }),
    ]);
    expect(results.some((result) => result.status === "transferred")).toBe(true);
    const [state] = await adminClient`
      select
        count(*) filter (where role = 'owner' and status = 'active')::int as owners,
        max(case when id = ${seeded.secondMembershipId} and role = 'owner' then 1 else 0 end)::int
          as target_is_owner
      from organization_memberships where organization_id = ${seeded.organizationId}
    `;
    expect(state).toEqual({ owners: 1, target_is_owner: 1 });
  }, 30_000);
});
