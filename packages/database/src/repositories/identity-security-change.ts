import type { EventEnvelope } from "@pubg-camp/contracts";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { appendOutboxEvent } from "../outbox.js";
import type * as databaseSchema from "../schema.js";
import { identities, identityLinkProofs, verifiedEmails } from "../schema.js";
import { consumeIdentityLinkProof, identityDigests } from "./identity.js";
import { lockActiveSessionForOtp, revokeOtherSessions, rotateIdentitySession } from "./sessions.js";

type Database = PostgresJsDatabase<typeof databaseSchema>;
type IdentityProvider = "discord" | "email";

export type IdentitySecurityChange =
  | {
      type: "link-identity";
      provider: "discord";
      providerSubject: string;
      displayName?: string;
    }
  | { type: "link-identity"; provider: "email"; email: string }
  | { type: "change-email"; identityId: string; email: string };

export type IdentitySecurityChangeBoundary =
  | "proof-consumed"
  | "identity-mutated"
  | "current-session-rotated"
  | "other-sessions-revoked"
  | "evidence-appended";

export interface IdentitySecurityChangeInput {
  database: Database;
  actorId: string;
  currentSessionId: string;
  proofId: string;
  change: IdentitySecurityChange;
  now: Date;
  generateId: () => string;
  generateCorrelationId: () => string;
  generateOpaqueToken: () => Uint8Array;
  afterMutation?: (boundary: IdentitySecurityChangeBoundary) => void | Promise<void>;
}

export interface IdentitySecurityChangeResult {
  sessionId: string;
  newSessionToken: string;
  revokedOtherSessions: number;
}

export interface IdentitySecurityChangePort {
  execute(input: IdentitySecurityChangeInput): Promise<IdentitySecurityChangeResult>;
}

interface ExpectedProof {
  purpose: "link-identity" | "link-email" | "change-email";
  provider: IdentityProvider;
  providerSubject: string;
  displayName?: string;
  normalizedEmail?: string;
}

const identitySecurityChangeRejected = Symbol("identity-security-change-rejected");

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw identitySecurityChangeRejected;
  }
  return normalized;
}

function expectedProof(change: IdentitySecurityChange): ExpectedProof {
  if (change.type === "change-email") {
    const normalizedEmail = normalizeEmail(change.email);
    return {
      purpose: "change-email",
      provider: "email",
      providerSubject: identityDigests.email(normalizedEmail),
      normalizedEmail,
    };
  }
  if (change.provider === "email") {
    const normalizedEmail = normalizeEmail(change.email);
    return {
      purpose: "link-email",
      provider: "email",
      providerSubject: identityDigests.email(normalizedEmail),
      normalizedEmail,
    };
  }
  if (!change.providerSubject.trim()) throw identitySecurityChangeRejected;
  return {
    purpose: "link-identity",
    provider: "discord",
    providerSubject: change.providerSubject,
    ...(change.displayName === undefined ? {} : { displayName: change.displayName }),
  };
}

function encodeOpaqueToken(bytes: Uint8Array): string {
  if (bytes.byteLength !== 32) {
    throw new Error("identity security replacement token must contain exactly 32 random bytes");
  }
  return Buffer.from(bytes).toString("base64url");
}

async function lockAndValidateProof(
  executor: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: IdentitySecurityChangeInput,
  expected: ExpectedProof,
): Promise<void> {
  const [proof] = await executor
    .select()
    .from(identityLinkProofs)
    .where(
      and(
        eq(identityLinkProofs.id, input.proofId),
        eq(identityLinkProofs.userId, input.actorId),
        eq(identityLinkProofs.sessionId, input.currentSessionId),
        eq(identityLinkProofs.purpose, expected.purpose),
        eq(identityLinkProofs.provider, expected.provider),
        eq(identityLinkProofs.providerSubject, expected.providerSubject),
        isNull(identityLinkProofs.consumedAt),
        gt(identityLinkProofs.expiresAt, input.now),
      ),
    )
    .for("update")
    .limit(1);
  if (!proof || (proof.displayName ?? undefined) !== expected.displayName) {
    throw identitySecurityChangeRejected;
  }
}

async function applyIdentityMutation(
  executor: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: IdentitySecurityChangeInput,
  expected: ExpectedProof,
  generatedIdentityId: string,
  generatedVerifiedEmailId: string,
): Promise<void> {
  if (input.change.type === "link-identity") {
    const [identity] = await executor
      .insert(identities)
      .values({
        id: generatedIdentityId,
        userId: input.actorId,
        provider: expected.provider,
        providerSubject: expected.providerSubject,
        status: "verified",
        linkedAt: input.now,
        verifiedAt: input.now,
        ...(expected.displayName === undefined ? {} : { displayName: expected.displayName }),
      })
      .returning({ id: identities.id });
    if (!identity) throw identitySecurityChangeRejected;
    if (expected.provider === "email") {
      const [email] = await executor
        .insert(verifiedEmails)
        .values({
          id: generatedVerifiedEmailId,
          userId: input.actorId,
          identityId: identity.id,
          normalizedEmail: expected.normalizedEmail as string,
          verifiedAt: input.now,
          createdAt: input.now,
        })
        .returning({ id: verifiedEmails.id });
      if (!email) throw identitySecurityChangeRejected;
    }
    return;
  }

  const [identity] = await executor
    .update(identities)
    .set({
      providerSubject: expected.providerSubject,
      verifiedAt: input.now,
    })
    .where(
      and(
        eq(identities.id, input.change.identityId),
        eq(identities.userId, input.actorId),
        eq(identities.provider, "email"),
        eq(identities.status, "verified"),
        isNull(identities.revokedAt),
      ),
    )
    .returning({ id: identities.id });
  if (!identity) throw identitySecurityChangeRejected;
  const [email] = await executor
    .update(verifiedEmails)
    .set({ normalizedEmail: expected.normalizedEmail as string, verifiedAt: input.now })
    .where(
      and(
        eq(verifiedEmails.userId, input.actorId),
        eq(verifiedEmails.identityId, identity.id),
        isNull(verifiedEmails.revokedAt),
      ),
    )
    .returning({ id: verifiedEmails.id });
  if (!email) throw identitySecurityChangeRejected;
}

export async function executeIdentitySecurityChange(
  input: IdentitySecurityChangeInput,
): Promise<IdentitySecurityChangeResult> {
  const expected = expectedProof(input.change);
  const newSessionToken = encodeOpaqueToken(input.generateOpaqueToken());
  const generatedIdentityId = input.generateId();
  const generatedVerifiedEmailId = input.generateId();
  const outboxEventId = input.generateId();
  const correlationId = input.generateCorrelationId();

  try {
    const committed = await input.database.transaction(async (transaction) => {
      const currentSession = await lockActiveSessionForOtp(transaction, {
        userId: input.actorId,
        sessionId: input.currentSessionId,
        now: input.now,
      });
      if (!currentSession) throw identitySecurityChangeRejected;
      await lockAndValidateProof(transaction, input, expected);
      const consumed = await consumeIdentityLinkProof(
        transaction,
        {
          proofId: input.proofId,
          actorId: input.actorId,
          sessionId: input.currentSessionId,
          provider: expected.provider,
          providerSubject: expected.providerSubject,
        },
        () => input.now,
      );
      if (!consumed) throw identitySecurityChangeRejected;
      await input.afterMutation?.("proof-consumed");

      await applyIdentityMutation(
        transaction,
        input,
        expected,
        generatedIdentityId,
        generatedVerifiedEmailId,
      );
      await input.afterMutation?.("identity-mutated");

      const rotated = await rotateIdentitySession(transaction, {
        userId: input.actorId,
        sessionId: input.currentSessionId,
        token: newSessionToken,
        reauthenticatedAt: input.now,
      });
      if (!rotated) throw identitySecurityChangeRejected;
      await input.afterMutation?.("current-session-rotated");

      const revokedOtherSessions = await revokeOtherSessions(
        transaction,
        input.actorId,
        input.currentSessionId,
        "identity-security-change",
        () => input.now,
      );
      await input.afterMutation?.("other-sessions-revoked");

      const event: EventEnvelope = {
        id: outboxEventId,
        type: "identity.security-state-changed",
        version: 1,
        occurredAt: input.now.toISOString(),
        correlationId,
        aggregate: { type: "identity-security-change", id: input.actorId },
        payload: {
          actorId: input.actorId,
          sessionId: input.currentSessionId,
          changeType: input.change.type,
          provider: expected.provider,
          trust: currentSession.trust,
          revokedOtherSessions,
        },
      };
      await appendOutboxEvent(transaction, event);
      await input.afterMutation?.("evidence-appended");
      return { revokedOtherSessions };
    });

    return {
      sessionId: input.currentSessionId,
      newSessionToken,
      revokedOtherSessions: committed.revokedOtherSessions,
    };
  } catch (error) {
    if (error === identitySecurityChangeRejected) {
      throw new Error("identity security change rejected");
    }
    throw error;
  }
}

export const IdentitySecurityChangeRepository: IdentitySecurityChangePort = {
  execute: executeIdentitySecurityChange,
};
