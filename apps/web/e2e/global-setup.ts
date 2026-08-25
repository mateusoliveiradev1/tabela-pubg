import { chmod } from "node:fs/promises";
import { chromium, type FullConfig } from "@playwright/test";
import { phase2AuthStatePath, shouldBootstrapPhase2Auth } from "./auth-state.js";

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!shouldBootstrapPhase2Auth(process.env)) return;

  const statePath = phase2AuthStatePath(process.env);
  const baseURL = config.projects.find((project) => project.name === "desktop-1440")?.use.baseURL;
  if (typeof baseURL !== "string")
    throw new Error("phase 2 auth setup requires a browser base URL");

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill("organizer@example.com");
    await page.getByRole("button", { name: "Receber código" }).click();
    await page.getByRole("heading", { name: "Digite o código" }).waitFor();
    await page.getByLabel("Código de 8 dígitos").fill("12345678");
    await page.getByRole("button", { name: "Confirmar código" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await context.storageState({ path: statePath });
    await chmod(statePath, 0o600);
  } finally {
    await context.close();
    await browser.close();
  }
}
