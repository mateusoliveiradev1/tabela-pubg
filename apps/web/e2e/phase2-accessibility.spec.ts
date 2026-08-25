import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test.describe("phase 2 responsive and accessible flows", () => {
  test("login and the authorized shell have no serious axe violations or horizontal clipping", async ({
    page,
    phase2,
  }) => {
    await page.goto("/entrar");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expectAxeClean(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await phase2.signIn(page);
    await page.goto(`/o/${phase2.organizationSlug}`);
    await expectAxeClean(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("keyboard navigation reaches content and dialogs restore focus", async ({
    page,
    phase2,
  }) => {
    await phase2.signIn(page);
    await page.goto(`/o/${phase2.organizationSlug}`);
    const skipLink = page.getByRole("link", { name: "Pular para o conteúdo" });
    await reachWithKeyboard(page, skipLink);
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#platform-content")).toBeFocused();

    await phase2.ensureSecondarySession();
    await page.goto("/conta/sessoes");
    const trigger = page.getByRole("button", { name: "Encerrar sessão", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("mobile drawer closes with Escape and restores the trigger", async ({ page, phase2 }) => {
    test.skip(test.info().project.name !== "mobile-320", "mobile-only interaction");
    await phase2.signIn(page);
    await page.goto(`/o/${phase2.organizationSlug}`);
    const trigger = page.locator("#platform-drawer-trigger");
    await expect(trigger).toHaveAccessibleName("Abrir navegação");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAccessibleName("Fechar navegação");
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("invitation terminal and wrong-user states never reveal raw context", async ({
    page,
    phase2,
  }) => {
    await phase2.signIn(page);
    for (const state of ["expired", "revoked", "used", "invalid", "wrong-user"] as const) {
      const context = `${state}-${phase2.invitationContext}`;
      await page.goto(`/convites/aceitar?token=${context}`);
      await expect(page).toHaveURL(/\/convites\/aceitar$/);
      await expect(page.locator("body")).not.toContainText(context);
      await expect(page.locator("main")).toBeVisible();
    }
  });

  test("members and audit remain server-authoritative and cross-org safe", async ({
    page,
    phase2,
  }) => {
    await phase2.signIn(page);
    await page.goto(`/o/${phase2.organizationSlug}/membros`);
    await expect(page.getByRole("heading", { name: "Membros e permissões" })).toBeVisible();
    await expect(
      page.getByText("Transfira a propriedade antes de alterar este membro."),
    ).toBeVisible();
    await page.goto(`/o/${phase2.organizationSlug}/auditoria`);
    await expect(page.getByRole("heading", { name: "Auditoria", exact: true })).toBeVisible();
    await page.goto("/o/organizacao-inexistente/membros");
    await expect(page.getByText(/Não foi possível abrir esta área/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Arena externa");
  });

  test("reduced motion collapses authored animation and transition duration", async ({ page }) => {
    test.skip(test.info().project.name !== "reduced-motion", "reduced-motion project only");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/entrar");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      true,
    );
    const duration = await page
      .getByRole("button", { name: "Continuar com Discord" })
      .evaluate((element) => ({
        animation: getComputedStyle(element).animationDuration,
        transition: getComputedStyle(element).transitionDuration,
      }));
    expect(shortDurations(duration.animation)).toBe(true);
    expect(shortDurations(duration.transition), duration.transition).toBe(true);
  });
});

async function expectAxeClean(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

function horizontalOverflow(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

function shortDurations(value: string): boolean {
  return value.split(",").every((duration) => {
    const normalized = duration.trim();
    const numeric = Number.parseFloat(normalized);
    const seconds = normalized.endsWith("ms") ? numeric / 1_000 : numeric;
    return seconds <= 0.001;
  });
}

async function reachWithKeyboard(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
): Promise<void> {
  // Next's development toolbar participates in the tab order locally. The product link must
  // still be reachable using only the keyboard, regardless of development-only controls.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
}
