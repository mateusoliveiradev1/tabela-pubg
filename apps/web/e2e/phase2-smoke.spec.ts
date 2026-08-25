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
    const [logoResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/logo") && response.ok()),
      page.getByRole("button", { name: "Salvar logo" }).click(),
    ]);
    const logoPayload = (await logoResponse.json()) as { url?: unknown };
    expect(typeof logoPayload.url).toBe("string");
    const uploaded = await page.request.get(logoPayload.url as string);
    expect(uploaded.ok()).toBe(true);
    expect(Buffer.from(await uploaded.body())).toEqual(phase2.logoBytes);

    await page.goto(`/convites/aceitar?token=${phase2.invitationContext}`);
    await expect(page.getByRole("heading", { name: phase2.organizationName })).toBeVisible();

    await phase2.ensureSecondarySession();
    await page.goto("/conta/sessoes");
    await expect(page.getByRole("heading", { name: "Sessões e dispositivos" })).toBeVisible();
    await page.getByRole("button", { name: "Encerrar sessão", exact: true }).click();
    await page.getByRole("button", { name: "Encerrar sessão agora" }).click();
    await expect(page.getByText(/Chrome do estúdio foi encerrado/)).toBeVisible();
  });
});
