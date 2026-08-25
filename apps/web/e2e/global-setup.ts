import { chmod, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import {
  otpCodeFromMailbox,
  phase2AuthStatePath,
  shouldBootstrapPhase2Auth,
} from "./auth-state.js";

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!shouldBootstrapPhase2Auth(process.env)) return;

  const statePath = phase2AuthStatePath(process.env);
  const mailRoot = requiredRunMailRoot(statePath, process.env.E2E_MAIL_ROOT);
  const baseURL = config.projects.find((project) => project.name === "desktop-1440")?.use.baseURL;
  if (typeof baseURL !== "string")
    throw new Error("phase 2 auth setup requires a browser base URL");

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill("organizer@example.com");
    const requested = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/identity/email/otp/sign-in/request"),
    );
    await page.getByRole("button", { name: "Receber código" }).click();
    const challengeId = (await requested).headers()["x-otp-challenge-id"];
    if (!challengeId) throw new Error("phase 2 auth setup did not receive an OTP challenge");
    await page.getByRole("heading", { name: "Digite o código" }).waitFor();
    const code = await waitForOtp(mailRoot, "organizer@example.com", challengeId);
    await page.getByLabel("Código de 8 dígitos").fill(code);
    await page.getByRole("button", { name: "Confirmar código" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await context.storageState({ path: statePath });
    await chmod(statePath, 0o600);
  } finally {
    await context.close();
    await browser.close();
  }
}

function requiredRunMailRoot(statePath: string, candidate: string | undefined): string {
  const expected = path.join(path.dirname(statePath), "mail");
  if (!candidate || path.resolve(candidate) !== expected) {
    throw new Error("phase 2 auth setup requires the exact run-owned mailbox root");
  }
  return expected;
}

async function waitForOtp(
  mailRoot: string,
  recipient: string,
  challengeId: string,
): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const name of await readdir(mailRoot)) {
      if (!name.endsWith(".json")) continue;
      const code = otpCodeFromMailbox(
        await readFile(path.join(mailRoot, name), "utf8"),
        recipient,
        challengeId,
      );
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("phase 2 auth setup mailbox timed out");
}
