import { expect, test } from "./fixtures";

test.describe("phase 2 browser smoke", () => {
  test("authenticates with deterministic OTP and opens the seeded organization", async ({
    page,
    phase2,
  }) => {
    await phase2.signIn(page);
    await page.goto(`/o/${phase2.organizationSlug}`);
    await expect(page.getByRole("heading", { name: phase2.organizationName })).toBeVisible();
  });

  test("uploads exact PNG bytes, shows the branded invitation and revokes a session", async ({
    page,
    phase2,
  }) => {
    await phase2.signIn(page);
    await page.goto(`/o/${phase2.organizationSlug}/configuracoes`);
    await page.getByLabel("Selecionar logo").setInputFiles({
      name: "arena.png",
      mimeType: "image/png",
      buffer: phase2.logoBytes,
    });
    await page.getByRole("button", { name: "Salvar logo" }).click();
    await expect(page.getByRole("status")).toContainText("Logo atualizado");

    await page.goto(`/convites/aceitar?context=${phase2.invitationContext}`);
    const logo = page.getByRole("img", { name: new RegExp(phase2.organizationName) });
    await expect(logo).toBeVisible();
    const response = await page.request.get(await logo.getAttribute("src"));
    expect(Buffer.from(await response.body())).toEqual(phase2.logoBytes);

    await page.goto("/conta/sessoes");
    await expect(page.getByRole("heading", { name: "Sessões e dispositivos" })).toBeVisible();
    await page.getByRole("button", { name: /Encerrar sessão de Chrome/i }).click();
    await page.getByRole("button", { name: "Encerrar sessão", exact: true }).click();
    await expect(page.getByText("Sessão encerrada")).toBeVisible();
  });
});
