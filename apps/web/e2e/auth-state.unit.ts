import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  otpCodeFromMailbox,
  phase2AuthStatePath,
  shouldBootstrapPhase2Auth,
} from "./auth-state.js";

const runId = "run-abcdef0123456789abcdef01";
const root = path.join(tmpdir(), "pubg-camp-phase2-e2e-auth-state");

describe("phase 2 reusable browser authentication state", () => {
  it("derives one deterministic state file inside the exact run root", () => {
    const environment = { E2E_RUN_ID: runId, E2E_OBJECT_ROOT: root };

    expect(phase2AuthStatePath(environment)).toBe(
      path.join(root, runId, "playwright-auth-state.json"),
    );
    expect(phase2AuthStatePath(environment)).toBe(phase2AuthStatePath(environment));
  });

  it.each([
    [{ E2E_OBJECT_ROOT: root }, "run scope"],
    [{ E2E_RUN_ID: "run-shared-012345678901", E2E_OBJECT_ROOT: root }, "run scope"],
    [{ E2E_RUN_ID: runId, E2E_OBJECT_ROOT: path.join(tmpdir(), "foreign-root") }, "owned root"],
  ])("rejects an unsafe state target", (environment, message) => {
    expect(() => phase2AuthStatePath(environment)).toThrow(message);
  });

  it("bootstraps once for smoke/full browser runs and stays out of the owned runtime project", () => {
    expect(shouldBootstrapPhase2Auth({})).toBe(true);
    expect(shouldBootstrapPhase2Auth({ E2E_BROWSER_AUTH_MODE: "shared" })).toBe(true);
    expect(shouldBootstrapPhase2Auth({ E2E_BROWSER_AUTH_MODE: "runtime" })).toBe(false);
  });

  it("extracts an OTP only from the mailbox entry bound to recipient and challenge", () => {
    const message = JSON.stringify({
      recipient: "organizer@example.com",
      body: "Challenge 018f1f3d-7b8c-4fb0-9d5a-7a77d7f4f4a1 code 87654321",
    });

    expect(
      otpCodeFromMailbox(message, "organizer@example.com", "018f1f3d-7b8c-4fb0-9d5a-7a77d7f4f4a1"),
    ).toBe("87654321");
    expect(
      otpCodeFromMailbox(message, "other@example.com", "018f1f3d-7b8c-4fb0-9d5a-7a77d7f4f4a1"),
    ).toBeNull();
    expect(otpCodeFromMailbox(message, "organizer@example.com", "missing-challenge")).toBeNull();
  });
});
