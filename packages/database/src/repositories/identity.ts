import { createHash, createHmac } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as databaseSchema from "../schema.js";
import {
  authChallenges,
  type IdentityRow,
  identities,
  oauthTransactions,
  users,
  verifiedEmails,
} from "../schema.js";

export type Clock = () => Date;

export type RepositoryExecutor = Pick<
  PostgresJsDatabase<typeof databaseSchema>,
  "delete" | "insert" | "select" | "update"
>;

type OAuthPurpose = "sign-in" | "link-identity" | "step-up";
type AuthChallengePurpose = "sign-in" | "link-email" | "change-email" | "step-up";
type IdentityProvider = "discord" | "email";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailDigest(email: string): string {
  return sha256(normalizeEmail(email));
}

function challengeCodeDigest(
  email: string,
  purpose: AuthChallengePurpose,
  code: string,
  hmacKey: Uint8Array,
): string {
  return createHmac("sha256", hmacKey)
    .update(`${purpose}\0${normalizeEmail(email)}\0${code}`, "utf8")
    .digest("hex");
}

export interface CreateOAuthTransactionInput {
  id: string;
  state: string;
  browserBinding: string;
  purpose: OAuthPurpose;
  expiresAt: Date;
  userId?: string;
  sessionId?: string;
  returnPath?: string;
}

export async function createOAuthTransaction(
  executor: RepositoryExecutor,
  input: CreateOAuthTransactionInput,
  clock: Clock,
): Promise<void> {
  await executor.insert(oauthTransactions).values({
    id: input.id,
    stateDigest: sha256(input.state),
    browserBindingDigest: sha256(input.browserBinding),
    purpose: input.purpose,
    expiresAt: input.expiresAt,
    createdAt: clock(),
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.returnPath === undefined ? {} : { returnPath: input.returnPath }),
  });
}

export interface ConsumeOAuthTransactionInput {
  state: string;
  browserBinding: string;
  purpose: OAuthPurpose;
}

export async function consumeOAuthTransaction(
  executor: RepositoryExecutor,
  input: ConsumeOAuthTransactionInput,
  clock: Clock,
) {
  const now = clock();
  const [consumed] = await executor
    .update(oauthTransactions)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthTransactions.stateDigest, sha256(input.state)),
        eq(oauthTransactions.browserBindingDigest, sha256(input.browserBinding)),
        eq(oauthTransactions.purpose, input.purpose),
        isNull(oauthTransactions.consumedAt),
        gt(oauthTransactions.expiresAt, now),
      ),
    )
    .returning();

  return consumed ?? null;
}

export async function findDiscordIdentity(
  executor: RepositoryExecutor,
  subject: string,
): Promise<{ userId: string; emailVerified: boolean } | null> {
  const [identity] = await executor
    .select({ userId: identities.userId, verifiedEmailId: verifiedEmails.id })
    .from(identities)
    .leftJoin(
      verifiedEmails,
      and(eq(verifiedEmails.userId, identities.userId), isNull(verifiedEmails.revokedAt)),
    )
    .where(
      and(
        eq(identities.provider, "discord"),
        eq(identities.providerSubject, subject),
        eq(identities.status, "verified"),
        isNull(identities.revokedAt),
      ),
    )
    .limit(1);
  return identity
    ? { userId: identity.userId, emailVerified: identity.verifiedEmailId !== null }
    : null;
}

const discordIdentityConflict = Symbol("discord-identity-conflict");

export async function createDiscordAccount(
  database: PostgresJsDatabase<typeof databaseSchema>,
  input: {
    identityId: string;
    userId: string;
    subject: string;
    displayName: string;
    verifiedEmail?: string;
    now: Date;
    verifiedEmailId?: string;
  },
): Promise<{ status: "created"; userId: string } | { status: "conflict" }> {
  try {
    await database.transaction(async (transaction) => {
      await transaction.insert(users).values({
        id: input.userId,
        displayName: input.displayName,
        createdAt: input.now,
        updatedAt: input.now,
      });
      const [identity] = await transaction
        .insert(identities)
        .values({
          id: input.identityId,
          userId: input.userId,
          provider: "discord",
          providerSubject: input.subject,
          displayName: input.displayName,
          status: "verified",
          linkedAt: input.now,
          verifiedAt: input.now,
        })
        .onConflictDoNothing({ target: [identities.provider, identities.providerSubject] })
        .returning({ id: identities.id });
      if (!identity) throw discordIdentityConflict;
      if (input.verifiedEmail !== undefined && input.verifiedEmailId !== undefined) {
        await transaction.insert(verifiedEmails).values({
          id: input.verifiedEmailId,
          userId: input.userId,
          identityId: input.identityId,
          normalizedEmail: normalizeEmail(input.verifiedEmail),
          verifiedAt: input.now,
          createdAt: input.now,
        });
      }
    });
    return { status: "created", userId: input.userId };
  } catch (error) {
    if (error === discordIdentityConflict) return { status: "conflict" };
    throw error;
  }
}

export async function replaceAuthChallengeDigest(
  executor: RepositoryExecutor,
  input: {
    id: string;
    emailDigest: string;
    purpose: AuthChallengePurpose;
    codeDigest: string;
    attemptsRemaining: number;
    expiresAt: Date;
    now: Date;
  },
): Promise<void> {
  await executor
    .update(authChallenges)
    .set({ supersededAt: input.now })
    .where(
      and(
        eq(authChallenges.emailDigest, input.emailDigest),
        eq(authChallenges.purpose, input.purpose),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
      ),
    );
  await executor.insert(authChallenges).values(input);
}

export async function findActiveAuthChallenge(
  executor: RepositoryExecutor,
  challengeId: string,
  purpose: AuthChallengePurpose,
) {
  const [challenge] = await executor
    .select()
    .from(authChallenges)
    .where(
      and(
        eq(authChallenges.id, challengeId),
        eq(authChallenges.purpose, purpose),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
      ),
    )
    .limit(1);
  return challenge ?? null;
}

export async function recordAuthChallengeFailure(
  executor: RepositoryExecutor,
  challengeId: string,
  now: Date,
): Promise<number> {
  const [challenge] = await executor
    .update(authChallenges)
    .set({ attemptsRemaining: sql`${authChallenges.attemptsRemaining} - 1` })
    .where(
      and(
        eq(authChallenges.id, challengeId),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
        gt(authChallenges.attemptsRemaining, 0),
        gt(authChallenges.expiresAt, now),
      ),
    )
    .returning({ attemptsRemaining: authChallenges.attemptsRemaining });
  return challenge?.attemptsRemaining ?? 0;
}

export async function consumeAuthChallengeByDigest(
  executor: RepositoryExecutor,
  input: { challengeId: string; codeDigest: string; now: Date },
): Promise<boolean> {
  const [challenge] = await executor
    .update(authChallenges)
    .set({ consumedAt: input.now })
    .where(
      and(
        eq(authChallenges.id, input.challengeId),
        eq(authChallenges.codeDigest, input.codeDigest),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
        gt(authChallenges.attemptsRemaining, 0),
        gt(authChallenges.expiresAt, input.now),
      ),
    )
    .returning({ id: authChallenges.id });
  return Boolean(challenge);
}

export interface ReplaceAuthChallengeInput {
  id: string;
  email: string;
  purpose: AuthChallengePurpose;
  code: string;
  expiresAt: Date;
  userId?: string;
  attempts?: number;
}

export async function replaceAuthChallenge(
  executor: RepositoryExecutor,
  input: ReplaceAuthChallengeInput,
  hmacKey: Uint8Array,
  clock: Clock,
): Promise<void> {
  const now = clock();
  const subjectDigest = emailDigest(input.email);

  await executor
    .update(authChallenges)
    .set({ supersededAt: now })
    .where(
      and(
        eq(authChallenges.emailDigest, subjectDigest),
        eq(authChallenges.purpose, input.purpose),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
      ),
    );

  await executor.insert(authChallenges).values({
    id: input.id,
    emailDigest: subjectDigest,
    purpose: input.purpose,
    codeDigest: challengeCodeDigest(input.email, input.purpose, input.code, hmacKey),
    attemptsRemaining: input.attempts ?? 5,
    expiresAt: input.expiresAt,
    createdAt: now,
    ...(input.userId === undefined ? {} : { userId: input.userId }),
  });
}

export type ConsumeAuthChallengeResult =
  | { status: "consumed"; challengeId: string; userId: string | null }
  | { status: "invalid"; attemptsRemaining: number }
  | { status: "unavailable" };

export async function consumeAuthChallenge(
  executor: RepositoryExecutor,
  input: { email: string; purpose: AuthChallengePurpose; code: string },
  hmacKey: Uint8Array,
  clock: Clock,
): Promise<ConsumeAuthChallengeResult> {
  const now = clock();
  const subjectDigest = emailDigest(input.email);
  const expectedCodeDigest = challengeCodeDigest(input.email, input.purpose, input.code, hmacKey);

  const [consumed] = await executor
    .update(authChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authChallenges.emailDigest, subjectDigest),
        eq(authChallenges.purpose, input.purpose),
        eq(authChallenges.codeDigest, expectedCodeDigest),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
        gt(authChallenges.attemptsRemaining, 0),
        gt(authChallenges.expiresAt, now),
      ),
    )
    .returning({ id: authChallenges.id, userId: authChallenges.userId });

  if (consumed) {
    return { status: "consumed", challengeId: consumed.id, userId: consumed.userId };
  }

  const [decremented] = await executor
    .update(authChallenges)
    .set({ attemptsRemaining: sql`${authChallenges.attemptsRemaining} - 1` })
    .where(
      and(
        eq(authChallenges.emailDigest, subjectDigest),
        eq(authChallenges.purpose, input.purpose),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
        gt(authChallenges.attemptsRemaining, 0),
        gt(authChallenges.expiresAt, now),
      ),
    )
    .returning({ attemptsRemaining: authChallenges.attemptsRemaining });

  return decremented
    ? { status: "invalid", attemptsRemaining: decremented.attemptsRemaining }
    : { status: "unavailable" };
}

export interface LinkIdentityInput {
  id: string;
  userId: string;
  provider: IdentityProvider;
  providerSubject: string;
  displayName?: string;
  verifiedAt: Date;
}

export type LinkIdentityResult =
  | { status: "linked"; identity: IdentityRow }
  | { status: "conflict" };

export async function linkIdentity(
  executor: RepositoryExecutor,
  input: LinkIdentityInput,
): Promise<LinkIdentityResult> {
  const [identity] = await executor
    .insert(identities)
    .values({
      id: input.id,
      userId: input.userId,
      provider: input.provider,
      providerSubject: input.providerSubject,
      status: "verified",
      verifiedAt: input.verifiedAt,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    })
    .onConflictDoNothing({ target: [identities.provider, identities.providerSubject] })
    .returning();

  return identity ? { status: "linked", identity } : { status: "conflict" };
}

export const identityDigests = {
  email: emailDigest,
  opaque: sha256,
};
