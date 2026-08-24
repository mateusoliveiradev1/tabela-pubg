import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  executeIdentitySecurityChange,
  type IdentitySecurityChangeBoundary,
  type IdentitySecurityChangeInput,
} from "../src/repositories/identity-security-change.js";
import { createIdentityLinkProof, identityDigests } from "../src/repositories/identity.js";
import { resolveSession } from "../src/repositories/sessions.js";
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
    for (const statement of isolated
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await client.unsafe(statement);
    }
  }
}

type Database = PostgresJsDatabase<typeof schema>;

interface SeededActor {
  actorId: string;
  currentSessionId: string;
  otherSessionId: string;
  oldCurrentToken: string;
  otherToken: string;
}

describe("identity security change transaction", () => {
  let client: Sql;
  let db: Database;
  let schemaName: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for identity security change integration tests");
    }
    schemaName = `phase2_identity_security_change_${process.pid}_${randomBytes(6).toString("hex")}`;
    client = postgres(databaseUrl, {
      max: 4,
      connect_timeout: 5,
      prepare: false,
      onnotice: () => undefined,
    });
    await applyMigrations(client, schemaName);
    db = drizzle(client, { schema });
  }, 30_000);

  afterAll(async () => {
    if (client) {
      if (!schemaName?.startsWith("phase2_identity_security_change_")) {
        throw new Error("refusing to clean an unowned PostgreSQL schema");
      }
      await client.unsafe("set search_path to public");
      await client.unsafe(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
      await client.end({ timeout: 5 });
    }
  }, 30_000);

  async function seedActor(now: Date): Promise<SeededActor> {
    const actorId = randomUUID();
    const currentSessionId = randomUUID();
    const otherSessionId = randomUUID();
    const currentDeviceId = randomUUID();
    const otherDeviceId = randomUUID();
    const oldCurrentToken = `old-current-${randomUUID()}`;
    const otherToken = `old-other-${randomUUID()}`;
    const absoluteExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60_000);
    const idleExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    await client`
      insert into users (id, display_name, created_at, updated_at)
      values (${actorId}, 'Identity actor', ${now.toISOString()}, ${now.toISOString()})
    `;
    await client`
      insert into devices
        (id, user_id, device_digest, label, browser, operating_system, first_seen_at, last_seen_at)
      values
        (${currentDeviceId}, ${actorId}, ${identityDigests.opaque(`device:${currentDeviceId}`)},
         'Current device', 'Browser', 'OS', ${now.toISOString()}, ${now.toISOString()}),
        (${otherDeviceId}, ${actorId}, ${identityDigests.opaque(`device:${otherDeviceId}`)},
         'Other device', 'Browser', 'OS', ${now.toISOString()}, ${now.toISOString()})
    `;
    await client`
      insert into sessions
        (id, user_id, device_id, token_digest, trust, issued_at, last_seen_at,
         idle_expires_at, absolute_expires_at, created_at, updated_at)
      values
        (${currentSessionId}, ${actorId}, ${currentDeviceId},
         ${identityDigests.opaque(oldCurrentToken)}, 'trusted', ${now.toISOString()},
         ${now.toISOString()}, ${idleExpiresAt.toISOString()}, ${absoluteExpiresAt.toISOString()},
         ${now.toISOString()}, ${now.toISOString()}),
        (${otherSessionId}, ${actorId}, ${otherDeviceId}, ${identityDigests.opaque(otherToken)},
         'trusted', ${now.toISOString()}, ${now.toISOString()}, ${idleExpiresAt.toISOString()},
         ${absoluteExpiresAt.toISOString()}, ${now.toISOString()}, ${now.toISOString()})
    `;
    return { actorId, currentSessionId, otherSessionId, oldCurrentToken, otherToken };
  }

  async function seedDiscordProof(
    actor: SeededActor,
    now: Date,
    options: {
      proofId?: string;
      purpose?: "link-identity" | "link-email" | "change-email";
      sessionId?: string;
      subject?: string;
      expiresAt?: Date;
    } = {},
  ): Promise<{ proofId: string; subject: string }> {
    const proofId = options.proofId ?? randomUUID();
    const subject = options.subject ?? `discord-${randomUUID()}`;
    await createIdentityLinkProof(
      db,
      {
        id: proofId,
        actorId: actor.actorId,
        sessionId: options.sessionId ?? actor.currentSessionId,
        purpose: options.purpose ?? "link-identity",
        provider: "discord",
        providerSubject: subject,
        displayName: "Linked Discord",
        expiresAt: options.expiresAt ?? new Date(now.getTime() + 10 * 60_000),
      },
      () => now,
    );
    return { proofId, subject };
  }

  async function seedEmailProof(
    actor: SeededActor,
    now: Date,
    purpose: "link-email" | "change-email",
    email: string,
  ): Promise<string> {
    const proofId = randomUUID();
    await createIdentityLinkProof(
      db,
      {
        id: proofId,
        actorId: actor.actorId,
        sessionId: actor.currentSessionId,
        purpose,
        provider: "email",
        providerSubject: identityDigests.email(email),
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      },
      () => now,
    );
    return proofId;
  }

  async function seedCurrentEmail(actorId: string, now: Date, email: string) {
    const identityId = randomUUID();
    const verifiedEmailId = randomUUID();
    await client`
      insert into identities
        (id, user_id, provider, provider_subject, status, linked_at, verified_at)
      values (${identityId}, ${actorId}, 'email', ${identityDigests.email(email)}, 'verified',
              ${now.toISOString()}, ${now.toISOString()})
    `;
    await client`
      insert into verified_emails
        (id, user_id, identity_id, normalized_email, verified_at, created_at)
      values (${verifiedEmailId}, ${actorId}, ${identityId}, ${email}, ${now.toISOString()},
              ${now.toISOString()})
    `;
    return { identityId, verifiedEmailId };
  }

  function replacementToken(byte: number): string {
    return Buffer.alloc(32, byte).toString("base64url");
  }

  function commandInput(
    actor: SeededActor,
    proofId: string,
    now: Date,
    change: IdentitySecurityChangeInput["change"],
    byte: number,
    afterMutation?: (boundary: IdentitySecurityChangeBoundary) => void | Promise<void>,
  ): IdentitySecurityChangeInput {
    return {
      database: db,
      actorId: actor.actorId,
      currentSessionId: actor.currentSessionId,
      proofId,
      change,
      now,
      generateId: randomUUID,
      generateCorrelationId: randomUUID,
      generateOpaqueToken: () => Buffer.alloc(32, byte),
      ...(afterMutation === undefined ? {} : { afterMutation }),
    };
  }

  async function actorSnapshot(actorId: string, proofId: string): Promise<string> {
    const [proofs, identities, emails, sessions, events] = await Promise.all([
      client`
        select id, user_id, session_id, purpose, provider, provider_subject, display_name,
               expires_at, consumed_at, created_at
        from identity_link_proofs where id = ${proofId} order by id
      `,
      client`
        select id, user_id, provider, provider_subject, status, display_name, linked_at,
               verified_at, revoked_at
        from identities where user_id = ${actorId} order by id
      `,
      client`
        select id, user_id, identity_id, normalized_email, verified_at, revoked_at, created_at
        from verified_emails where user_id = ${actorId} order by id
      `,
      client`
        select id, user_id, device_id, token_digest, trust, issued_at, last_seen_at,
               idle_expires_at, absolute_expires_at, reauthenticated_at, revoked_at,
               revocation_reason, created_at, updated_at
        from sessions where user_id = ${actorId} order by id
      `,
      client`
        select id, event_type, event_version, aggregate_type, aggregate_id, payload,
               correlation_id, causation_id, status, attempts, available_at, occurred_at,
               published_at, claim_token, lease_expires_at, last_error, created_at
        from outbox_events where aggregate_id = ${actorId} order by id
      `,
    ]);
    return JSON.stringify({ proofs, identities, emails, sessions, events });
  }

  it("commits a Discord identity link, current-token rotation, revoke-others and redacted evidence together", async () => {
    const issuedAt = new Date("2026-08-24T12:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actor = await seedActor(issuedAt);
    const proof = await seedDiscordProof(actor, issuedAt);
    const result = await executeIdentitySecurityChange(
      commandInput(
        actor,
        proof.proofId,
        now,
        {
          type: "link-identity",
          provider: "discord",
          providerSubject: proof.subject,
          displayName: "Linked Discord",
        },
        71,
      ),
    );

    expect(result).toEqual({
      sessionId: actor.currentSessionId,
      newSessionToken: replacementToken(71),
      revokedOtherSessions: 1,
    });
    await expect(resolveSession(db, actor.oldCurrentToken, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, actor.otherToken, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, result.newSessionToken, () => now)).resolves.toMatchObject({
      trust: "trusted",
      session: {
        id: actor.currentSessionId,
        userId: actor.actorId,
        reauthenticatedAt: now,
      },
    });
    const [state] = await client`
      select
        (select consumed_at from identity_link_proofs where id = ${proof.proofId}) as consumed_at,
        (select count(*)::int from identities where user_id = ${actor.actorId}
          and provider = 'discord' and provider_subject = ${proof.subject}) as identities,
        (select count(*)::int from outbox_events where aggregate_id = ${actor.actorId}
          and event_type = 'identity.security-state-changed') as events
    `;
    expect(state).toMatchObject({ identities: 1, events: 1 });
    expect(state?.consumed_at).not.toBeNull();
    const [event] = await client`
      select payload from outbox_events where aggregate_id = ${actor.actorId}
        and event_type = 'identity.security-state-changed'
    `;
    expect(event?.payload).toEqual({
      actorId: actor.actorId,
      sessionId: actor.currentSessionId,
      changeType: "link-identity",
      provider: "discord",
      trust: "trusted",
      revokedOtherSessions: 1,
    });
    expect(JSON.stringify(event)).not.toContain(proof.subject);
    expect(JSON.stringify(event)).not.toContain(result.newSessionToken);
  }, 15_000);

  it("commits an ordinary email replacement without creating or merging another identity", async () => {
    const issuedAt = new Date("2026-08-24T13:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actor = await seedActor(issuedAt);
    const oldEmail = `old-${randomUUID()}@example.test`;
    const newEmail = `new-${randomUUID()}@example.test`;
    const current = await seedCurrentEmail(actor.actorId, issuedAt, oldEmail);
    const proofId = await seedEmailProof(actor, issuedAt, "change-email", newEmail);
    const result = await executeIdentitySecurityChange(
      commandInput(
        actor,
        proofId,
        now,
        { type: "change-email", identityId: current.identityId, email: newEmail.toUpperCase() },
        72,
      ),
    );

    const identityRows = await client`
      select id, provider_subject from identities where user_id = ${actor.actorId}
    `;
    const emailRows = await client`
      select id, identity_id, normalized_email from verified_emails where user_id = ${actor.actorId}
    `;
    expect(identityRows).toEqual([
      { id: current.identityId, provider_subject: identityDigests.email(newEmail) },
    ]);
    expect(emailRows).toEqual([
      { id: current.verifiedEmailId, identity_id: current.identityId, normalized_email: newEmail },
    ]);
    await expect(resolveSession(db, actor.oldCurrentToken, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, actor.otherToken, () => now)).resolves.toBeNull();
    await expect(resolveSession(db, result.newSessionToken, () => now)).resolves.toMatchObject({
      trust: "trusted",
      session: { id: actor.currentSessionId, reauthenticatedAt: now },
    });
    const [event] = await client`
      select payload from outbox_events where aggregate_id = ${actor.actorId}
        and event_type = 'identity.security-state-changed'
    `;
    expect(event?.payload).toMatchObject({ changeType: "change-email", provider: "email" });
    expect(JSON.stringify(event)).not.toContain(oldEmail);
    expect(JSON.stringify(event)).not.toContain(newEmail);
  }, 15_000);

  it.each([
    "proof-consumed",
    "identity-mutated",
    "current-session-rotated",
    "other-sessions-revoked",
    "evidence-appended",
  ] as const)(
    "rolls every durable row back after the %s boundary",
    async (boundary) => {
      const issuedAt = new Date("2026-08-24T14:00:00.000Z");
      const now = new Date(issuedAt.getTime() + 60_000);
      const actor = await seedActor(issuedAt);
      const proof = await seedDiscordProof(actor, issuedAt);
      const before = await actorSnapshot(actor.actorId, proof.proofId);
      await expect(
        executeIdentitySecurityChange(
          commandInput(
            actor,
            proof.proofId,
            now,
            {
              type: "link-identity",
              provider: "discord",
              providerSubject: proof.subject,
              displayName: "Linked Discord",
            },
            73,
            (completed) => {
              if (completed === boundary) throw new Error(`injected-${boundary}`);
            },
          ),
        ),
      ).rejects.toThrow(`injected-${boundary}`);
      expect(await actorSnapshot(actor.actorId, proof.proofId)).toBe(before);
      await expect(resolveSession(db, actor.oldCurrentToken, () => now)).resolves.not.toBeNull();
      await expect(resolveSession(db, actor.otherToken, () => now)).resolves.not.toBeNull();
      await expect(resolveSession(db, replacementToken(73), () => now)).resolves.toBeNull();
    },
    15_000,
  );

  it("rejects wrong actor and wrong current session without consuming the bound proof", async () => {
    const issuedAt = new Date("2026-08-24T15:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actor = await seedActor(issuedAt);
    const wrongActor = await seedActor(issuedAt);
    const proof = await seedDiscordProof(actor, issuedAt);
    const before = await actorSnapshot(actor.actorId, proof.proofId);
    const change = {
      type: "link-identity" as const,
      provider: "discord" as const,
      providerSubject: proof.subject,
      displayName: "Linked Discord",
    };
    await expect(
      executeIdentitySecurityChange(commandInput(wrongActor, proof.proofId, now, change, 74)),
    ).rejects.toThrow("identity security change rejected");
    await expect(
      executeIdentitySecurityChange({
        ...commandInput(actor, proof.proofId, now, change, 75),
        currentSessionId: actor.otherSessionId,
      }),
    ).rejects.toThrow("identity security change rejected");
    expect(await actorSnapshot(actor.actorId, proof.proofId)).toBe(before);
  });

  it("rejects stale, purpose-mismatched and candidate-mismatched proofs before durable mutation", async () => {
    const issuedAt = new Date("2026-08-24T16:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    for (const mismatch of ["stale", "purpose", "candidate"] as const) {
      const actor = await seedActor(issuedAt);
      const proof = await seedDiscordProof(actor, issuedAt, {
        purpose: mismatch === "purpose" ? "change-email" : "link-identity",
        expiresAt:
          mismatch === "stale" ? new Date(now.getTime() - 1) : new Date(now.getTime() + 600_000),
      });
      const before = await actorSnapshot(actor.actorId, proof.proofId);
      await expect(
        executeIdentitySecurityChange(
          commandInput(
            actor,
            proof.proofId,
            now,
            {
              type: "link-identity",
              provider: "discord",
              providerSubject: mismatch === "candidate" ? "wrong-subject" : proof.subject,
              displayName: "Linked Discord",
            },
            76,
          ),
        ),
      ).rejects.toThrow("identity security change rejected");
      expect(await actorSnapshot(actor.actorId, proof.proofId)).toBe(before);
      await expect(resolveSession(db, replacementToken(76), () => now)).resolves.toBeNull();
    }
  });

  it("rejects replay without a second identity, event or session mutation", async () => {
    const issuedAt = new Date("2026-08-24T17:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actor = await seedActor(issuedAt);
    const proof = await seedDiscordProof(actor, issuedAt);
    const change = {
      type: "link-identity" as const,
      provider: "discord" as const,
      providerSubject: proof.subject,
      displayName: "Linked Discord",
    };
    await executeIdentitySecurityChange(commandInput(actor, proof.proofId, now, change, 77));
    const committed = await actorSnapshot(actor.actorId, proof.proofId);
    await expect(
      executeIdentitySecurityChange(commandInput(actor, proof.proofId, now, change, 78)),
    ).rejects.toThrow("identity security change rejected");
    expect(await actorSnapshot(actor.actorId, proof.proofId)).toBe(committed);
    await expect(resolveSession(db, replacementToken(78), () => now)).resolves.toBeNull();
    const [counts] = await client`
      select
        (select count(*)::int from identities where user_id = ${actor.actorId}
          and provider = 'discord' and provider_subject = ${proof.subject}) as identities,
        (select count(*)::int from outbox_events where aggregate_id = ${actor.actorId}
          and event_type = 'identity.security-state-changed') as events
    `;
    expect(counts).toEqual({ identities: 1, events: 1 });
  });

  it("allows exactly one concurrent proof consumer and only its replacement token resolves", async () => {
    const issuedAt = new Date("2026-08-24T18:00:00.000Z");
    const now = new Date(issuedAt.getTime() + 60_000);
    const actor = await seedActor(issuedAt);
    const proof = await seedDiscordProof(actor, issuedAt);
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const peerClient = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    await peerClient.unsafe(`set search_path to ${quoteIdentifier(schemaName)}`);
    const peerDb = drizzle(peerClient, { schema });
    const change = {
      type: "link-identity" as const,
      provider: "discord" as const,
      providerSubject: proof.subject,
      displayName: "Linked Discord",
    };
    try {
      const settled = await Promise.allSettled([
        executeIdentitySecurityChange(commandInput(actor, proof.proofId, now, change, 79)),
        executeIdentitySecurityChange({
          ...commandInput(actor, proof.proofId, now, change, 80),
          database: peerDb,
        }),
      ]);
      const winners = settled.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof executeIdentitySecurityChange>>
        > => result.status === "fulfilled",
      );
      expect(winners).toHaveLength(1);
      expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
      const winningToken = winners[0]?.value.newSessionToken;
      expect([replacementToken(79), replacementToken(80)]).toContain(winningToken);
      const losingToken =
        winningToken === replacementToken(79) ? replacementToken(80) : replacementToken(79);
      if (!winningToken) throw new Error("concurrent command did not return a winning token");
      await expect(resolveSession(db, winningToken, () => now)).resolves.toMatchObject({
        session: { id: actor.currentSessionId, userId: actor.actorId },
      });
      await expect(resolveSession(db, losingToken, () => now)).resolves.toBeNull();
      const [counts] = await client`
        select
          (select count(*)::int from identities where user_id = ${actor.actorId}
            and provider = 'discord' and provider_subject = ${proof.subject}) as identities,
          (select count(*)::int from outbox_events where aggregate_id = ${actor.actorId}
            and event_type = 'identity.security-state-changed') as events
      `;
      expect(counts).toEqual({ identities: 1, events: 1 });
    } finally {
      await peerClient.end({ timeout: 5 });
    }
  }, 20_000);
});
