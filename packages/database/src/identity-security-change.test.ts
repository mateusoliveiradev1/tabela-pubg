import { describe, expect, it } from "vitest";
import { isFreshIdentityReauthentication } from "./repositories/identity-security-change.js";

describe("identity security-change reauthentication", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");

  it.each([
    [null, false],
    [new Date("2026-08-24T11:49:59.999Z"), false],
    [new Date("2026-08-24T11:50:00.000Z"), false],
    [new Date("2026-08-24T11:50:00.001Z"), true],
    [new Date("2026-08-24T12:00:00.000Z"), true],
    [new Date("2026-08-24T12:00:00.001Z"), false],
  ])("classifies %s against the strict ten-minute window", (reauthenticatedAt, expected) => {
    expect(isFreshIdentityReauthentication(reauthenticatedAt, now)).toBe(expected);
  });
});
