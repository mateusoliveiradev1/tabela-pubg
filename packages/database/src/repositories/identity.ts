import { createHash, createHmac } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as databaseSchema from "../schema.js";
import {
  authChallenges,
  type IdentityRow,
  identities,
  identityLinkProofs,
  oauthTransactions,
  sessions as sessionRecords,
  users,
  verifiedEmails,
} from "../schema.js";
import {
  lockActiveSessionForOtp,
  promoteProvisionalSessionTrust,
  replaceActiveSessionToken,
  revokeOtherSessions,
} from "./sessions.js";

export type Clock = () => Date;

export type RepositoryExecutor = Pick<
  PostgresJsDatabase<typeof databaseSchema>,
  "delete" | "insert" | "select" | "update"
>;

type OAuthPurpose = "sign-in" | "link-identity" | "step-up";
export type AuthChallengePurpose =
  | "sign-in"
  | "link-email"
  | "change-email"
  | "step-up"
  | "verify-provisional-email";
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

function assertChallengeBinding(
  purpose: AuthChallengePurpose,
  actorId: string | undefined,
  sessionId: string | undefined,
): void {
  const isSignIn = purpose === "sign-in";
  if (isSignIn ? actorId !== undefined || sessionId !== undefined : !actorId || !sessionId) {
    throw new Error("OTP purpose binding is invalid");
  }
}

function authChallengeBindingConditions(actorId?: string, sessionId?: string) {
  return [
    actorId === undefined ? isNull(authChallenges.userId) : eq(authChallenges.userId, actorId),
    sessionId === undefined
      ? isNull(authChallenges.sessionId)
      : eq(authChallenges.sessionId, sessionId),
  ] as const;
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
    actorId?: string;
    sessionId?: string;
  },
): Promise<void> {
  assertChallengeBinding(input.purpose, input.actorId, input.sessionId);
  await executor
    .update(authChallenges)
    .set({ supersededAt: input.now })
    .where(
      and(
        eq(authChallenges.emailDigest, input.emailDigest),
        eq(authChallenges.purpose, input.purpose),
        ...authChallengeBindingConditions(input.actorId, input.sessionId),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
      ),
    );
  await executor.insert(authChallenges).values({
    id: input.id,
    emailDigest: input.emailDigest,
    purpose: input.purpose,
    codeDigest: input.codeDigest,
    attemptsRemaining: input.attemptsRemaining,
    expiresAt: input.expiresAt,
    createdAt: input.now,
    ...(input.actorId === undefined ? {} : { userId: input.actorId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  });
}

export async function findActiveAuthChallenge(
  executor: RepositoryExecutor,
  input: {
    challengeId: string;
    purpose: AuthChallengePurpose;
    actorId?: string;
    sessionId?: string;
  },
) {
  assertChallengeBinding(input.purpose, input.actorId, input.sessionId);
  const [challenge] = await executor
    .select()
    .from(authChallenges)
    .where(
      and(
        eq(authChallenges.id, input.challengeId),
        eq(authChallenges.purpose, input.purpose),
        ...authChallengeBindingConditions(input.actorId, input.sessionId),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
      ),
    )
    .limit(1);
  return challenge ?? null;
}

export async function recordAuthChallengeFailure(
  executor: RepositoryExecutor,
  input: {
    challengeId: string;
    purpose: AuthChallengePurpose;
    actorId?: string;
    sessionId?: string;
    now: Date;
  },
): Promise<number> {
  assertChallengeBinding(input.purpose, input.actorId, input.sessionId);
  const [challenge] = await executor
    .update(authChallenges)
    .set({ attemptsRemaining: sql`${authChallenges.attemptsRemaining} - 1` })
    .where(
      and(
        eq(authChallenges.id, input.challengeId),
        eq(authChallenges.purpose, input.purpose),
        ...authChallengeBindingConditions(input.actorId, input.sessionId),
        isNull(authChallenges.supersededAt),
        isNull(authChallenges.consumedAt),
        gt(authChallenges.attemptsRemaining, 0),
        gt(authChallenges.expiresAt, input.now),
      ),
    )
    .returning({ attemptsRemaining: authChallenges.attemptsRemaining });
  return challenge?.attemptsRemaining ?? 0;
}

export async function consumeAuthChallengeByDigest(
  executor: RepositoryExecutor,
  input: {
    challengeId: string;
    purpose: AuthChallengePurpose;
    codeDigest: string;
    actorId?: string;
    sessionId?: string;
    now: Date;
  },
): Promise<boolean> {
  assertChallengeBinding(input.purpose, input.actorId, input.sessionId);
  const [challenge] = await executor
    .update(authChallenges)
    .set({ consumedAt: input.now })
    .where(
      and(
        eq(authChallenges.id, input.challengeId),
        eq(authChallenges.purpose, input.purpose),
        eq(authChallenges.codeDigest, input.codeDigest),
        ...authChallengeBindingConditions(input.actorId, input.sessionId),
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
  actorId?: string;
  sessionId?: string;
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
  assertChallengeBinding(input.purpose, input.actorId, input.sessionId);

  await executor
    .update(authChallenges)
    .set({ supersededAt: now })
    .where(
      and(
        eq(authChallenges.emailDigest, subjectDigest),
        eq(authChallenges.purpose, input.purpose),
        ...authChallengeBindingConditions(input.actorId, input.sessionId),
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
    ...(input.actorId === undefined ? {} : { userId: input.actorId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  });
}

export type ConsumeAuthChallengeResult =
  | { status: "consumed"; challengeId: string; userId: string | null }
  | { status: "invalid"; attemptsRemaining: number }
  | { status: "unavailable" };

export async function consumeAuthChallenge(
  executor: RepositoryExecutor,
  input: {
    email: string;
    purpose: AuthChallengePurpose;
    code: string;
    actorId?: string;
    sessionId?: string;
  },
  hmacKey: Uint8Array,
  clock: Clock,
): Promise<ConsumeAuthChallengeResult> {
  const now = clock();
  const subjectDigest = emailDigest(input.email);
  const expectedCodeDigest = challengeCodeDigest(input.email, input.purpose, input.code, hmacKey);
  assertChallengeBinding(input.purpose, input.actorId, input.sessionId);

  const [consumed] = await executor
    .update(authChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authChallenges.emailDigest, subjectDigest),
        eq(authChallenges.purpose, input.purpose),
        eq(authChallenges.codeDigest, expectedCodeDigest),
        ...authChallengeBindingConditions(input.actorId, input.sessionId),
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
        ...authChallengeBindingConditions(input.actorId, input.sessionId),
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

export type ResolveEmailAccountResult =
  | { status: "created" | "resolved"; userId: string }
  | { status: "conflict" };

const emailAccountConflict = Symbol("email-account-conflict");
const otpCompletionRejected = Symbol("otp-completion-rejected");

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function findEmailAccount(executor: RepositoryExecutor, email: string) {
  const normalized = normalizeEmail(email);
  const [account] = await executor
    .select({ userId: identities.userId })
    .from(identities)
    .innerJoin(users, eq(users.id, identities.userId))
    .innerJoin(
      verifiedEmails,
      and(
        eq(verifiedEmails.userId, identities.userId),
        eq(verifiedEmails.identityId, identities.id),
        eq(verifiedEmails.normalizedEmail, normalized),
        isNull(verifiedEmails.revokedAt),
      ),
    )
    .where(
      and(
        eq(identities.provider, "email"),
        eq(identities.providerSubject, emailDigest(normalized)),
        eq(identities.status, "verified"),
        isNull(identities.revokedAt),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return account ?? null;
}

async function createEmailAccount(
  executor: RepositoryExecutor,
  input: {
    email: string;
    userId: string;
    identityId: string;
    verifiedEmailId: string;
    now: Date;
  },
): Promise<ResolveEmailAccountResult> {
  const existing = await findEmailAccount(executor, input.email);
  if (existing) return { status: "resolved", userId: existing.userId };

  const normalized = normalizeEmail(input.email);
  const [coincidingEmail] = await executor
    .select({ userId: verifiedEmails.userId })
    .from(verifiedEmails)
    .where(and(eq(verifiedEmails.normalizedEmail, normalized), isNull(verifiedEmails.revokedAt)))
    .limit(1);
  if (coincidingEmail) throw emailAccountConflict;

  await executor.insert(users).values({
    id: input.userId,
    displayName: "Email user",
    createdAt: input.now,
    updatedAt: input.now,
  });
  const [identity] = await executor
    .insert(identities)
    .values({
      id: input.identityId,
      userId: input.userId,
      provider: "email",
      providerSubject: emailDigest(normalized),
      status: "verified",
      linkedAt: input.now,
      verifiedAt: input.now,
    })
    .onConflictDoNothing({ target: [identities.provider, identities.providerSubject] })
    .returning({ id: identities.id });
  if (!identity) throw emailAccountConflict;
  await executor.insert(verifiedEmails).values({
    id: input.verifiedEmailId,
    userId: input.userId,
    identityId: identity.id,
    normalizedEmail: normalized,
    verifiedAt: input.now,
    createdAt: input.now,
  });
  return { status: "created", userId: input.userId };
}

export async function resolveOrCreateEmailAccount(
  database: PostgresJsDatabase<typeof databaseSchema>,
  input: {
    email: string;
    userId: string;
    identityId: string;
    verifiedEmailId: string;
    now: Date;
  },
): Promise<ResolveEmailAccountResult> {
  try {
    return await database.transaction((transaction) => createEmailAccount(transaction, input));
  } catch (error) {
    if (error !== emailAccountConflict && !isUniqueViolation(error)) throw error;
    const winner = await findEmailAccount(database, input.email);
    return winner ? { status: "resolved", userId: winner.userId } : { status: "conflict" };
  }
}

export type OtpMutationBoundary = "challenge" | "identity" | "trust" | "token" | "revocation";

export interface CompleteOtpChallengeInput {
  challengeId: string;
  email: string;
  purpose: AuthChallengePurpose;
  actorId?: string;
  sessionId?: string;
  now: Date;
  codeDigest?: string;
  code?: string;
  hmacKey?: Uint8Array;
  ids: {
    userId: string;
    identityId: string;
    verifiedEmailId: string;
    proofId: string;
  };
  replacementSessionToken?: string;
  afterMutation?: (boundary: OtpMutationBoundary) => void | Promise<void>;
}

export type CompleteOtpChallengeResult =
  | { status: "authenticated"; userId: string }
  | { status: "identity-link-ready"; proofId: string; actorId: string; sessionId: string }
  | { status: "email-change-ready"; proofId: string; actorId: string; sessionId: string }
  | {
      status: "step-up-confirmed";
      actorId: string;
      sessionId: string;
      confirmedAt: Date;
    }
  | {
      status: "provisional-email-verified";
      userId: string;
      sessionId: string;
      sessionToken: string;
      trust: "trusted";
    }
  | { status: "rejected" };

function completionCodeDigest(input: CompleteOtpChallengeInput): string {
  if (input.codeDigest !== undefined) return input.codeDigest;
  if (input.code !== undefined && input.hmacKey !== undefined) {
    return challengeCodeDigest(input.email, input.purpose, input.code, input.hmacKey);
  }
  throw new Error("OTP completion requires a code digest");
}

async function linkVerifiedEmailToActor(
  executor: RepositoryExecutor,
  input: {
    actorId: string;
    email: string;
    identityId: string;
    verifiedEmailId: string;
    now: Date;
  },
): Promise<void> {
  const normalized = normalizeEmail(input.email);
  const subject = emailDigest(normalized);
  const [existingIdentity] = await executor
    .select({ id: identities.id, userId: identities.userId })
    .from(identities)
    .where(
      and(
        eq(identities.provider, "email"),
        eq(identities.providerSubject, subject),
        eq(identities.status, "verified"),
        isNull(identities.revokedAt),
      ),
    )
    .limit(1);
  if (existingIdentity && existingIdentity.userId !== input.actorId) throw otpCompletionRejected;

  const [existingEmail] = await executor
    .select({ identityId: verifiedEmails.identityId, userId: verifiedEmails.userId })
    .from(verifiedEmails)
    .where(and(eq(verifiedEmails.normalizedEmail, normalized), isNull(verifiedEmails.revokedAt)))
    .limit(1);
  if (existingEmail && existingEmail.userId !== input.actorId) throw otpCompletionRejected;

  let identityId = existingIdentity?.id;
  if (!identityId) {
    const [created] = await executor
      .insert(identities)
      .values({
        id: input.identityId,
        userId: input.actorId,
        provider: "email",
        providerSubject: subject,
        status: "verified",
        linkedAt: input.now,
        verifiedAt: input.now,
      })
      .onConflictDoNothing({ target: [identities.provider, identities.providerSubject] })
      .returning({ id: identities.id });
    if (!created) throw otpCompletionRejected;
    identityId = created.id;
  }

  if (existingEmail) {
    if (existingEmail.identityId !== identityId) throw otpCompletionRejected;
    return;
  }
  await executor.insert(verifiedEmails).values({
    id: input.verifiedEmailId,
    userId: input.actorId,
    identityId,
    normalizedEmail: normalized,
    verifiedAt: input.now,
    createdAt: input.now,
  });
}

export async function completeOtpChallenge(
  database: PostgresJsDatabase<typeof databaseSchema>,
  input: CompleteOtpChallengeInput,
): Promise<CompleteOtpChallengeResult> {
  assertChallengeBinding(input.purpose, input.actorId, input.sessionId);
  const expectedCodeDigest = completionCodeDigest(input);
  try {
    return await database.transaction(async (transaction) => {
      const [challenge] = await transaction
        .select()
        .from(authChallenges)
        .where(
          and(
            eq(authChallenges.id, input.challengeId),
            eq(authChallenges.emailDigest, emailDigest(input.email)),
            eq(authChallenges.purpose, input.purpose),
            eq(authChallenges.codeDigest, expectedCodeDigest),
            ...authChallengeBindingConditions(input.actorId, input.sessionId),
            isNull(authChallenges.supersededAt),
            isNull(authChallenges.consumedAt),
            gt(authChallenges.attemptsRemaining, 0),
            gt(authChallenges.expiresAt, input.now),
          ),
        )
        .for("update")
        .limit(1);
      if (!challenge) throw otpCompletionRejected;

      const boundSession =
        input.actorId === undefined || input.sessionId === undefined
          ? null
          : await lockActiveSessionForOtp(transaction, {
              userId: input.actorId,
              sessionId: input.sessionId,
              now: input.now,
            });
      if (input.purpose !== "sign-in" && !boundSession) throw otpCompletionRejected;
      if (input.purpose === "verify-provisional-email" && boundSession?.trust !== "provisional") {
        throw otpCompletionRejected;
      }

      const consumed = await consumeAuthChallengeByDigest(transaction, {
        challengeId: input.challengeId,
        purpose: input.purpose,
        codeDigest: expectedCodeDigest,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        now: input.now,
      });
      if (!consumed) throw otpCompletionRejected;
      await input.afterMutation?.("challenge");

      if (input.purpose === "sign-in") {
        const account = await createEmailAccount(transaction, {
          email: input.email,
          userId: input.ids.userId,
          identityId: input.ids.identityId,
          verifiedEmailId: input.ids.verifiedEmailId,
          now: input.now,
        });
        return account.status === "conflict"
          ? { status: "rejected" }
          : { status: "authenticated", userId: account.userId };
      }

      const actorId = input.actorId as string;
      const sessionId = input.sessionId as string;
      if (input.purpose === "link-email" || input.purpose === "change-email") {
        await transaction.insert(identityLinkProofs).values({
          id: input.ids.proofId,
          userId: actorId,
          sessionId,
          provider: "email",
          providerSubject: emailDigest(input.email),
          expiresAt: new Date(input.now.getTime() + 10 * 60_000),
          createdAt: input.now,
        });
        return {
          status: input.purpose === "link-email" ? "identity-link-ready" : "email-change-ready",
          proofId: input.ids.proofId,
          actorId,
          sessionId,
        };
      }

      if (input.purpose === "step-up") {
        const [confirmed] = await transaction
          .update(sessionRecords)
          .set({ reauthenticatedAt: input.now, updatedAt: input.now })
          .where(
            and(
              eq(sessionRecords.userId, actorId),
              eq(sessionRecords.id, sessionId),
              isNull(sessionRecords.revokedAt),
              gt(sessionRecords.idleExpiresAt, input.now),
              gt(sessionRecords.absoluteExpiresAt, input.now),
            ),
          )
          .returning({ id: sessionRecords.id });
        if (!confirmed) throw otpCompletionRejected;
        return { status: "step-up-confirmed", actorId, sessionId, confirmedAt: input.now };
      }

      if (input.replacementSessionToken === undefined) {
        throw new Error("provisional promotion requires a replacement session token");
      }
      await linkVerifiedEmailToActor(transaction, {
        actorId,
        email: input.email,
        identityId: input.ids.identityId,
        verifiedEmailId: input.ids.verifiedEmailId,
        now: input.now,
      });
      await input.afterMutation?.("identity");
      if (
        !(await promoteProvisionalSessionTrust(transaction, {
          userId: actorId,
          sessionId,
          now: input.now,
        }))
      ) {
        throw otpCompletionRejected;
      }
      await input.afterMutation?.("trust");
      if (
        !(await replaceActiveSessionToken(transaction, {
          userId: actorId,
          sessionId,
          token: input.replacementSessionToken,
          now: input.now,
        }))
      ) {
        throw otpCompletionRejected;
      }
      await input.afterMutation?.("token");
      await revokeOtherSessions(transaction, actorId, sessionId, "identity-link", () => input.now);
      await input.afterMutation?.("revocation");
      return {
        status: "provisional-email-verified",
        userId: actorId,
        sessionId,
        sessionToken: input.replacementSessionToken,
        trust: "trusted",
      };
    });
  } catch (error) {
    if (
      error === otpCompletionRejected ||
      error === emailAccountConflict ||
      isUniqueViolation(error)
    ) {
      return { status: "rejected" };
    }
    throw error;
  }
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
  authChallengeCode: challengeCodeDigest,
};
