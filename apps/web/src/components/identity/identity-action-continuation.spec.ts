import { describe, expect, it } from "vitest";
import {
  clearIdentityActionContinuation,
  consumeIdentityActionContinuation,
  promoteIdentityActionContinuation,
  storeIdentityActionContinuation,
} from "./identity-action-continuation";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("identity action continuation", () => {
  it("promotes a short typed continuation after step-up and consumes it once", () => {
    const storage = new MemoryStorage();
    const now = Date.UTC(2026, 7, 25, 12);
    const nonce = storeIdentityActionContinuation(storage, { kind: "link-email" }, now);

    expect(nonce).toMatch(/^[0-9a-f-]{36}$/i);
    expect(consumeIdentityActionContinuation(storage, now)).toBeNull();
    expect(
      promoteIdentityActionContinuation(
        storage,
        "00000000-0000-4000-8000-000000000099",
        now + 500,
      ),
    ).toBe(false);
    expect(promoteIdentityActionContinuation(storage, nonce, now + 1_000)).toBe(true);
    expect(consumeIdentityActionContinuation(storage, now + 2_000)).toEqual({
      kind: "link-email",
    });
    expect(consumeIdentityActionContinuation(storage, now + 2_001)).toBeNull();
  });

  it("rejects expiry, unknown actions and malformed identity ids without replay", () => {
    const storage = new MemoryStorage();
    const now = Date.UTC(2026, 7, 25, 12);
    const nonce = storeIdentityActionContinuation(
      storage,
      { kind: "remove-identity", identityId: "00000000-0000-4000-8000-000000000001" },
      now,
    );
    expect(promoteIdentityActionContinuation(storage, nonce, now + 5 * 60_000)).toBe(false);
    expect(consumeIdentityActionContinuation(storage, now + 5 * 60_000)).toBeNull();

    storage.setItem(
      "pubg-camp:identity-action:pending",
      JSON.stringify({ kind: "link-email", email: "secret@example.test", expiresAt: now + 1_000 }),
    );
    expect(
      promoteIdentityActionContinuation(
        storage,
        "00000000-0000-4000-8000-000000000003",
        now,
      ),
    ).toBe(false);

    storage.setItem(
      "pubg-camp:identity-action:pending",
      JSON.stringify({ kind: "remove-identity", identityId: "not-a-uuid", expiresAt: now + 1_000 }),
    );
    expect(
      promoteIdentityActionContinuation(
        storage,
        "00000000-0000-4000-8000-000000000004",
        now,
      ),
    ).toBe(false);
  });

  it("clears an abandoned flow without making it ready", () => {
    const storage = new MemoryStorage();
    const now = Date.UTC(2026, 7, 25, 12);
    const nonce = storeIdentityActionContinuation(storage, { kind: "link-email" }, now);

    clearIdentityActionContinuation(storage, nonce);

    expect(promoteIdentityActionContinuation(storage, nonce, now + 1)).toBe(false);
    expect(consumeIdentityActionContinuation(storage, now + 2)).toBeNull();
  });
});
