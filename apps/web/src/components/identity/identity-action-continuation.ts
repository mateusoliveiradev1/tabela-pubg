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
  nonce: string;
  expiresAt: number;
};

export function storeIdentityActionContinuation(
  storage: Storage,
  descriptor: IdentityActionDescriptor,
  now = Date.now(),
): string {
  const nonce = crypto.randomUUID();
  const continuation = parseContinuation({
    ...descriptor,
    nonce,
    expiresAt: now + CONTINUATION_TTL_MS,
  });
  if (!continuation) throw new Error("identity action continuation is invalid");
  storage.removeItem(READY_KEY);
  storage.setItem(PENDING_KEY, JSON.stringify(continuation));
  return nonce;
}

export function promoteIdentityActionContinuation(
  storage: Storage,
  nonce: string,
  now = Date.now(),
): boolean {
  const raw = storage.getItem(PENDING_KEY);
  const continuation = parseStored(raw, now);
  if (!continuation) {
    storage.removeItem(PENDING_KEY);
    return false;
  }
  if (continuation.nonce !== nonce) return false;
  storage.removeItem(PENDING_KEY);
  storage.setItem(READY_KEY, JSON.stringify(continuation));
  return true;
}

export function clearIdentityActionContinuation(storage: Storage, nonce?: string): void {
  clearStoredContinuation(storage, PENDING_KEY, nonce);
  clearStoredContinuation(storage, READY_KEY, nonce);
}

export function consumeIdentityActionContinuation(
  storage: Storage,
  now = Date.now(),
): IdentityActionDescriptor | null {
  const raw = storage.getItem(READY_KEY);
  storage.removeItem(READY_KEY);
  const continuation = parseStored(raw, now);
  if (!continuation) return null;
  const { expiresAt: _, nonce: __, ...descriptor } = continuation;
  return descriptor;
}

function clearStoredContinuation(storage: Storage, key: string, nonce?: string): void {
  if (nonce === undefined) {
    storage.removeItem(key);
    return;
  }
  const raw = storage.getItem(key);
  if (!raw) return;
  try {
    const candidate = JSON.parse(raw) as { nonce?: unknown };
    if (candidate.nonce === nonce) storage.removeItem(key);
  } catch {
    storage.removeItem(key);
  }
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
      (key) => !["kind", "nonce", "expiresAt", "candidateIdentityId", "identityId"].includes(key),
    )
  ) {
    return null;
  }
  if (!isUuid(candidate.nonce)) return null;
  if (candidate.kind === "link-discord" || candidate.kind === "link-email") {
    return Object.keys(candidate).length === 3
      ? (candidate as StoredIdentityActionContinuation)
      : null;
  }
  if (
    candidate.kind === "confirm-link" &&
    isUuid(candidate.candidateIdentityId) &&
    Object.keys(candidate).length === 4
  ) {
    return candidate as StoredIdentityActionContinuation;
  }
  if (
    candidate.kind === "remove-identity" &&
    isUuid(candidate.identityId) &&
    Object.keys(candidate).length === 4
  ) {
    return candidate as StoredIdentityActionContinuation;
  }
  return null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
