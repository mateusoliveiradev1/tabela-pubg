import type { OperationalRole } from "@pubg-camp/contracts";

const PENDING_KEY = "pubg-camp:sensitive-action:pending";
const READY_KEY = "pubg-camp:sensitive-action:ready";
const CONTINUATION_TTL_MS = 10 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONAL_ROLES = new Set<OperationalRole>([
  "referee",
  "registrations",
  "broadcast",
  "analyst",
]);

export type SensitiveActionDescriptor =
  | {
      kind: "membership-role-change";
      organizationId: string;
      membershipId: string;
      draft: {
        organizationRole: "admin" | "member";
        assignments: { authorizationScopeId: string; role: OperationalRole }[];
      };
    }
  | { kind: "membership-revocation"; organizationId: string; membershipId: string }
  | {
      kind: "ownership-transfer";
      organizationId: string;
      targetMembershipId: string;
      organizationNameConfirmation: string;
    };

export type SensitiveActionContinuation = SensitiveActionDescriptor & {
  reason: string;
  nonce: string;
  expiresAt: number;
};

export function storeSensitiveActionContinuation(
  storage: Storage,
  descriptor: SensitiveActionDescriptor,
  reason: string,
  now = Date.now(),
): void {
  const continuation = parseContinuation({
    ...descriptor,
    reason: reason.trim(),
    nonce: crypto.randomUUID(),
    expiresAt: now + CONTINUATION_TTL_MS,
  });
  if (!continuation) throw new Error("sensitive action continuation is invalid");
  storage.removeItem(READY_KEY);
  storage.setItem(PENDING_KEY, JSON.stringify(continuation));
}

export function promoteSensitiveActionContinuation(storage: Storage, now = Date.now()): boolean {
  const raw = storage.getItem(PENDING_KEY);
  storage.removeItem(PENDING_KEY);
  const continuation = parseStored(raw, now);
  if (!continuation) return false;
  storage.setItem(READY_KEY, JSON.stringify(continuation));
  return true;
}

export function consumeSensitiveActionContinuation(
  storage: Storage,
  organizationId: string,
  now = Date.now(),
): SensitiveActionContinuation | null {
  const raw = storage.getItem(READY_KEY);
  storage.removeItem(READY_KEY);
  const continuation = parseStored(raw, now);
  return continuation?.organizationId === organizationId ? continuation : null;
}

function parseStored(raw: string | null, now: number): SensitiveActionContinuation | null {
  if (!raw || raw.length > 8_192) return null;
  try {
    const continuation = parseContinuation(JSON.parse(raw));
    return continuation && continuation.expiresAt > now ? continuation : null;
  } catch {
    return null;
  }
}

function parseContinuation(value: unknown): SensitiveActionContinuation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    !isUuid(candidate.organizationId) ||
    typeof candidate.reason !== "string" ||
    candidate.reason.trim().length < 8 ||
    candidate.reason.length > 500 ||
    typeof candidate.nonce !== "string" ||
    !isUuid(candidate.nonce) ||
    typeof candidate.expiresAt !== "number" ||
    !Number.isSafeInteger(candidate.expiresAt)
  ) {
    return null;
  }
  if (candidate.kind === "membership-revocation" && isUuid(candidate.membershipId)) {
    return candidate as SensitiveActionContinuation;
  }
  if (
    candidate.kind === "ownership-transfer" &&
    isUuid(candidate.targetMembershipId) &&
    typeof candidate.organizationNameConfirmation === "string" &&
    candidate.organizationNameConfirmation.length >= 1 &&
    candidate.organizationNameConfirmation.length <= 160
  ) {
    return candidate as SensitiveActionContinuation;
  }
  if (
    candidate.kind === "membership-role-change" &&
    isUuid(candidate.membershipId) &&
    isRoleDraft(candidate.draft)
  ) {
    return candidate as SensitiveActionContinuation;
  }
  return null;
}

function isRoleDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  if (draft.organizationRole !== "admin" && draft.organizationRole !== "member") return false;
  if (!Array.isArray(draft.assignments) || draft.assignments.length > 100) return false;
  return draft.assignments.every((assignment) => {
    if (!assignment || typeof assignment !== "object") return false;
    const entry = assignment as Record<string, unknown>;
    return (
      isUuid(entry.authorizationScopeId) && OPERATIONAL_ROLES.has(entry.role as OperationalRole)
    );
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
