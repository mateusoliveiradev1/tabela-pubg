import { readFile } from "node:fs/promises";
import { test as base, expect, type Page } from "@playwright/test";
import { parsePhase2FixtureState, phase2FixtureStatePath } from "./auth-state.js";

const logoBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export interface Phase2Fixture {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  invitationContext: string;
  logoBytes: Buffer;
  signIn(page: Page): Promise<void>;
}

export const test = base.extend<{ phase2: Phase2Fixture }>({
  phase2: async ({ browserName }, use) => {
    if (browserName !== "chromium") throw new Error("phase 2 E2E is pinned to Chromium");
    const runId = process.env.E2E_RUN_ID;
    if (!runId || !/^run-[a-z0-9][a-z0-9-]{14,62}$/.test(runId)) {
      throw new Error("E2E_RUN_ID is required by browser fixtures");
    }
    const fixtureState = parsePhase2FixtureState(
      await readFile(phase2FixtureStatePath(process.env), "utf8"),
    );
    await use({
      ...fixtureState,
      logoBytes,
      async signIn(page) {
        const session = (await page.context().cookies()).find(
          (cookie) => cookie.name === "__Host-session",
        );
        if (!session) throw new Error("phase 2 reusable authentication state is missing");
        await page.goto("/");
        await page.waitForURL((url) => url.pathname === "/");
      },
    });
  },
});

export { expect };
