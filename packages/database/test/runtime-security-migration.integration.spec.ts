import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimOutboxBatch, markOutboxPublished, retryOutboxEvent } from "../src/outbox.js";
import * as schema from "../src/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const schemaPrefix = `phase2_runtime_security_${process.pid}_${randomBytes(6).toString("hex")}`;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function assertIsolatedSchemaName(schemaName: string): void {
  if (!/^phase2_runtime_security_\d+_[0-9a-f]{12}_(fresh|upgrade)$/.test(schemaName)) {
    throw new Error("refusing to operate on a non-isolated runtime-security schema");
  }
}

async function migrationFilesThrough(maximumIndex: number): Promise<string[]> {
  return (await readdir(migrationsFolder))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .filter((file) => Number(file.slice(0, 4)) <= maximumIndex)
    .toSorted();
}

async function applyMigrationFiles(
  client: Sql,
  schemaName: string,
  migrationFiles: readonly string[],
): Promise<void> {
  assertIsolatedSchemaName(schemaName);
  const quotedSchema = quoteIdentifier(schemaName);
  await client.unsafe(`set search_path to ${quotedSchema}`);

  for (const migrationFile of migrationFiles) {
    const source = await readFile(path.join(migrationsFolder, migrationFile), "utf8");
    const isolated = source.replaceAll('"public".', `${quotedSchema}.`);
    for (const statement of isolated
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await client.unsafe(statement);
    }
  }
}

async function createIsolatedSchema(client: Sql, schemaName: string): Promise<void> {
  assertIsolatedSchemaName(schemaName);
  await client.unsafe(`create schema ${quoteIdentifier(schemaName)}`);
}

async function dropIsolatedSchema(client: Sql, schemaName: string): Promise<void> {
  assertIsolatedSchemaName(schemaName);
  await client.unsafe("set search_path to public");
  await client.unsafe(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
}

async function expectPostgresError(operation: Promise<unknown>, code: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected PostgreSQL error ${code}`);
}

async function seedActorSession(
  client: Sql,
  input: { userId: string; deviceId: string; sessionId: string; trust: "provisional" | "trusted" },
): Promise<void> {
  const issuedAt = new Date("2026-08-24T08:00:00.000Z");
  const absoluteExpiresAt = new Date(
    issuedAt.getTime() + (input.trust === "provisional" ? 15 * 60_000 : 30 * 24 * 60 * 60_000),
  );
  await client`
    insert into users (id, display_name) values (${input.userId}, 'Runtime actor')
  `;
  await client`
    insert into devices
      (id, user_id, device_digest, label, browser, operating_system, first_seen_at, last_seen_at)
    values
      (${input.deviceId}, ${input.userId}, ${randomBytes(32).toString("hex")}, 'Runtime device',
       'Chromium', 'Windows', ${issuedAt.toISOString()}, ${issuedAt.toISOString()})
  `;
  await client`
    insert into sessions
      (id, user_id, device_id, token_digest, trust, issued_at, last_seen_at,
       idle_expires_at, absolute_expires_at)
    values
      (${input.sessionId}, ${input.userId}, ${input.deviceId},
       ${randomBytes(32).toString("hex")}, ${input.trust}, ${issuedAt.toISOString()},
       ${issuedAt.toISOString()}, ${absoluteExpiresAt.toISOString()},
       ${absoluteExpiresAt.toISOString()})
  `;
}

describe.runIf(process.env.PHASE2_SUITE === "integration")("runtime security migration", () => {
  let freshClient: Sql;
  let upgradeClient: Sql;
  let claimPeerClient: Sql;
  let freshDb: PostgresJsDatabase<typeof schema>;
  let claimPeerDb: PostgresJsDatabase<typeof schema>;
  const freshSchema = `${schemaPrefix}_fresh`;
  const upgradeSchema = `${schemaPrefix}_upgrade`;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required; runtime security migration tests never skip");
    }
    freshClient = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      prepare: false,
      onnotice: () => undefined,
    });
    upgradeClient = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      prepare: false,
      onnotice: () => undefined,
    });
    claimPeerClient = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      prepare: false,
      onnotice: () => undefined,
    });

    await createIsolatedSchema(freshClient, freshSchema);
    await applyMigrationFiles(freshClient, freshSchema, await migrationFilesThrough(3));
    await claimPeerClient.unsafe(`set search_path to ${quoteIdentifier(freshSchema)}`);
    freshDb = drizzle(freshClient, { schema });
    claimPeerDb = drizzle(claimPeerClient, { schema });

    await createIsolatedSchema(upgradeClient, upgradeSchema);
    await applyMigrationFiles(upgradeClient, upgradeSchema, await migrationFilesThrough(2));
  }, 30_000);

  afterAll(async () => {
    if (claimPeerClient) await claimPeerClient.end({ timeout: 5 });
    if (freshClient) {
      await dropIsolatedSchema(freshClient, freshSchema);
      await freshClient.end({ timeout: 5 });
    }
    if (upgradeClient) {
      await dropIsolatedSchema(upgradeClient, upgradeSchema);
      await upgradeClient.end({ timeout: 5 });
    }
  }, 30_000);

  it("creates the security columns, enum, constraints and indexes from zero", async () => {
    const columns = await freshClient`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = ${freshSchema}
        and table_name = any(${["sessions", "auth_challenges", "oauth_transactions", "identity_link_proofs", "outbox_events"]})
    `;
    const columnKey = (table: string, column: string) =>
      columns.some((row) => row.table_name === table && row.column_name === column);
    expect(columnKey("sessions", "trust")).toBe(true);
    expect(columnKey("auth_challenges", "session_id")).toBe(true);
    expect(columnKey("oauth_transactions", "current_method_confirmed_at")).toBe(true);
    expect(columnKey("outbox_events", "claim_token")).toBe(true);
    expect(columnKey("outbox_events", "lease_expires_at")).toBe(true);
    expect(
      columns.find((row) => row.table_name === "sessions" && row.column_name === "trust"),
    ).toMatchObject({ is_nullable: "NO" });

    const enumLabels = await freshClient`
      select enumlabel
      from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
      join pg_catalog.pg_namespace n on n.oid = t.typnamespace
      where n.nspname = ${freshSchema} and t.typname = 'session_trust'
      order by e.enumsortorder
    `;
    expect(enumLabels.map((row) => row.enumlabel)).toEqual(["provisional", "trusted"]);

    const constraints = await freshClient`
      select conname
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_namespace n on n.oid = c.connamespace
      where n.nspname = ${freshSchema}
    `;
    expect(constraints.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        "auth_challenges_user_session_fk",
        "auth_challenges_purpose_binding_check",
        "oauth_transactions_purpose_binding_check",
        "identity_link_proofs_user_session_fk",
        "sessions_provisional_absolute_expiry_check",
      ]),
    );

    const indexes = await freshClient`
      select indexname
      from pg_catalog.pg_indexes
      where schemaname = ${freshSchema}
    `;
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "identity_link_proofs_actor_session_active_idx",
        "identity_link_proofs_expiry_idx",
        "outbox_pending_lease_idx",
      ]),
    );

    const proofColumns = columns
      .filter((row) => row.table_name === "identity_link_proofs")
      .map((row) => row.column_name);
    expect(proofColumns).toEqual(
      expect.arrayContaining([
        "user_id",
        "session_id",
        "provider",
        "provider_subject",
        "expires_at",
        "consumed_at",
      ]),
    );
    expect(proofColumns).not.toEqual(
      expect.arrayContaining([
        "otp",
        "code",
        "oauth_state",
        "browser_binding",
        "session_token",
        "provider_token",
      ]),
    );
  });

  it("preserves durable identity and membership rows while backfilling trust fail-closed", async () => {
    const verifiedUserId = randomUUID();
    const unverifiedUserId = randomUUID();
    const verifiedDiscordIdentityId = randomUUID();
    const unverifiedDiscordIdentityId = randomUUID();
    const emailIdentityId = randomUUID();
    const verifiedDeviceId = randomUUID();
    const unverifiedDeviceId = randomUUID();
    const verifiedSessionId = randomUUID();
    const unverifiedSessionId = randomUUID();
    const organizationId = randomUUID();
    const verifiedMembershipId = randomUUID();
    const unverifiedMembershipId = randomUUID();
    const issuedAt = new Date("2026-08-20T10:00:00.000Z");
    const legacyExpiresAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60_000);

    await upgradeClient`
      insert into users (id, display_name) values
        (${verifiedUserId}, 'Verified actor'), (${unverifiedUserId}, 'Unverified actor')
    `;
    await upgradeClient`
      insert into identities
        (id, user_id, provider, provider_subject, status, verified_at)
      values
        (${verifiedDiscordIdentityId}, ${verifiedUserId}, 'discord', 'discord-preserved-verified', 'verified', ${issuedAt}),
        (${unverifiedDiscordIdentityId}, ${unverifiedUserId}, 'discord', 'discord-preserved-unverified', 'verified', ${issuedAt}),
        (${emailIdentityId}, ${verifiedUserId}, 'email', 'email-digest-preserved', 'verified', ${issuedAt})
    `;
    await upgradeClient`
      insert into verified_emails
        (id, user_id, identity_id, normalized_email, verified_at)
      values
        (${randomUUID()}, ${verifiedUserId}, ${emailIdentityId}, 'verified@example.test', ${issuedAt})
    `;
    await upgradeClient`
      insert into devices
        (id, user_id, device_digest, label, browser, operating_system, first_seen_at, last_seen_at)
      values
        (${verifiedDeviceId}, ${verifiedUserId}, ${randomBytes(32).toString("hex")}, 'Verified device', 'Chromium', 'Windows', ${issuedAt}, ${issuedAt}),
        (${unverifiedDeviceId}, ${unverifiedUserId}, ${randomBytes(32).toString("hex")}, 'Unverified device', 'Chromium', 'Windows', ${issuedAt}, ${issuedAt})
    `;
    await upgradeClient`
      insert into sessions
        (id, user_id, device_id, token_digest, issued_at, last_seen_at, idle_expires_at, absolute_expires_at)
      values
        (${verifiedSessionId}, ${verifiedUserId}, ${verifiedDeviceId}, ${randomBytes(32).toString("hex")}, ${issuedAt}, ${issuedAt}, ${legacyExpiresAt}, ${legacyExpiresAt}),
        (${unverifiedSessionId}, ${unverifiedUserId}, ${unverifiedDeviceId}, ${randomBytes(32).toString("hex")}, ${issuedAt}, ${issuedAt}, ${legacyExpiresAt}, ${legacyExpiresAt})
    `;
    await upgradeClient`
      insert into organizations (id, slug, name) values (${organizationId}, ${`upgrade-${randomUUID()}`}, 'Upgrade org')
    `;
    await upgradeClient`
      insert into organization_memberships
        (id, organization_id, user_id, role, status, joined_at)
      values
        (${verifiedMembershipId}, ${organizationId}, ${verifiedUserId}, 'owner', 'active', ${issuedAt}),
        (${unverifiedMembershipId}, ${organizationId}, ${unverifiedUserId}, 'member', 'active', ${issuedAt})
    `;
    await upgradeClient`
      insert into outbox_events
        (id, event_type, event_version, aggregate_type, aggregate_id, payload,
         status, attempts, available_at, occurred_at, last_error)
      values
        (${randomUUID()}, 'legacy.publishing', 1, 'legacy', 'legacy-1', '{}'::jsonb,
         'publishing', 1, ${issuedAt}, ${issuedAt}, null)
    `;

    await applyMigrationFiles(upgradeClient, upgradeSchema, ["0003_runtime_security_closure.sql"]);

    const sessions = await upgradeClient`
      select id, trust, issued_at, idle_expires_at, absolute_expires_at
      from sessions where id = any(${[verifiedSessionId, unverifiedSessionId]})
      order by id
    `;
    const verified = sessions.find((row) => row.id === verifiedSessionId);
    const unverified = sessions.find((row) => row.id === unverifiedSessionId);
    expect(verified).toMatchObject({ trust: "trusted", absolute_expires_at: legacyExpiresAt });
    expect(unverified?.trust).toBe("provisional");
    expect(unverified?.absolute_expires_at).toEqual(new Date(issuedAt.getTime() + 15 * 60_000));
    expect(unverified?.idle_expires_at).toEqual(new Date(issuedAt.getTime() + 15 * 60_000));

    const preserved = await upgradeClient`
      select
        (select count(*)::int from identities where provider = 'discord') as discord_identities,
        (select count(*)::int from organization_memberships where organization_id = ${organizationId}) as memberships,
        (select count(*)::int from outbox_events where status = 'failed' and last_error = 'migration_recovered') as recovered_outbox
    `;
    expect(preserved[0]).toEqual({ discord_identities: 2, memberships: 2, recovered_outbox: 1 });
  }, 15_000);

  it("rejects cross-actor session binding and consumes link proofs only once", async () => {
    const actorA = { userId: randomUUID(), deviceId: randomUUID(), sessionId: randomUUID() };
    const actorB = { userId: randomUUID(), deviceId: randomUUID(), sessionId: randomUUID() };
    await seedActorSession(freshClient, { ...actorA, trust: "trusted" });
    await seedActorSession(freshClient, { ...actorB, trust: "trusted" });
    const now = new Date("2026-08-24T12:00:00.000Z");

    await expectPostgresError(
      freshClient`
        insert into auth_challenges
          (id, user_id, session_id, email_digest, purpose, code_digest, expires_at, created_at)
        values
          (${randomUUID()}, ${actorA.userId}, ${actorB.sessionId}, ${randomBytes(32).toString("hex")},
           'step-up', ${randomBytes(32).toString("hex")},
           ${new Date(now.getTime() + 60_000).toISOString()}, ${now.toISOString()})
      `,
      "23503",
    );

    await expectPostgresError(
      freshClient`
        insert into auth_challenges
          (id, user_id, session_id, email_digest, purpose, code_digest, expires_at, created_at)
        values
          (${randomUUID()}, ${actorA.userId}, ${actorA.sessionId}, ${randomBytes(32).toString("hex")},
           'sign-in', ${randomBytes(32).toString("hex")},
           ${new Date(now.getTime() + 60_000).toISOString()}, ${now.toISOString()})
      `,
      "23514",
    );

    const proofId = randomUUID();
    await freshClient`
      insert into identity_link_proofs
        (id, user_id, session_id, provider, provider_subject, expires_at, created_at)
      values
        (${proofId}, ${actorA.userId}, ${actorA.sessionId}, 'discord', 'candidate-discord-subject',
         ${new Date(now.getTime() + 60_000).toISOString()}, ${now.toISOString()})
    `;
    const firstConsume = await freshClient`
      update identity_link_proofs
      set consumed_at = ${new Date(now.getTime() + 1_000).toISOString()}
      where id = ${proofId} and user_id = ${actorA.userId} and session_id = ${actorA.sessionId}
        and consumed_at is null and expires_at > ${now.toISOString()}
      returning id
    `;
    const replay = await freshClient`
      update identity_link_proofs
      set consumed_at = ${new Date(now.getTime() + 2_000).toISOString()}
      where id = ${proofId} and user_id = ${actorA.userId} and session_id = ${actorA.sessionId}
        and consumed_at is null and expires_at > ${now.toISOString()}
      returning id
    `;
    expect(firstConsume).toHaveLength(1);
    expect(replay).toHaveLength(0);
  });

  it("serializes claims, reclaims expired leases and rejects stale publishers", async () => {
    const eventId = randomUUID();
    const unrelatedEventId = randomUUID();
    const now = new Date("2026-08-24T09:00:00.000Z");
    await freshClient`
      insert into outbox_events
        (id, event_type, event_version, aggregate_type, aggregate_id, payload,
         status, attempts, available_at, occurred_at)
      values
        (${eventId}, 'notification.delivery.requested', 1, 'migration-test', ${eventId}, '{}'::jsonb,
         'pending', 0, ${now.toISOString()}, ${now.toISOString()}),
        (${unrelatedEventId}, 'organization.created', 1, 'organization', ${unrelatedEventId}, '{}'::jsonb,
         'pending', 0, ${now.toISOString()}, ${now.toISOString()})
    `;

    const [firstClaim, competingClaim] = await Promise.all([
      claimOutboxBatch(freshDb, {
        now,
        claimToken: "claim-owner-a",
        leaseMs: 60_000,
        batchSize: 1,
        maxAttempts: 5,
        eventTypes: ["notification.delivery.requested", "storage.logo.cleanup"],
      }),
      claimOutboxBatch(claimPeerDb, {
        now,
        claimToken: "claim-owner-b",
        leaseMs: 60_000,
        batchSize: 1,
        maxAttempts: 5,
        eventTypes: ["notification.delivery.requested", "storage.logo.cleanup"],
      }),
    ]);
    expect([...firstClaim, ...competingClaim].filter((row) => row.id === eventId)).toHaveLength(1);
    const firstOwner = firstClaim[0]?.id === eventId ? "claim-owner-a" : "claim-owner-b";
    const reclaimOwner = firstOwner === "claim-owner-a" ? "claim-owner-b" : "claim-owner-a";
    const reclaimDb = firstOwner === "claim-owner-a" ? claimPeerDb : freshDb;

    await freshClient`
      update outbox_events set lease_expires_at = ${new Date(now.getTime() - 1).toISOString()}
      where id = ${eventId}
    `;
    const reclaimed = await claimOutboxBatch(reclaimDb, {
      now,
      claimToken: reclaimOwner,
      leaseMs: 60_000,
      batchSize: 1,
      maxAttempts: 5,
      eventTypes: ["notification.delivery.requested", "storage.logo.cleanup"],
    });
    expect(reclaimed.map((row) => row.id)).toContain(eventId);

    await expect(
      markOutboxPublished(freshDb, {
        eventId,
        claimToken: firstOwner,
        publishedAt: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toBe(false);
    await expect(
      retryOutboxEvent(freshDb, {
        eventId,
        claimToken: firstOwner,
        now: new Date(now.getTime() + 1_000),
        errorCode: "recipient@example.test token=secret",
        baseRetryMs: 1_000,
        maxRetryMs: 60_000,
        maxAttempts: 5,
      }),
    ).resolves.toBe(false);
    await expect(
      markOutboxPublished(reclaimDb, {
        eventId,
        claimToken: reclaimOwner,
        publishedAt: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toBe(true);

    const published = await freshClient`
      select status, published_at, claim_token, lease_expires_at from outbox_events where id = ${eventId}
    `;
    expect(published[0]).toMatchObject({
      status: "published",
      claim_token: null,
      lease_expires_at: null,
    });
    const terminalClaim = await claimOutboxBatch(freshDb, {
      now: new Date(now.getTime() + 120_000),
      claimToken: "claim-after-published",
      leaseMs: 60_000,
      batchSize: 1,
      maxAttempts: 5,
      eventTypes: ["notification.delivery.requested", "storage.logo.cleanup"],
    });
    expect(terminalClaim.map((row) => row.id)).not.toContain(eventId);
    const [unrelated] = await freshClient`
      select status, attempts, claim_token, lease_expires_at
      from outbox_events where id = ${unrelatedEventId}
    `;
    expect(unrelated).toEqual({
      status: "pending",
      attempts: 0,
      claim_token: null,
      lease_expires_at: null,
    });
  });
});
