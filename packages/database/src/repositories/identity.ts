import { createHash, createHmac } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as databaseSchema from "../schema.js";
import { authChallenges, type IdentityRow, identities, oauthTransactions } from "../schema.js";

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
