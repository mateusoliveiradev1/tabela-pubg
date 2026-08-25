const PENDING_KEY = "pubg-camp:identity-action:pending";
const READY_KEY = "pubg-camp:identity-action:ready";
const CONTINUATION_TTL_MS = 4 * 60_000;
const MAX_STORED_LENGTH = 512;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdentityActionDescriptor =
  | { kind: "link-discord" }
  | { kind: "link-email" }
  | { kind: "confirm-link"; candidateIdentityId: string }
  | { kind: "remove-identity"; identityId: string };

type StoredIdentityActionContinuation = IdentityActionDescriptor & {
  expiresAt: number;
};

export function storeIdentityActionContinuation(
  storage: Storage,
  descriptor: IdentityActionDescriptor,
  now = Date.now(),
): void {
  const continuation = parseContinuation({
    ...descriptor,
    expiresAt: now + CONTINUATION_TTL_MS,
  });
  if (!continuation) throw new Error("identity action continuation is invalid");
  storage.removeItem(READY_KEY);
  storage.setItem(PENDING_KEY, JSON.stringify(continuation));
}

export function promoteIdentityActionContinuation(storage: Storage, now = Date.now()): boolean {
  const raw = storage.getItem(PENDING_KEY);
  storage.removeItem(PENDING_KEY);
  const continuation = parseStored(raw, now);
  if (!continuation) return false;
  storage.setItem(READY_KEY, JSON.stringify(continuation));
  return true;
}

export function consumeIdentityActionContinuation(
  storage: Storage,
  now = Date.now(),
): IdentityActionDescriptor | null {
  const raw = storage.getItem(READY_KEY);
  storage.removeItem(READY_KEY);
  const continuation = parseStored(raw, now);
  if (!continuation) return null;
  const { expiresAt: _, ...descriptor } = continuation;
  return descriptor;
}

function parseStored(raw: string | null, now: number): StoredIdentityActionContinuation | null {
  if (!raw || raw.length > MAX_STORED_LENGTH) return null;
  try {
    const continuation = parseContinuation(JSON.parse(raw));
    return continuation && continuation.expiresAt > now ? continuation : null;
  } catch {
    return null;
  }
}

function parseContinuation(value: unknown): StoredIdentityActionContinuation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.expiresAt !== "number" ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    Object.keys(candidate).some(
      (key) => !["kind", "expiresAt", "candidateIdentityId", "identityId"].includes(key),
    )
  ) {
    return null;
  }
  if (candidate.kind === "link-discord" || candidate.kind === "link-email") {
    return Object.keys(candidate).length === 2
      ? (candidate as StoredIdentityActionContinuation)
      : null;
  }
  if (
    candidate.kind === "confirm-link" &&
    isUuid(candidate.candidateIdentityId) &&
    Object.keys(candidate).length === 3
  ) {
    return candidate as StoredIdentityActionContinuation;
  }
  if (
    candidate.kind === "remove-identity" &&
    isUuid(candidate.identityId) &&
    Object.keys(candidate).length === 3
  ) {
    return candidate as StoredIdentityActionContinuation;
  }
  return null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
