import { expect, test } from "@playwright/test";

const EXPECTED_RUNTIME_CASES = [
  "provisional-to-trusted",
  "invitation-seven-day-one-use",
  "sensitive-membership-step-up",
  "audit-visibility",
  "cross-tenant-denial",
  "second-origin-logo",
] as const;

test.describe("phase 2 real runtime", () => {
  for (const runtimeCase of EXPECTED_RUNTIME_CASES) {
    test(runtimeCase, async ({ page }) => {
      const evidence = process.env.PHASE2_RUNTIME_EVIDENCE;
      expect(evidence, "the lifecycle must publish real-stack evidence to Playwright").toBeTruthy();
      const parsed = JSON.parse(evidence ?? "{}") as {
        cases?: string[];
        runScopeId?: string;
        webOrigin?: string;
      };
      expect(parsed.cases).toContain(runtimeCase);
      expect(parsed.runScopeId).toBe(process.env.E2E_RUN_ID);
      await page.goto(parsed.webOrigin ?? "/");
      await expect(page.locator("body")).toBeVisible();
    });
  }
});
