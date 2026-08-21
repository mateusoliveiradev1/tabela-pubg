import { test as base, expect, type Page } from "@playwright/test";

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
    await use({
      organizationId: "00000000-0000-4000-8000-000000000111",
      organizationSlug: "arena-alpha",
      organizationName: "Arena Alpha",
      invitationContext: `invite-${runId}-0123456789abcdef`,
      logoBytes,
      async signIn(page) {
        await page.goto("/entrar");
        await page.getByLabel("E-mail").fill("organizer@example.com");
        await page.getByRole("button", { name: "Receber código" }).click();
        await expect(page.getByRole("heading", { name: "Digite o código" })).toBeVisible();
        await page.getByLabel("Código de 8 dígitos").fill("12345678");
        await page.getByRole("button", { name: "Confirmar código" }).click();
        await page.waitForURL((url) => url.pathname === "/");
      },
    });
  },
});

export { expect };
