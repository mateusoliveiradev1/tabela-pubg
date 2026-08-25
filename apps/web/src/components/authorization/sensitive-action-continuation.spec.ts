import { describe, expect, it } from "vitest";
import {
  clearSensitiveActionContinuation,
  consumeSensitiveActionContinuation,
  promoteSensitiveActionContinuation,
  storeSensitiveActionContinuation,
} from "./sensitive-action-continuation";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
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

const now = new Date("2026-08-21T10:00:00.000Z").getTime();
const organizationId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";

describe("sensitive action continuation", () => {
  it("becomes reachable only after step-up promotion and is consumed once", () => {
    const storage = new MemoryStorage();
    const nonce = storeSensitiveActionContinuation(
      storage,
      { kind: "membership-revocation", organizationId, membershipId },
      "Motivo auditável",
      now,
    );

    expect(nonce).toMatch(/^[0-9a-f-]{36}$/i);
    expect(consumeSensitiveActionContinuation(storage, organizationId, now)).toBeNull();
    expect(
      promoteSensitiveActionContinuation(storage, "00000000-0000-4000-8000-000000000099", now),
    ).toBe(false);
    expect(promoteSensitiveActionContinuation(storage, nonce, now)).toBe(true);
    expect(consumeSensitiveActionContinuation(storage, organizationId, now)).toMatchObject({
      kind: "membership-revocation",
      organizationId,
      membershipId,
      reason: "Motivo auditável",
    });
    expect(consumeSensitiveActionContinuation(storage, organizationId, now)).toBeNull();
  });

  it("fails closed for an expired or wrong-tenant continuation", () => {
    const storage = new MemoryStorage();
    const expiredNonce = storeSensitiveActionContinuation(
      storage,
      { kind: "membership-revocation", organizationId, membershipId },
      "Motivo auditável",
      now,
    );
    expect(promoteSensitiveActionContinuation(storage, expiredNonce, now + 10 * 60_000)).toBe(
      false,
    );

    const tenantNonce = storeSensitiveActionContinuation(
      storage,
      { kind: "membership-revocation", organizationId, membershipId },
      "Motivo auditável",
      now,
    );
    expect(promoteSensitiveActionContinuation(storage, tenantNonce, now)).toBe(true);
    expect(
      consumeSensitiveActionContinuation(storage, "00000000-0000-4000-8000-000000000099", now),
    ).toBeNull();
  });

  it("clears an abandoned organization flow without replay", () => {
    const storage = new MemoryStorage();
    const nonce = storeSensitiveActionContinuation(
      storage,
      { kind: "membership-revocation", organizationId, membershipId },
      "Motivo auditável",
      now,
    );

    clearSensitiveActionContinuation(storage, nonce);

    expect(promoteSensitiveActionContinuation(storage, nonce, now + 1)).toBe(false);
    expect(consumeSensitiveActionContinuation(storage, organizationId, now + 2)).toBeNull();
  });
});
