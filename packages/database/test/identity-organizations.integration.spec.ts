import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditWriter } from "../src/repositories/audit.js";
import { loadAuthorizationSnapshot } from "../src/repositories/authorization.js";
import {
  completeOtpChallenge,
  consumeAuthChallenge,
  consumeIdentityLinkProof,
  consumeOAuthTransaction,
  createIdentityLinkProof,
  createOAuthTransaction,
  findPendingIdentityLinkForSession,
  identityDigests,
  linkIdentity,
  replaceAuthChallenge,
  replaceAuthChallengeDigest,
  replaceAuthChallengeWithNotification,
  resolveOrCreateEmailAccount,
} from "../src/repositories/identity.js";
import {
  clearNotificationPayload,
  createEncryptedNotificationDelivery,
  decryptNotificationPayload,
} from "../src/repositories/notifications.js";
import { createOrganization, findMembershipById } from "../src/repositories/organizations.js";
import { resolveSession } from "../src/repositories/sessions.js";
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
    const batch = isolated.replaceAll("--> statement-breakpoint", "\n").trim();
    if (batch) await client.unsafe(batch);
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
        { state, browserBinding: "wrong-browser" },
        () => now,
      ),
    ).resolves.toBeNull();

    const consumed = await consumeOAuthTransaction(db, { state, browserBinding }, () => now);
    expect(consumed?.purpose).toBe("sign-in");

    await expect(
      consumeOAuthTransaction(db, { state, browserBinding }, () => now),
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
        { state: expiredState, browserBinding },
        () => new Date(now.getTime() + 2_000),
      ),
    ).resolves.toBeNull();
  });

  it("round-trips the server-bound actor and session for step-up without a prior proof", async () => {
    const issuedAt = new Date("2026-08-24T12:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actorId = randomUUID();
    const sessionId = randomUUID();
    const state = `step-up-${randomUUID()}`;
    const browserBinding = `browser-${randomUUID()}`;
    await seedSession({
      userId: actorId,
      sessionId,
      token: `step-up-token-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });

    await createOAuthTransaction(
      db,
      {
        id: randomUUID(),
        state,
        browserBinding,
        purpose: "step-up",
        expiresAt: new Date(now.getTime() + 600_000),
        userId: actorId,
        sessionId,
      },
      () => now,
    );

    await expect(
      consumeOAuthTransaction(db, { state, browserBinding }, () => now),
    ).resolves.toMatchObject({
      purpose: "step-up",
      userId: actorId,
      sessionId,
      currentMethodConfirmedAt: null,
    });
  });

  it("rejects protected OAuth starts without the exact active actor session", async () => {
    const issuedAt = new Date("2026-08-24T13:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const activeActorId = randomUUID();
    const activeSessionId = randomUUID();
    const revokedActorId = randomUUID();
    const revokedSessionId = randomUUID();
    const expiredActorId = randomUUID();
    const expiredSessionId = randomUUID();
    const inactiveActorId = randomUUID();
    const inactiveSessionId = randomUUID();
    await seedSession({
      userId: activeActorId,
      sessionId: activeSessionId,
      token: `active-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await seedSession({
      userId: revokedActorId,
      sessionId: revokedSessionId,
      token: `revoked-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await seedSession({
      userId: expiredActorId,
      sessionId: expiredSessionId,
      token: `expired-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await seedSession({
      userId: inactiveActorId,
      sessionId: inactiveSessionId,
      token: `inactive-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await client`update sessions set revoked_at = ${now.toISOString()}, revocation_reason = 'logout' where id = ${revokedSessionId}`;
    await client`update sessions set idle_expires_at = ${now.toISOString()} where id = ${expiredSessionId}`;
    await client`update users set status = 'suspended' where id = ${inactiveActorId}`;

    const rejectedBindings = [
      { userId: activeActorId, sessionId: randomUUID() },
      { userId: randomUUID(), sessionId: activeSessionId },
      { userId: revokedActorId, sessionId: revokedSessionId },
      { userId: expiredActorId, sessionId: expiredSessionId },
      { userId: inactiveActorId, sessionId: inactiveSessionId },
    ];
    for (const binding of rejectedBindings) {
      const transactionId = randomUUID();
      await expect(
        createOAuthTransaction(
          db,
          {
            id: transactionId,
            state: `rejected-${randomUUID()}`,
            browserBinding: `browser-${randomUUID()}`,
            purpose: "step-up",
            expiresAt: new Date(now.getTime() + 600_000),
            ...binding,
          },
          () => now,
        ),
      ).rejects.toThrow("active session required");
      const [stored] =
        await client`select count(*)::int as count from oauth_transactions where id = ${transactionId}`;
      expect(stored?.count).toBe(0);
    }

    const signInId = randomUUID();
    await expect(
      createOAuthTransaction(
        db,
        {
          id: signInId,
          state: `sign-in-smuggling-${randomUUID()}`,
          browserBinding: `browser-${randomUUID()}`,
          purpose: "sign-in",
          expiresAt: new Date(now.getTime() + 600_000),
          userId: activeActorId,
          sessionId: activeSessionId,
        },
        () => now,
      ),
    ).rejects.toThrow("purpose binding is invalid");
    const [signInStored] =
      await client`select count(*)::int as count from oauth_transactions where id = ${signInId}`;
    expect(signInStored?.count).toBe(0);
  });

  it("requires a fresh same-session current-method proof for identity link starts", async () => {
    const issuedAt = new Date("2026-08-24T14:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 20 * 60_000);
    const actorId = randomUUID();
    const freshSessionId = randomUUID();
    const missingSessionId = randomUUID();
    const staleSessionId = randomUUID();
    const expiredSessionId = randomUUID();
    await seedSession({
      userId: actorId,
      sessionId: freshSessionId,
      token: `fresh-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    for (const sessionId of [missingSessionId, staleSessionId, expiredSessionId]) {
      await seedAdditionalSession({
        userId: actorId,
        sessionId,
        token: `link-${randomUUID()}`,
        trust: "trusted",
        now: issuedAt,
      });
    }
    const confirmedAt = new Date(now.getTime() - 60_000);
    await client`update sessions set reauthenticated_at = ${confirmedAt.toISOString()} where id = ${freshSessionId}`;
    await client`update sessions set reauthenticated_at = ${new Date(now.getTime() - 10 * 60_000).toISOString()} where id = ${staleSessionId}`;
    await client`update sessions set reauthenticated_at = ${confirmedAt.toISOString()}, idle_expires_at = ${now.toISOString()} where id = ${expiredSessionId}`;

    const state = `link-${randomUUID()}`;
    const browserBinding = `browser-${randomUUID()}`;
    await createOAuthTransaction(
      db,
      {
        id: randomUUID(),
        state,
        browserBinding,
        purpose: "link-identity",
        expiresAt: new Date(now.getTime() + 600_000),
        userId: actorId,
        sessionId: freshSessionId,
      },
      () => now,
    );
    await expect(
      consumeOAuthTransaction(db, { state, browserBinding }, () => now),
    ).resolves.toMatchObject({
      purpose: "link-identity",
      userId: actorId,
      sessionId: freshSessionId,
      currentMethodConfirmedAt: confirmedAt,
    });

    for (const sessionId of [missingSessionId, staleSessionId, expiredSessionId]) {
      const transactionId = randomUUID();
      await expect(
        createOAuthTransaction(
          db,
          {
            id: transactionId,
            state: `link-rejected-${randomUUID()}`,
            browserBinding,
            purpose: "link-identity",
            expiresAt: new Date(now.getTime() + 600_000),
            userId: actorId,
            sessionId,
          },
          () => now,
        ),
      ).rejects.toThrow(/fresh current-method proof required|active session required/);
      const [stored] =
        await client`select count(*)::int as count from oauth_transactions where id = ${transactionId}`;
      expect(stored?.count).toBe(0);
    }
  });

  it("creates an opaque candidate proof and allows exactly one bound concurrent consume", async () => {
    const issuedAt = new Date("2026-08-24T15:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actorId = randomUUID();
    const sessionId = randomUUID();
    const otherSessionId = randomUUID();
    const proofId = randomUUID();
    await seedSession({
      userId: actorId,
      sessionId,
      token: `proof-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await seedAdditionalSession({
      userId: actorId,
      sessionId: otherSessionId,
      token: `other-proof-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await createIdentityLinkProof(
      db,
      {
        id: proofId,
        actorId,
        sessionId,
        purpose: "link-identity",
        provider: "discord",
        providerSubject: "discord-candidate-42",
        displayName: "Candidate",
        expiresAt: new Date(now.getTime() + 600_000),
      },
      () => now,
    );
    await expect(
      findPendingIdentityLinkForSession(db, { actorId, sessionId, now }),
    ).resolves.toEqual({
      id: proofId,
      provider: "discord",
      displayIdentifier: "C***e",
    });
    await expect(
      findPendingIdentityLinkForSession(db, { actorId, sessionId: otherSessionId, now }),
    ).resolves.toBeNull();
    await expect(
      consumeIdentityLinkProof(
        db,
        { proofId, actorId, sessionId: otherSessionId, provider: "discord" },
        () => now,
      ),
    ).resolves.toBeNull();

    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const peerClient = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
    await peerClient.unsafe(`set search_path to ${quoteIdentifier(schemaName)}`);
    const peerDb = drizzle(peerClient, { schema });
    try {
      const results = await Promise.all([
        consumeIdentityLinkProof(
          db,
          { proofId, actorId, sessionId, provider: "discord" },
          () => now,
        ),
        consumeIdentityLinkProof(
          peerDb,
          { proofId, actorId, sessionId, provider: "discord" },
          () => now,
        ),
      ]);
      const winner = results.filter((result) => result !== null);
      expect(winner).toHaveLength(1);
      expect(winner[0]).toMatchObject({
        id: proofId,
        userId: actorId,
        sessionId,
        provider: "discord",
        providerSubject: "discord-candidate-42",
        displayName: "Candidate",
      });
    } finally {
      await peerClient.end({ timeout: 5 });
    }
    await expect(
      consumeIdentityLinkProof(db, { proofId, actorId, sessionId, provider: "discord" }, () => now),
    ).resolves.toBeNull();
    await expect(
      findPendingIdentityLinkForSession(db, { actorId, sessionId, now }),
    ).resolves.toBeNull();

    const expiredProofId = randomUUID();
    await createIdentityLinkProof(
      db,
      {
        id: expiredProofId,
        actorId,
        sessionId,
        purpose: "link-identity",
        provider: "discord",
        providerSubject: "expired-candidate",
        expiresAt: new Date(now.getTime() + 1_000),
      },
      () => now,
    );
    await expect(
      consumeIdentityLinkProof(
        db,
        { proofId: expiredProofId, actorId, sessionId, provider: "discord" },
        () => new Date(now.getTime() + 2_000),
      ),
    ).resolves.toBeNull();

    const [stored] = await client`
      select id, user_id, session_id, provider, provider_subject, display_name,
             expires_at, consumed_at, created_at
      from identity_link_proofs where id = ${proofId}
    `;
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      [
        "consumed_at",
        "created_at",
        "display_name",
        "expires_at",
        "id",
        "provider",
        "provider_subject",
        "session_id",
        "user_id",
      ].sort(),
    );
  }, 15_000);

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

  it("atomically replaces an OTP challenge and schedules its encrypted delivery", async () => {
    const now = new Date("2026-08-21T07:30:00.000Z");
    for (const failureStage of ["supersession", "challenge", "delivery", "outbox"] as const) {
      const emailDigest = `digest-${failureStage}-${randomUUID()}`;
      const originalId = randomUUID();
      await replaceAuthChallengeDigest(db, {
        id: originalId,
        emailDigest,
        purpose: "sign-in",
        codeDigest: `original-${failureStage}`,
        attemptsRemaining: 5,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        now,
      });

      const replacementId = randomUUID();
      const deliveryId = randomUUID();
      const outboxEventId = randomUUID();
      const request = {
        challenge: {
          id: replacementId,
          emailDigest,
          purpose: "sign-in" as const,
          codeDigest: `replacement-${failureStage}`,
          attemptsRemaining: 5,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
          now,
        },
        delivery: {
          id: deliveryId,
          template: "otp",
          recipient: "otp-rollback@example.test",
          idempotencyKey: `otp:${replacementId}`,
          encryptionKey: { version: "v1", key: Buffer.alloc(32, 17) },
          payload: { code: "12345678" },
          payloadExpiresAt: new Date(now.getTime() + 10 * 60_000),
          availableAt: now,
          outboxEventId,
          occurredAt: now,
        },
      };

      await expect(
        replaceAuthChallengeWithNotification(db, {
          ...request,
          afterMutation: (stage) => {
            if (stage === failureStage) throw new Error(`fail after ${stage}`);
          },
        }),
      ).rejects.toThrow(`fail after ${failureStage}`);

      const [rolledBack] = await client`
        select
          (select count(*)::int from auth_challenges where id = ${originalId} and superseded_at is null) as original_active,
          (select count(*)::int from auth_challenges where id = ${replacementId}) as replacements,
          (select count(*)::int from notification_deliveries where id = ${deliveryId}) as deliveries,
          (select count(*)::int from outbox_events where id = ${outboxEventId}) as outbox
      `;
      expect(rolledBack).toMatchObject({
        original_active: 1,
        replacements: 0,
        deliveries: 0,
        outbox: 0,
      });

      await replaceAuthChallengeWithNotification(db, request);
      const [committed] = await client`
        select
          (select count(*)::int from auth_challenges where email_digest = ${emailDigest} and superseded_at is null) as active,
          (select count(*)::int from notification_deliveries where id = ${deliveryId}) as deliveries,
          (select count(*)::int from outbox_events where id = ${outboxEventId}) as outbox
      `;
      expect(committed).toMatchObject({ active: 1, deliveries: 1, outbox: 1 });
    }
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

  async function seedSession(input: {
    userId: string;
    sessionId: string;
    token: string;
    trust: "provisional" | "trusted";
    now: Date;
  }): Promise<void> {
    const deviceId = randomUUID();
    await client`
      insert into users (id, display_name, created_at, updated_at)
      values (${input.userId}, 'OTP actor', ${input.now.toISOString()}, ${input.now.toISOString()})
    `;
    await client`
      insert into devices
        (id, user_id, device_digest, label, browser, operating_system, first_seen_at, last_seen_at)
      values
        (${deviceId}, ${input.userId}, ${identityDigests.opaque(`device:${deviceId}`)},
         'OTP device', 'Browser', 'OS', ${input.now.toISOString()}, ${input.now.toISOString()})
    `;
    const absoluteExpiresAt = new Date(
      input.now.getTime() + (input.trust === "trusted" ? 90 * 24 * 60 * 60_000 : 15 * 60_000),
    );
    const idleExpiresAt = new Date(
      input.now.getTime() + (input.trust === "trusted" ? 30 * 24 * 60 * 60_000 : 15 * 60_000),
    );
    await client`
      insert into sessions
        (id, user_id, device_id, token_digest, trust, issued_at, last_seen_at,
         idle_expires_at, absolute_expires_at, created_at, updated_at)
      values
        (${input.sessionId}, ${input.userId}, ${deviceId}, ${identityDigests.opaque(input.token)},
         ${input.trust}, ${input.now.toISOString()}, ${input.now.toISOString()},
         ${idleExpiresAt.toISOString()}, ${absoluteExpiresAt.toISOString()},
         ${input.now.toISOString()}, ${input.now.toISOString()})
    `;
  }

  async function seedAdditionalSession(input: {
    userId: string;
    sessionId: string;
    token: string;
    trust: "provisional" | "trusted";
    now: Date;
  }): Promise<void> {
    const deviceId = randomUUID();
    await client`
      insert into devices
        (id, user_id, device_digest, label, browser, operating_system, first_seen_at, last_seen_at)
      values
        (${deviceId}, ${input.userId}, ${identityDigests.opaque(`device:${deviceId}`)},
         'Additional OTP device', 'Browser', 'OS', ${input.now.toISOString()}, ${input.now.toISOString()})
    `;
    const absoluteExpiresAt = new Date(
      input.now.getTime() + (input.trust === "trusted" ? 90 * 24 * 60 * 60_000 : 15 * 60_000),
    );
    const idleExpiresAt = new Date(
      input.now.getTime() + (input.trust === "trusted" ? 30 * 24 * 60 * 60_000 : 15 * 60_000),
    );
    await client`
      insert into sessions
        (id, user_id, device_id, token_digest, trust, issued_at, last_seen_at,
         idle_expires_at, absolute_expires_at, created_at, updated_at)
      values
        (${input.sessionId}, ${input.userId}, ${deviceId}, ${identityDigests.opaque(input.token)},
         ${input.trust}, ${input.now.toISOString()}, ${input.now.toISOString()},
         ${idleExpiresAt.toISOString()}, ${absoluteExpiresAt.toISOString()},
         ${input.now.toISOString()}, ${input.now.toISOString()})
    `;
  }

  async function seedVerifiedEmailIdentity(input: {
    userId: string;
    email: string;
    now: Date;
  }): Promise<void> {
    const identityId = randomUUID();
    await client`
      insert into identities
        (id, user_id, provider, provider_subject, status, linked_at, verified_at)
      values
        (${identityId}, ${input.userId}, 'email', ${identityDigests.email(input.email)},
         'verified', ${input.now.toISOString()}, ${input.now.toISOString()})
    `;
    await client`
      insert into verified_emails
        (id, user_id, identity_id, normalized_email, verified_at, created_at)
      values
        (${randomUUID()}, ${input.userId}, ${identityId}, ${input.email.trim().toLowerCase()},
         ${input.now.toISOString()}, ${input.now.toISOString()})
    `;
  }

  it("never issues or consumes email step-up for an address owned by another actor", async () => {
    const issuedAt = new Date("2026-08-25T03:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const victimId = randomUUID();
    const victimSessionId = randomUUID();
    const attackerId = randomUUID();
    const attackerSessionId = randomUUID();
    const attackerEmail = `attacker-${randomUUID()}@example.test`;
    const requestChallengeId = randomUUID();
    const deliveryId = randomUUID();
    const outboxEventId = randomUUID();
    await seedSession({
      userId: victimId,
      sessionId: victimSessionId,
      token: `victim-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await seedSession({
      userId: attackerId,
      sessionId: attackerSessionId,
      token: `attacker-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await seedVerifiedEmailIdentity({ userId: attackerId, email: attackerEmail, now: issuedAt });

    await expect(
      replaceAuthChallengeWithNotification(db, {
        challenge: {
          id: requestChallengeId,
          emailDigest: identityDigests.email(attackerEmail),
          purpose: "step-up",
          codeDigest: "attacker-controlled-valid-digest",
          attemptsRemaining: 5,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
          now,
          actorId: victimId,
          sessionId: victimSessionId,
        },
        delivery: {
          id: deliveryId,
          template: "otp",
          recipient: attackerEmail,
          idempotencyKey: `otp:${requestChallengeId}`,
          encryptionKey: { version: "v1", key: Buffer.alloc(32, 19) },
          payload: { recipient: attackerEmail, code: "12345678" },
          payloadExpiresAt: new Date(now.getTime() + 10 * 60_000),
          availableAt: now,
          outboxEventId,
          occurredAt: now,
        },
      }),
    ).resolves.toBe(false);

    const historicalChallengeId = randomUUID();
    const hmacKey = Buffer.alloc(32, 23);
    await replaceAuthChallenge(
      db,
      {
        id: historicalChallengeId,
        email: attackerEmail,
        purpose: "step-up",
        code: "12345678",
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        actorId: victimId,
        sessionId: victimSessionId,
      },
      hmacKey,
      () => issuedAt,
    );
    await expect(
      completeOtpChallenge(db, {
        challengeId: historicalChallengeId,
        email: attackerEmail,
        purpose: "step-up",
        code: "12345678",
        hmacKey,
        actorId: victimId,
        sessionId: victimSessionId,
        now,
        ids: {
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          proofId: randomUUID(),
        },
      }),
    ).resolves.toEqual({ status: "rejected" });

    const [snapshot] = await client`
      select
        (select count(*)::int from auth_challenges where id = ${requestChallengeId}) as requested_challenges,
        (select count(*)::int from notification_deliveries where id = ${deliveryId}) as deliveries,
        (select count(*)::int from outbox_events where id = ${outboxEventId}) as outbox,
        (select consumed_at from auth_challenges where id = ${historicalChallengeId}) as historical_consumed_at,
        (select reauthenticated_at from sessions where id = ${victimSessionId}) as reauthenticated_at
    `;
    expect(snapshot).toEqual({
      requested_challenges: 0,
      deliveries: 0,
      outbox: 0,
      historical_consumed_at: null,
      reauthenticated_at: null,
    });
  }, 20_000);

  it("binds protected OTP consume to actor, session and purpose without mismatch mutation", async () => {
    const issuedAt = new Date("2026-08-21T10:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actorId = randomUUID();
    const sessionId = randomUUID();
    const otherSessionId = randomUUID();
    const hmacKey = Buffer.alloc(32, 31);
    const challengeId = randomUUID();
    await seedSession({
      userId: actorId,
      sessionId,
      token: "bound-old-token",
      trust: "trusted",
      now: issuedAt,
    });
    await seedVerifiedEmailIdentity({
      userId: actorId,
      email: "bound@example.test",
      now: issuedAt,
    });
    await seedSession({
      userId: randomUUID(),
      sessionId: otherSessionId,
      token: "other-actor-token",
      trust: "trusted",
      now: issuedAt,
    });
    await replaceAuthChallenge(
      db,
      {
        id: challengeId,
        email: "bound@example.test",
        purpose: "step-up",
        code: "12345678",
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        actorId,
        sessionId,
      },
      hmacKey,
      () => issuedAt,
    );

    await expect(
      completeOtpChallenge(db, {
        challengeId,
        email: "bound@example.test",
        purpose: "step-up",
        code: "12345678",
        hmacKey,
        actorId,
        sessionId: otherSessionId,
        now,
        ids: {
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          proofId: randomUUID(),
        },
        replacementSessionToken: "unused-replacement",
      }),
    ).resolves.toEqual({ status: "rejected" });
    const [unchanged] = await client`
      select consumed_at, attempts_remaining from auth_challenges where id = ${challengeId}
    `;
    expect(unchanged).toMatchObject({ consumed_at: null, attempts_remaining: 5 });

    await expect(
      completeOtpChallenge(db, {
        challengeId,
        email: "bound@example.test",
        purpose: "link-email",
        code: "12345678",
        hmacKey,
        actorId,
        sessionId,
        now,
        ids: {
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          proofId: randomUUID(),
        },
      }),
    ).resolves.toEqual({ status: "rejected" });

    await expect(
      completeOtpChallenge(db, {
        challengeId,
        email: "bound@example.test",
        purpose: "step-up",
        code: "12345678",
        hmacKey,
        actorId,
        sessionId,
        now,
        ids: {
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          proofId: randomUUID(),
        },
        replacementSessionToken: "unused-replacement",
      }),
    ).resolves.toMatchObject({ status: "step-up-confirmed", actorId, sessionId, confirmedAt: now });
    await expect(
      completeOtpChallenge(db, {
        challengeId,
        email: "bound@example.test",
        purpose: "step-up",
        code: "12345678",
        hmacKey,
        actorId,
        sessionId,
        now,
        ids: {
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          proofId: randomUUID(),
        },
        replacementSessionToken: "unused-replacement",
      }),
    ).resolves.toEqual({ status: "rejected" });
  }, 20_000);

  it("rolls back OTP consumption and email step-up together before one committed retry", async () => {
    const issuedAt = new Date("2026-08-25T04:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actorId = randomUUID();
    const sessionId = randomUUID();
    const email = `atomic-step-up-${randomUUID()}@example.test`;
    const challengeId = randomUUID();
    const hmacKey = Buffer.alloc(32, 29);
    await seedSession({
      userId: actorId,
      sessionId,
      token: `atomic-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await seedVerifiedEmailIdentity({ userId: actorId, email, now: issuedAt });
    await replaceAuthChallenge(
      db,
      {
        id: challengeId,
        email,
        purpose: "step-up",
        code: "12345678",
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        actorId,
        sessionId,
      },
      hmacKey,
      () => issuedAt,
    );
    const completion = {
      challengeId,
      email,
      purpose: "step-up" as const,
      code: "12345678",
      hmacKey,
      actorId,
      sessionId,
      now,
      ids: {
        userId: randomUUID(),
        identityId: randomUUID(),
        verifiedEmailId: randomUUID(),
        proofId: randomUUID(),
      },
    };

    await expect(
      completeOtpChallenge(db, {
        ...completion,
        afterMutation: (boundary) => {
          if (boundary === "challenge") throw new Error("fault before step-up commit");
        },
      }),
    ).rejects.toThrow("fault before step-up commit");
    const [rolledBack] = await client`
      select
        (select consumed_at from auth_challenges where id = ${challengeId}) as consumed_at,
        (select reauthenticated_at from sessions where id = ${sessionId}) as reauthenticated_at
    `;
    expect(rolledBack).toEqual({ consumed_at: null, reauthenticated_at: null });

    await expect(completeOtpChallenge(db, completion)).resolves.toMatchObject({
      status: "step-up-confirmed",
      actorId,
      sessionId,
      confirmedAt: now,
    });
    const [committed] = await client`
      select
        (select consumed_at from auth_challenges where id = ${challengeId}) as consumed_at,
        (select reauthenticated_at from sessions where id = ${sessionId}) as reauthenticated_at
    `;
    expect(new Date(committed?.consumed_at as string).toISOString()).toBe(now.toISOString());
    expect(new Date(committed?.reauthenticated_at as string).toISOString()).toBe(now.toISOString());
  }, 20_000);

  it("resolves concurrent first email sign-in once and never merges a Discord email coincidence", async () => {
    const now = new Date("2026-08-21T11:00:00.000Z");
    const email = `first-${randomUUID()}@example.test`;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const secondClient = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    await secondClient.unsafe(`set search_path to ${quoteIdentifier(schemaName)}`);
    const secondDb = drizzle(secondClient, { schema });
    try {
      const results = await Promise.all([
        resolveOrCreateEmailAccount(db, {
          email,
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          now,
        }),
        resolveOrCreateEmailAccount(secondDb, {
          email,
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          now,
        }),
      ]);
      expect(
        new Set(
          results.map((result) => (result.status === "conflict" ? "conflict" : result.userId)),
        ).size,
      ).toBe(1);
      const [counts] = await client`
        select
          count(*) filter (where provider = 'email' and provider_subject = ${identityDigests.email(email)})::int as identities,
          count(distinct user_id) filter (where provider = 'email' and provider_subject = ${identityDigests.email(email)})::int as users
        from identities
      `;
      expect(counts).toEqual({ identities: 1, users: 1 });
    } finally {
      await secondClient.end({ timeout: 5 });
    }

    const discordUserId = randomUUID();
    const discordIdentityId = randomUUID();
    const collisionEmail = `discord-${randomUUID()}@example.test`;
    await client`insert into users (id, display_name) values (${discordUserId}, 'Discord owner')`;
    await client`
      insert into identities (id, user_id, provider, provider_subject, status, verified_at)
      values (${discordIdentityId}, ${discordUserId}, 'discord', ${`discord-${randomUUID()}`}, 'verified', ${now.toISOString()})
    `;
    await client`
      insert into verified_emails (id, user_id, identity_id, normalized_email, verified_at)
      values (${randomUUID()}, ${discordUserId}, ${discordIdentityId}, ${collisionEmail}, ${now.toISOString()})
    `;
    await expect(
      resolveOrCreateEmailAccount(db, {
        email: collisionEmail,
        userId: randomUUID(),
        identityId: randomUUID(),
        verifiedEmailId: randomUUID(),
        now,
      }),
    ).resolves.toEqual({ status: "conflict" });
    const [discordCount] =
      await client`select count(*)::int as count from users where id = ${discordUserId}`;
    expect(discordCount?.count).toBe(1);
  }, 20_000);

  it("completes sign-in into an email account and protected link into a durable bound proof", async () => {
    const issuedAt = new Date("2026-08-21T11:30:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const hmacKey = Buffer.alloc(32, 37);
    const email = `complete-${randomUUID()}@example.test`;
    const signInChallengeId = randomUUID();
    const signInUserId = randomUUID();
    await replaceAuthChallenge(
      db,
      {
        id: signInChallengeId,
        email,
        purpose: "sign-in",
        code: "13572468",
        expiresAt: new Date(now.getTime() + 600_000),
      },
      hmacKey,
      () => issuedAt,
    );
    await expect(
      completeOtpChallenge(db, {
        challengeId: signInChallengeId,
        email,
        purpose: "sign-in",
        code: "13572468",
        hmacKey,
        now,
        ids: {
          userId: signInUserId,
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          proofId: randomUUID(),
        },
      }),
    ).resolves.toEqual({ status: "authenticated", userId: signInUserId });

    const actorId = randomUUID();
    const sessionId = randomUUID();
    const proofId = randomUUID();
    const linkChallengeId = randomUUID();
    await seedSession({
      userId: actorId,
      sessionId,
      token: `link-${randomUUID()}`,
      trust: "trusted",
      now: issuedAt,
    });
    await replaceAuthChallenge(
      db,
      {
        id: linkChallengeId,
        email,
        purpose: "link-email",
        code: "24681357",
        expiresAt: new Date(now.getTime() + 600_000),
        actorId,
        sessionId,
      },
      hmacKey,
      () => issuedAt,
    );
    await expect(
      completeOtpChallenge(db, {
        challengeId: linkChallengeId,
        email,
        purpose: "link-email",
        code: "24681357",
        hmacKey,
        actorId,
        sessionId,
        now,
        ids: {
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          proofId,
        },
      }),
    ).resolves.toEqual({ status: "identity-link-ready", proofId, actorId, sessionId });
    const [proof] = await client`
      select user_id, session_id, provider, provider_subject, consumed_at
      from identity_link_proofs where id = ${proofId}
    `;
    expect(proof).toEqual({
      user_id: actorId,
      session_id: sessionId,
      provider: "email",
      provider_subject: identityDigests.email(email),
      consumed_at: null,
    });
  }, 15_000);

  it("atomically promotes a bound provisional Discord session and revokes every other session", async () => {
    const issuedAt = new Date("2026-08-21T12:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actorId = randomUUID();
    const currentSessionId = randomUUID();
    const otherSessionId = randomUUID();
    const oldToken = `old-${randomUUID()}`;
    const otherToken = `other-${randomUUID()}`;
    const replacementToken = `replacement-${randomUUID()}`;
    const email = `promote-${randomUUID()}@example.test`;
    const hmacKey = Buffer.alloc(32, 41);
    const challengeId = randomUUID();
    await seedSession({
      userId: actorId,
      sessionId: currentSessionId,
      token: oldToken,
      trust: "provisional",
      now: issuedAt,
    });
    await seedAdditionalSession({
      userId: actorId,
      sessionId: otherSessionId,
      token: otherToken,
      trust: "trusted",
      now: issuedAt,
    });
    await replaceAuthChallenge(
      db,
      {
        id: challengeId,
        email,
        purpose: "verify-provisional-email",
        code: "87654321",
        expiresAt: new Date(now.getTime() + 600_000),
        actorId,
        sessionId: currentSessionId,
      },
      hmacKey,
      () => issuedAt,
    );

    await expect(
      completeOtpChallenge(db, {
        challengeId,
        email,
        purpose: "verify-provisional-email",
        code: "87654321",
        hmacKey,
        actorId,
        sessionId: currentSessionId,
        now,
        ids: {
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          proofId: randomUUID(),
        },
        replacementSessionToken: replacementToken,
      }),
    ).resolves.toEqual({
      status: "provisional-email-verified",
      userId: actorId,
      sessionId: currentSessionId,
      sessionToken: replacementToken,
      trust: "trusted",
    });

    await expect(resolveSession(db, oldToken, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, otherToken, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, replacementToken, () => now)).resolves.toMatchObject({
      trust: "trusted",
      session: { id: currentSessionId, userId: actorId, reauthenticatedAt: now },
    });
    const [linked] = await client`
      select i.user_id, i.provider_subject, e.normalized_email, c.consumed_at
      from identities i
      join verified_emails e on e.identity_id = i.id
      join auth_challenges c on c.id = ${challengeId}
      where i.provider = 'email' and i.provider_subject = ${identityDigests.email(email)}
    `;
    expect(linked).toMatchObject({
      user_id: actorId,
      provider_subject: identityDigests.email(email),
      normalized_email: email,
    });
    expect(linked?.consumed_at).not.toBeNull();
  }, 15_000);

  it.each(["challenge", "identity", "trust", "token", "revocation"] as const)(
    "rolls the full provisional promotion back after the %s boundary",
    async (boundary) => {
      const issuedAt = new Date("2026-08-21T13:00:00.000Z");
      const now = new Date(issuedAt.getTime() + 60_000);
      const actorId = randomUUID();
      const sessionId = randomUUID();
      const otherSessionId = randomUUID();
      const oldToken = `rollback-old-${randomUUID()}`;
      const otherToken = `rollback-other-${randomUUID()}`;
      const replacementToken = `rollback-new-${randomUUID()}`;
      const email = `rollback-${randomUUID()}@example.test`;
      const challengeId = randomUUID();
      const hmacKey = Buffer.alloc(32, 51);
      await seedSession({
        userId: actorId,
        sessionId,
        token: oldToken,
        trust: "provisional",
        now: issuedAt,
      });
      await seedAdditionalSession({
        userId: actorId,
        sessionId: otherSessionId,
        token: otherToken,
        trust: "trusted",
        now: issuedAt,
      });
      await replaceAuthChallenge(
        db,
        {
          id: challengeId,
          email,
          purpose: "verify-provisional-email",
          code: "11223344",
          expiresAt: new Date(now.getTime() + 600_000),
          actorId,
          sessionId,
        },
        hmacKey,
        () => issuedAt,
      );

      await expect(
        completeOtpChallenge(db, {
          challengeId,
          email,
          purpose: "verify-provisional-email",
          code: "11223344",
          hmacKey,
          actorId,
          sessionId,
          now,
          ids: {
            userId: randomUUID(),
            identityId: randomUUID(),
            verifiedEmailId: randomUUID(),
            proofId: randomUUID(),
          },
          replacementSessionToken: replacementToken,
          afterMutation: (completed) => {
            if (completed === boundary) throw new Error(`injected-${boundary}`);
          },
        }),
      ).rejects.toThrow(`injected-${boundary}`);

      const [state] = await client`
        select c.consumed_at, s.token_digest, s.trust, s.reauthenticated_at, s.revoked_at,
          (select count(*)::int from identities i where i.provider = 'email' and i.provider_subject = ${identityDigests.email(email)}) as email_identities
        from auth_challenges c
        join sessions s on s.id = ${sessionId}
        where c.id = ${challengeId}
      `;
      expect(state).toMatchObject({
        consumed_at: null,
        token_digest: identityDigests.opaque(oldToken),
        trust: "provisional",
        reauthenticated_at: null,
        revoked_at: null,
        email_identities: 0,
      });
      await expect(resolveSession(db, oldToken, () => now)).resolves.not.toBeNull();
      await expect(resolveSession(db, otherToken, () => now)).resolves.not.toBeNull();
      await expect(resolveSession(db, replacementToken, () => now)).resolves.toBeNull();
    },
    15_000,
  );

  it("rejects already-trusted, email-conflict and token-collision promotion without consuming proof", async () => {
    const issuedAt = new Date("2026-08-21T14:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const hmacKey = Buffer.alloc(32, 61);

    for (const failure of ["already-trusted", "email-conflict", "token-collision"] as const) {
      const actorId = randomUUID();
      const sessionId = randomUUID();
      const oldToken = `${failure}-old-${randomUUID()}`;
      const replacementToken = `${failure}-new-${randomUUID()}`;
      const email = `${failure}-${randomUUID()}@example.test`;
      const challengeId = randomUUID();
      await seedSession({
        userId: actorId,
        sessionId,
        token: oldToken,
        trust: failure === "already-trusted" ? "trusted" : "provisional",
        now: issuedAt,
      });

      if (failure === "email-conflict") {
        await resolveOrCreateEmailAccount(db, {
          email,
          userId: randomUUID(),
          identityId: randomUUID(),
          verifiedEmailId: randomUUID(),
          now: issuedAt,
        });
      }
      if (failure === "token-collision") {
        await seedSession({
          userId: randomUUID(),
          sessionId: randomUUID(),
          token: replacementToken,
          trust: "trusted",
          now: issuedAt,
        });
      }
      await replaceAuthChallenge(
        db,
        {
          id: challengeId,
          email,
          purpose: "verify-provisional-email",
          code: "44332211",
          expiresAt: new Date(now.getTime() + 600_000),
          actorId,
          sessionId,
        },
        hmacKey,
        () => issuedAt,
      );

      await expect(
        completeOtpChallenge(db, {
          challengeId,
          email,
          purpose: "verify-provisional-email",
          code: "44332211",
          hmacKey,
          actorId,
          sessionId,
          now,
          ids: {
            userId: randomUUID(),
            identityId: randomUUID(),
            verifiedEmailId: randomUUID(),
            proofId: randomUUID(),
          },
          replacementSessionToken: replacementToken,
        }),
      ).resolves.toEqual({ status: "rejected" });

      const [state] = await client`
        select c.consumed_at, s.token_digest, s.trust, s.reauthenticated_at
        from auth_challenges c join sessions s on s.id = ${sessionId}
        where c.id = ${challengeId}
      `;
      expect(state).toMatchObject({
        consumed_at: null,
        token_digest: identityDigests.opaque(oldToken),
        trust: failure === "already-trusted" ? "trusted" : "provisional",
        reauthenticated_at: null,
      });
      await expect(resolveSession(db, oldToken, () => now)).resolves.not.toBeNull();
      if (failure !== "token-collision") {
        await expect(resolveSession(db, replacementToken, () => now)).resolves.toBeNull();
      }
    }
  }, 20_000);
});
