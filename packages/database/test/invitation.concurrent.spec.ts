import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  revokeInvitation,
} from "../src/repositories/organizations.js";
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
    const batch = isolated.replaceAll("--> statement-breakpoint", "\n").trim();
    if (batch) await client.unsafe(batch);
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

describe.runIf(Boolean(databaseUrl))("invitation concurrency", () => {
  let adminClient: Sql;
  let firstClient: Sql;
  let secondClient: Sql;
  let db: PostgresJsDatabase<typeof schema>;
  let firstDb: PostgresJsDatabase<typeof schema>;
  let secondDb: PostgresJsDatabase<typeof schema>;
  let schemaName: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for invitation concurrency tests");
    schemaName = `phase2_invite_${process.pid}_${randomBytes(6).toString("hex")}`;
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
    db = drizzle(adminClient, { schema });
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

  it("allows exactly one complete winner when two transactions accept the same invitation", async () => {
    const now = new Date("2026-08-21T10:00:00.000Z");
    const ownerUserId = randomUUID();
    const inviteeUserId = randomUUID();
    const ownerMembershipId = randomUUID();
    const organizationId = randomUUID();
    const scopeId = randomUUID();
    const invitationId = randomUUID();
    const token = `invite-${randomUUID()}-${randomUUID()}`;
    const inviteeEmail = "winner@example.test";
    await adminClient`
      insert into users (id, display_name) values
      (${ownerUserId}, 'Owner'), (${inviteeUserId}, 'Invitee')
    `;
    const identityId = randomUUID();
    await adminClient`
      insert into identities (id, user_id, provider, provider_subject, status, verified_at)
      values (${identityId}, ${inviteeUserId}, 'email', ${inviteeEmail}, 'verified', ${now.toISOString()})
    `;
    await adminClient`
      insert into verified_emails (id, user_id, identity_id, normalized_email, verified_at)
      values (${randomUUID()}, ${inviteeUserId}, ${identityId}, ${inviteeEmail}, ${now.toISOString()})
    `;
    await adminClient`
      insert into organizations (id, slug, name) values
      (${organizationId}, ${`invite-${randomUUID()}`}, 'Invite race')
    `;
    await adminClient`
      insert into organization_memberships (id, organization_id, user_id, role, status)
      values (${ownerMembershipId}, ${organizationId}, ${ownerUserId}, 'owner', 'active')
    `;
    await adminClient`
      insert into authorization_scopes (id, organization_id, label)
      values (${scopeId}, ${organizationId}, 'Final')
    `;
    await db.transaction((tx) =>
      createInvitation(tx, organizationId, {
        id: invitationId,
        invitedByMembershipId: ownerMembershipId,
        email: inviteeEmail,
        token,
        organizationRole: "admin",
        rolePayload: [
          { authorizationScopeId: scopeId, role: "broadcast" },
          { authorizationScopeId: scopeId, role: "analyst" },
        ],
        issuedAt: now,
        auditEventId: randomUUID(),
        outboxEventId: randomUUID(),
        correlationId: randomUUID(),
        reason: "owner invited tournament operators",
        occurredAt: now,
      }),
    );

    const barrier = createBarrier(2);
    const attempt = (connection: PostgresJsDatabase<typeof schema>, suffix: string) =>
      connection.transaction(async (tx) => {
        await barrier();
        return acceptInvitation(tx, organizationId, token, inviteeUserId, {
          membershipId: randomUUID(),
          assignmentIds: [randomUUID(), randomUUID()],
          auditEventId: randomUUID(),
          outboxEventId: randomUUID(),
          correlationId: randomUUID(),
          reason: `accepted through concurrent request ${suffix}`,
          occurredAt: new Date(now.getTime() + 1_000),
        });
      });

    const results = await Promise.all([attempt(firstDb, "a"), attempt(secondDb, "b")]);
    expect(results.map((result) => result.status).toSorted()).toEqual(["accepted", "unavailable"]);

    const [state] = await adminClient`
      select
        (select count(*)::int from organization_memberships
          where organization_id = ${organizationId} and user_id = ${inviteeUserId}) as memberships,
        (select count(*)::int from role_assignments
          where organization_id = ${organizationId} and membership_id in
            (select id from organization_memberships where user_id = ${inviteeUserId})) as assignments,
        (select count(*)::int from audit_events
          where organization_id = ${organizationId} and action = 'invitation.accepted') as audits,
        (select count(*)::int from outbox_events
          where aggregate_id = ${invitationId} and event_type = 'invitation.accepted') as outbox
    `;
    expect(state).toEqual({ memberships: 1, assignments: 2, audits: 1, outbox: 1 });
    const [membership] = await adminClient`
      select role, status from organization_memberships
      where organization_id = ${organizationId} and user_id = ${inviteeUserId}
    `;
    expect(membership).toMatchObject({ role: "admin", status: "active" });
    const [invitation] = await adminClient`
      select accepted_at, accepted_by_membership_id, token_digest
      from invitations where id = ${invitationId}
    `;
    expect(invitation?.accepted_at).not.toBeNull();
    expect(invitation?.accepted_by_membership_id).toBeTruthy();
    expect(invitation?.token_digest).not.toBe(token);
  }, 30_000);

  it("rejects wrong email, expired, revoked and replayed invitations without membership", async () => {
    const now = new Date("2026-08-21T11:00:00.000Z");
    const ownerUserId = randomUUID();
    const inviteeUserId = randomUUID();
    const ownerMembershipId = randomUUID();
    const organizationId = randomUUID();
    await adminClient`
      insert into users (id, display_name) values
      (${ownerUserId}, 'Owner checks'), (${inviteeUserId}, 'Invitee checks')
    `;
    const identityId = randomUUID();
    await adminClient`
      insert into identities (id, user_id, provider, provider_subject, status, verified_at)
      values (${identityId}, ${inviteeUserId}, 'email', 'verified@example.test', 'verified', ${now.toISOString()})
    `;
    await adminClient`
      insert into verified_emails (id, user_id, identity_id, normalized_email, verified_at)
      values (${randomUUID()}, ${inviteeUserId}, ${identityId}, 'verified@example.test', ${now.toISOString()})
    `;
    await adminClient`
      insert into organizations (id, slug, name) values
      (${organizationId}, ${`checks-${randomUUID()}`}, 'Invitation checks')
    `;
    await adminClient`
      insert into organization_memberships (id, organization_id, user_id, role, status)
      values (${ownerMembershipId}, ${organizationId}, ${ownerUserId}, 'owner', 'active')
    `;

    const attempt = (token: string, membershipId = randomUUID()) =>
      db.transaction((tx) =>
        acceptInvitation(tx, organizationId, token, inviteeUserId, {
          membershipId,
          assignmentIds: [],
          auditEventId: randomUUID(),
          outboxEventId: randomUUID(),
          correlationId: randomUUID(),
          reason: "negative invitation acceptance check",
          occurredAt: now,
        }),
      );

    const wrongEmailToken = `wrong-${randomUUID()}`;
    await db.transaction((tx) =>
      createInvitation(tx, organizationId, {
        id: randomUUID(),
        invitedByMembershipId: ownerMembershipId,
        email: "another@example.test",
        token: wrongEmailToken,
        organizationRole: "member",
        rolePayload: [],
        issuedAt: now,
        auditEventId: randomUUID(),
        outboxEventId: randomUUID(),
        correlationId: randomUUID(),
        reason: "wrong email negative case",
        occurredAt: now,
      }),
    );
    await expect(attempt(wrongEmailToken)).resolves.toEqual({ status: "unavailable" });

    const expiredToken = `expired-${randomUUID()}`;
    const expiredInvitationId = randomUUID();
    await db.transaction((tx) =>
      createInvitation(tx, organizationId, {
        id: expiredInvitationId,
        invitedByMembershipId: ownerMembershipId,
        email: "verified@example.test",
        token: expiredToken,
        organizationRole: "member",
        rolePayload: [],
        issuedAt: new Date(now.getTime() - 8 * 24 * 60 * 60_000),
        auditEventId: randomUUID(),
        outboxEventId: randomUUID(),
        correlationId: randomUUID(),
        reason: "expired invitation negative case",
        occurredAt: now,
      }),
    );
    await expect(attempt(expiredToken)).resolves.toEqual({ status: "unavailable" });
    await db.transaction((tx) =>
      revokeInvitation(tx, organizationId, expiredInvitationId, {
        actorMembershipId: ownerMembershipId,
        auditEventId: randomUUID(),
        outboxEventId: randomUUID(),
        correlationId: randomUUID(),
        reason: "expired invitation cleanup",
        occurredAt: now,
      }),
    );

    const revokedToken = `revoked-${randomUUID()}`;
    const revokedInvitationId = randomUUID();
    await db.transaction((tx) =>
      createInvitation(tx, organizationId, {
        id: revokedInvitationId,
        invitedByMembershipId: ownerMembershipId,
        email: "revoked@example.test",
        token: revokedToken,
        organizationRole: "member",
        rolePayload: [],
        issuedAt: now,
        auditEventId: randomUUID(),
        outboxEventId: randomUUID(),
        correlationId: randomUUID(),
        reason: "revoked invitation negative case",
        occurredAt: now,
      }),
    );
    await db.transaction((tx) =>
      revokeInvitation(tx, organizationId, revokedInvitationId, {
        actorMembershipId: ownerMembershipId,
        auditEventId: randomUUID(),
        outboxEventId: randomUUID(),
        correlationId: randomUUID(),
        reason: "invitation no longer valid",
        occurredAt: now,
      }),
    );
    await expect(attempt(revokedToken)).resolves.toEqual({ status: "unavailable" });

    const replayToken = `replay-${randomUUID()}`;
    await db.transaction((tx) =>
      createInvitation(tx, organizationId, {
        id: randomUUID(),
        invitedByMembershipId: ownerMembershipId,
        email: "verified@example.test",
        token: replayToken,
        organizationRole: "member",
        rolePayload: [],
        issuedAt: now,
        auditEventId: randomUUID(),
        outboxEventId: randomUUID(),
        correlationId: randomUUID(),
        reason: "replay invitation negative case",
        occurredAt: now,
      }),
    );
    await expect(attempt(replayToken)).resolves.toMatchObject({ status: "accepted" });
    await expect(attempt(replayToken)).resolves.toEqual({ status: "unavailable" });

    const [count] = await adminClient`
      select count(*)::int as count from organization_memberships
      where organization_id = ${organizationId} and user_id = ${inviteeUserId}
    `;
    expect(count?.count).toBe(1);
  }, 30_000);
});
