import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumeAuthChallenge,
  consumeOAuthTransaction,
  createOAuthTransaction,
  linkIdentity,
  replaceAuthChallenge,
} from "../src/repositories/identity.js";
import { AuditWriter } from "../src/repositories/audit.js";
import { loadAuthorizationSnapshot } from "../src/repositories/authorization.js";
import {
  clearNotificationPayload,
  createEncryptedNotificationDelivery,
  decryptNotificationPayload,
} from "../src/repositories/notifications.js";
import {
  createOrganization,
  findMembershipById,
} from "../src/repositories/organizations.js";
import * as schema from "../src/schema.js";
import { notificationDeliveries } from "../src/schema.js";

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
    for (const statement of isolated
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await client.unsafe(statement);
    }
  }
}

describe.runIf(Boolean(databaseUrl))("identity repositories", () => {
  let client: Sql;
  let db: PostgresJsDatabase<typeof schema>;
  let schemaName: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for identity repository integration tests");
    }
    schemaName = `phase2_identity_${process.pid}_${randomBytes(6).toString("hex")}`;
    client = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      prepare: false,
      onnotice: () => undefined,
    });
    await applyMigrations(client, schemaName);
    db = drizzle(client, { schema });
  }, 30_000);

  afterAll(async () => {
    if (client) {
      await client.unsafe("set search_path to public");
      await client.unsafe(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
      await client.end({ timeout: 5 });
    }
  }, 30_000);

  it("consumes OAuth state once and binds it to browser, purpose and expiry", async () => {
    const now = new Date("2026-08-21T04:00:00.000Z");
    const state = "oauth-state-must-never-be-stored";
    const browserBinding = "browser-binding-must-never-be-stored";

    await createOAuthTransaction(
      db,
      {
        id: randomUUID(),
        state,
        browserBinding,
        purpose: "sign-in",
        expiresAt: new Date(now.getTime() + 5 * 60_000),
      },
      () => now,
    );

    await expect(
      consumeOAuthTransaction(
        db,
        { state, browserBinding: "wrong-browser", purpose: "sign-in" },
        () => now,
      ),
    ).resolves.toBeNull();

    await expect(
      consumeOAuthTransaction(db, { state, browserBinding, purpose: "step-up" }, () => now),
    ).resolves.toBeNull();

    const consumed = await consumeOAuthTransaction(
      db,
      { state, browserBinding, purpose: "sign-in" },
      () => now,
    );
    expect(consumed?.purpose).toBe("sign-in");

    await expect(
      consumeOAuthTransaction(db, { state, browserBinding, purpose: "sign-in" }, () => now),
    ).resolves.toBeNull();

    const [stored] =
      await client`select state_digest, browser_binding_digest from oauth_transactions`;
    expect(JSON.stringify(stored)).not.toContain(state);
    expect(JSON.stringify(stored)).not.toContain(browserBinding);

    const expiredState = "expired-oauth-state";
    await createOAuthTransaction(
      db,
      {
        id: randomUUID(),
        state: expiredState,
        browserBinding,
        purpose: "sign-in",
        expiresAt: new Date(now.getTime() + 1_000),
      },
      () => now,
    );
    await expect(
      consumeOAuthTransaction(
        db,
        { state: expiredState, browserBinding, purpose: "sign-in" },
        () => new Date(now.getTime() + 2_000),
      ),
    ).resolves.toBeNull();
  });

  it("supersedes OTP challenges, decrements attempts and rejects replay", async () => {
    const now = new Date("2026-08-21T05:00:00.000Z");
    const hmacKey = Buffer.alloc(32, 7);
    const email = "organizer@example.test";

    const firstId = randomUUID();
    await replaceAuthChallenge(
      db,
      {
        id: firstId,
        email,
        purpose: "sign-in",
        code: "111111",
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      },
      hmacKey,
      () => now,
    );

    const secondId = randomUUID();
    await replaceAuthChallenge(
      db,
      {
        id: secondId,
        email,
        purpose: "sign-in",
        code: "222222",
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      },
      hmacKey,
      () => new Date(now.getTime() + 1_000),
    );

    const [superseded] = await client`
      select superseded_at from auth_challenges where id = ${firstId}
    `;
    expect(superseded?.superseded_at).not.toBeNull();

    await expect(
      consumeAuthChallenge(
        db,
        { email, purpose: "sign-in", code: "000000" },
        hmacKey,
        () => new Date(now.getTime() + 2_000),
      ),
    ).resolves.toMatchObject({ status: "invalid", attemptsRemaining: 4 });

    await expect(
      consumeAuthChallenge(
        db,
        { email, purpose: "sign-in", code: "222222" },
        hmacKey,
        () => new Date(now.getTime() + 3_000),
      ),
    ).resolves.toMatchObject({ status: "consumed", challengeId: secondId });

    await expect(
      consumeAuthChallenge(
        db,
        { email, purpose: "sign-in", code: "222222" },
        hmacKey,
        () => new Date(now.getTime() + 4_000),
      ),
    ).resolves.toEqual({ status: "unavailable" });

    const rows = await client`select email_digest, code_digest from auth_challenges`;
    expect(JSON.stringify(rows)).not.toContain(email);
    expect(JSON.stringify(rows)).not.toContain("111111");
    expect(JSON.stringify(rows)).not.toContain("222222");
  });

  it("links only provider and subject, returning a non-enumerating conflict", async () => {
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    await client`
      insert into users (id, display_name) values
      (${firstUserId}, 'First organizer'),
      (${secondUserId}, 'Same email is not identity linking')
    `;

    await expect(
      linkIdentity(db, {
        id: randomUUID(),
        userId: firstUserId,
        provider: "discord",
        providerSubject: "discord-user-42",
        displayName: "Organizer",
        verifiedAt: new Date("2026-08-21T05:30:00.000Z"),
      }),
    ).resolves.toMatchObject({ status: "linked" });

    await expect(
      linkIdentity(db, {
        id: randomUUID(),
        userId: secondUserId,
        provider: "discord",
        providerSubject: "discord-user-42",
        displayName: "Another organizer",
        verifiedAt: new Date("2026-08-21T05:31:00.000Z"),
      }),
    ).resolves.toEqual({ status: "conflict" });
  });

  it("stores notification secrets only in an AES-GCM envelope and clears them", async () => {
    const encryptionKey = Buffer.alloc(32, 11);
    const deliveryId = randomUUID();
    const plaintext = {
      recipient: "organizer@example.test",
      otp: "829104",
    };

    await createEncryptedNotificationDelivery(db, {
      id: deliveryId,
      template: "identity.otp",
      recipient: plaintext.recipient,
      idempotencyKey: "otp-delivery-1",
      encryptionKey: { version: "v1", key: encryptionKey },
      payload: plaintext,
      payloadExpiresAt: new Date("2026-08-21T06:10:00.000Z"),
      availableAt: new Date("2026-08-21T06:00:00.000Z"),
      outboxEventId: randomUUID(),
      occurredAt: new Date("2026-08-21T06:00:00.000Z"),
    });

    const [delivery] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId));
    const [outbox] =
      await client`select payload from outbox_events where aggregate_id = ${deliveryId}`;
    expect(JSON.stringify(delivery)).not.toContain(plaintext.recipient);
    expect(JSON.stringify(delivery)).not.toContain(plaintext.otp);
    expect(outbox?.payload).toEqual({ deliveryId });
    if (!delivery) {
      throw new Error("encrypted notification delivery was not persisted");
    }

    await expect(decryptNotificationPayload(delivery, { v1: encryptionKey })).resolves.toEqual(
      plaintext,
    );

    await clearNotificationPayload(db, deliveryId, {
      status: "delivered",
      at: new Date("2026-08-21T06:01:00.000Z"),
      providerMessageId: "provider-1",
    });
    const [cleared] = await client`
      select payload_iv, payload_ciphertext, payload_auth_tag, payload_cleared_at
      from notification_deliveries where id = ${deliveryId}
    `;
    expect(cleared).toMatchObject({
      payload_iv: null,
      payload_ciphertext: null,
      payload_auth_tag: null,
    });
    expect(cleared?.payload_cleared_at).not.toBeNull();
  });

  it("rolls notification delivery and outbox back together", async () => {
    const deliveryId = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await createEncryptedNotificationDelivery(tx, {
          id: deliveryId,
          template: "identity.otp",
          recipient: "rollback@example.test",
          idempotencyKey: "rollback-delivery",
          encryptionKey: { version: "v1", key: Buffer.alloc(32, 13) },
          payload: { otp: "101010" },
          payloadExpiresAt: new Date("2026-08-21T07:10:00.000Z"),
          availableAt: new Date("2026-08-21T07:00:00.000Z"),
          outboxEventId: randomUUID(),
          occurredAt: new Date("2026-08-21T07:00:00.000Z"),
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const [delivery] = await client`
      select count(*)::int as count from notification_deliveries where id = ${deliveryId}
    `;
    const [outbox] = await client`
      select count(*)::int as count from outbox_events where aggregate_id = ${deliveryId}
    `;
    expect(delivery?.count).toBe(0);
    expect(outbox?.count).toBe(0);
  });

  it("creates independent organizations with owner, audit and outbox in one transaction", async () => {
    const userId = randomUUID();
    const now = new Date("2026-08-21T08:00:00.000Z");
    await client`insert into users (id, display_name) values (${userId}, 'Multi org owner')`;

    const organizationsToCreate = [
      { id: randomUUID(), membershipId: randomUUID(), slug: `alpha-${randomUUID()}` },
      { id: randomUUID(), membershipId: randomUUID(), slug: `bravo-${randomUUID()}` },
    ];

    for (const organization of organizationsToCreate) {
      await db.transaction((tx) =>
        createOrganization(tx, {
          id: organization.id,
          slug: organization.slug,
          name: `Camp ${organization.slug}`,
          ownerUserId: userId,
          ownerMembershipId: organization.membershipId,
          auditEventId: randomUUID(),
          outboxEventId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: now,
        }),
      );
    }

    const memberships = await client`
      select organization_id, user_id, role, status
      from organization_memberships
      where user_id = ${userId}
      order by organization_id
    `;
    expect(memberships).toHaveLength(2);
    expect(memberships.every((row) => row.role === "owner" && row.status === "active")).toBe(true);

    const audits = await client`
      select organization_id, action, actor_membership_id
      from audit_events
      where organization_id = any(${organizationsToCreate.map((organization) => organization.id)})
    `;
    const outbox = await client`
      select aggregate_id, event_type, payload
      from outbox_events
      where aggregate_id = any(${organizationsToCreate.map((organization) => organization.id)})
    `;
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.action === "organization.created")).toBe(true);
    expect(outbox).toHaveLength(2);
    expect(outbox.every((row) => row.event_type === "organization.created")).toBe(true);
    expect(JSON.stringify(outbox)).not.toContain(userId);
  }, 15_000);

  it("requires organization context for tenant resources and loads only current assignments", async () => {
    const userId = randomUUID();
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const membershipA = randomUUID();
    const membershipB = randomUUID();
    const scopeA = randomUUID();
    const scopeB = randomUUID();
    const now = new Date("2026-08-21T08:30:00.000Z");

    await client`insert into users (id, display_name) values (${userId}, 'Scoped operator')`;
    for (const input of [
      { id: organizationA, membershipId: membershipA, slug: `scope-a-${randomUUID()}` },
      { id: organizationB, membershipId: membershipB, slug: `scope-b-${randomUUID()}` },
    ]) {
      await db.transaction((tx) =>
        createOrganization(tx, {
          id: input.id,
          slug: input.slug,
          name: input.slug,
          ownerUserId: userId,
          ownerMembershipId: input.membershipId,
          auditEventId: randomUUID(),
          outboxEventId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: now,
        }),
      );
    }
    await client`
      insert into authorization_scopes (id, organization_id, label) values
      (${scopeA}, ${organizationA}, 'Tournament A'),
      (${scopeB}, ${organizationB}, 'Tournament B')
    `;
    await client`
      insert into role_assignments
        (id, organization_id, membership_id, authorization_scope_id, role, status,
         assigned_by_membership_id, assignment_reason, assigned_at, revoked_at, revocation_reason)
      values
        (${randomUUID()}, ${organizationA}, ${membershipA}, ${scopeA}, 'broadcast', 'active',
         ${membershipA}, 'initial assignment', ${now.toISOString()}, null, null),
        (${randomUUID()}, ${organizationB}, ${membershipB}, ${scopeB}, 'analyst', 'revoked',
         ${membershipB}, 'revoked assignment', ${now.toISOString()}, ${now.toISOString()}, 'assignment revoked')
    `;

    await expect(findMembershipById(db, organizationA, membershipB)).resolves.toBeNull();
    await expect(findMembershipById(db, organizationA, membershipA)).resolves.toMatchObject({
      id: membershipA,
      organizationId: organizationA,
    });

    const snapshot = await loadAuthorizationSnapshot(db, organizationA, userId);
    expect(snapshot).toMatchObject({
      actorId: userId,
      organizationId: organizationA,
      membershipStatus: "active",
      organizationRole: "owner",
    });
    expect(snapshot?.assignments).toEqual([
      {
        organizationId: organizationA,
        authorizationScopeId: scopeA,
        role: "broadcast",
        status: "active",
      },
    ]);
  }, 15_000);

  it("shows complete audit to owner/admin and only self actions to members", async () => {
    const organizationId = randomUUID();
    const ownerUserId = randomUUID();
    const adminUserId = randomUUID();
    const memberUserId = randomUUID();
    const ownerMembershipId = randomUUID();
    const adminMembershipId = randomUUID();
    const memberMembershipId = randomUUID();
    const now = new Date("2026-08-21T09:00:00.000Z");
    await client`
      insert into users (id, display_name) values
      (${ownerUserId}, 'Owner'), (${adminUserId}, 'Admin'), (${memberUserId}, 'Member')
    `;
    await db.transaction((tx) =>
      createOrganization(tx, {
        id: organizationId,
        slug: `audit-${randomUUID()}`,
        name: "Audit visibility",
        ownerUserId,
        ownerMembershipId,
        auditEventId: randomUUID(),
        outboxEventId: randomUUID(),
        correlationId: randomUUID(),
        occurredAt: now,
      }),
    );
    await client`
      insert into organization_memberships (id, organization_id, user_id, role, status, joined_at)
      values
        (${adminMembershipId}, ${organizationId}, ${adminUserId}, 'admin', 'active', ${now.toISOString()}),
        (${memberMembershipId}, ${organizationId}, ${memberUserId}, 'member', 'active', ${now.toISOString()})
    `;

    for (const [actorMembershipId, action] of [
      [ownerMembershipId, "organization.updated"],
      [adminMembershipId, "invitation.created"],
      [memberMembershipId, "invitation.accepted"],
    ] as const) {
      await AuditWriter.append(db, {
        id: randomUUID(),
        organizationId,
        actorMembershipId,
        action,
        targetType: "organization-membership",
        targetId: actorMembershipId,
        reason: "visibility test",
        before: { membershipStatus: "pending", emailAddress: "secret@example.test" },
        after: { membershipStatus: "active", inviteToken: "must-not-persist" },
        correlationId: randomUUID(),
        occurredAt: now,
      });
    }

    await expect(
      AuditWriter.listVisible(db, organizationId, ownerMembershipId),
    ).resolves.toHaveLength(4);
    await expect(
      AuditWriter.listVisible(db, organizationId, adminMembershipId),
    ).resolves.toHaveLength(4);
    const memberAudit = await AuditWriter.listVisible(db, organizationId, memberMembershipId);
    expect(memberAudit).toHaveLength(1);
    expect(memberAudit[0]?.actorMembershipId).toBe(memberMembershipId);
    expect(JSON.stringify(memberAudit)).not.toContain("secret@example.test");
    expect(JSON.stringify(memberAudit)).not.toContain("must-not-persist");
  }, 15_000);

  it("rolls organization, owner, audit and outbox back together", async () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    await client`insert into users (id, display_name) values (${userId}, 'Rollback owner')`;

    await expect(
      db.transaction(async (tx) => {
        await createOrganization(tx, {
          id: organizationId,
          slug: `rollback-${randomUUID()}`,
          name: "Rollback organization",
          ownerUserId: userId,
          ownerMembershipId: randomUUID(),
          auditEventId: randomUUID(),
          outboxEventId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: new Date("2026-08-21T09:30:00.000Z"),
        });
        throw new Error("force organization rollback");
      }),
    ).rejects.toThrow("force organization rollback");

    const [counts] = await client`
      select
        (select count(*)::int from organizations where id = ${organizationId}) as organizations,
        (select count(*)::int from organization_memberships where organization_id = ${organizationId}) as memberships,
        (select count(*)::int from audit_events where organization_id = ${organizationId}) as audits,
        (select count(*)::int from outbox_events where aggregate_id = ${organizationId}) as outbox
    `;
    expect(counts).toEqual({ organizations: 0, memberships: 0, audits: 0, outbox: 0 });
  }, 15_000);
});
