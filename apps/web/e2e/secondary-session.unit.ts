import { describe, expect, it } from "vitest";
import { phase2SecondarySessionScope } from "./secondary-session.js";

const runId = "run-0123456789abcdef";

describe("phase 2 secondary session scope", () => {
  it("derives different owned identities for different browser tests", () => {
    const first = phase2SecondarySessionScope(runId, "mobile keyboard dialog");
    const second = phase2SecondarySessionScope(runId, "desktop smoke revocation");
    expect(first.deviceDigest).not.toBe(second.deviceDigest);
    expect(first.tokenDigest).not.toBe(second.tokenDigest);
    expect(first.deviceDigest).toMatch(/^studio-run-0123456789abcdef-[0-9a-f]{16}$/);
  });

  it.each(["", "run-shared", "run-too-short"])(
    "rejects an unowned run scope: %s",
    (candidate) => {
      expect(() => phase2SecondarySessionScope(candidate, "browser test")).toThrow(
        "validated run scope",
      );
    },
  );
});
