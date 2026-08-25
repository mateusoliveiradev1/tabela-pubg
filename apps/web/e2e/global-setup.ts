import { createHash, randomUUID } from "node:crypto";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type FullConfig, type Page } from "@playwright/test";
import {
  otpCodeFromMailbox,
  type Phase2FixtureState,
  phase2AuthStatePath,
  phase2FixtureStatePath,
  shouldBootstrapPhase2Auth,
} from "./auth-state.js";

const ORGANIZER_EMAIL = "organizer@example.com";
const ORGANIZATION_NAME = "Arena Alpha";

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!shouldBootstrapPhase2Auth(process.env)) return;

  const statePath = phase2AuthStatePath(process.env);
  const fixturePath = phase2FixtureStatePath(process.env);
  const mailRoot = requiredRunMailRoot(statePath, process.env.E2E_MAIL_ROOT);
  const baseURL = config.projects.find((project) => project.name === "desktop-1440")?.use.baseURL;
  if (typeof baseURL !== "string")
    throw new Error("phase 2 auth setup requires a browser base URL");

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await signIn(page, mailRoot);
    const csrf = await acquireCsrf(page);
    const organization = await createOrganization(page, csrf);
    const invitee = `invitee-${requiredRunId()}@example.test`;
    await createInvitation(page, csrf, organization.organizationId, invitee);
    const invitationContext = await waitForInvitationToken(mailRoot, invitee);
    await seedSecondarySession();
    const fixture: Phase2FixtureState = { ...organization, invitationContext };
    await writeFile(fixturePath, `${JSON.stringify(fixture)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await context.storageState({ path: statePath });
    await chmod(statePath, 0o600);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function signIn(page: Page, mailRoot: string): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(ORGANIZER_EMAIL);
  const requested = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/identity/email/otp/sign-in/request"),
  );
  await page.getByRole("button", { name: "Receber código" }).click();
  const challengeId = (await requested).headers()["x-otp-challenge-id"];
  if (!challengeId) throw new Error("phase 2 auth setup did not receive an OTP challenge");
  await page.getByRole("heading", { name: "Digite o código" }).waitFor();
  const code = await waitForOtp(mailRoot, ORGANIZER_EMAIL, challengeId);
  await page.getByLabel("Código de 8 dígitos").fill(code);
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function acquireCsrf(page: Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/platform/security/csrf", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    return { status: response.status, token: response.headers.get("x-csrf-token") };
  });
  if (result.status !== 200 || !result.token)
    throw new Error("phase 2 fixture could not acquire CSRF");
  return result.token;
}

async function createOrganization(
  page: Page,
  csrf: string,
): Promise<Omit<Phase2FixtureState, "invitationContext">> {
  const response = await browserForm(page, "/api/platform/organizations", csrf, {
    name: ORGANIZATION_NAME,
  });
  if (response.status !== 201) throw new Error("phase 2 fixture could not create organization");
  const body: unknown = response.body;
  if (!body || typeof body !== "object" || !("organization" in body)) {
    throw new Error("phase 2 fixture received an invalid organization response");
  }
  const organization = (body as { organization: Record<string, unknown> }).organization;
  if (
    typeof organization.id !== "string" ||
    typeof organization.slug !== "string" ||
    organization.name !== ORGANIZATION_NAME
  ) {
    throw new Error("phase 2 fixture received incomplete organization metadata");
  }
  return {
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: ORGANIZATION_NAME,
  };
}

async function createInvitation(
  page: Page,
  csrf: string,
  organizationId: string,
  email: string,
): Promise<void> {
  const response = await browserJson(
    page,
    "POST",
    `/api/platform/organizations/${organizationId}/invitations`,
    csrf,
    { email, organizationRole: "member", assignments: [] },
  );
  if (response.status !== 201) throw new Error("phase 2 fixture could not create invitation");
}

async function browserForm(
  page: Page,
  url: string,
  csrf: string,
  fields: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ url, csrf, fields }) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "x-csrf-token": csrf },
        body: form,
      });
      return { status: response.status, body: await response.json() };
    },
    { url, csrf, fields },
  );
}

async function browserJson(
  page: Page,
  method: string,
  url: string,
  csrf: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ method, url, csrf, body }) => {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { method, url, csrf, body },
  );
}

async function seedSecondarySession(): Promise<void> {
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const databaseRequire = createRequire(
    path.join(repositoryRoot, "packages/database/package.json"),
  );
  const postgresModule = databaseRequire("postgres");
  const postgres = postgresModule.default ?? postgresModule;
  const sql = postgres(required("DATABASE_URL"), { max: 1, prepare: false });
  try {
    const [user] = await sql`
      select user_id from verified_emails
      where normalized_email = ${ORGANIZER_EMAIL} and revoked_at is null
      limit 1
    `;
    if (!user?.user_id) throw new Error("phase 2 fixture could not resolve organizer user");
    const deviceId = randomUUID();
    const sessionId = randomUUID();
    const runId = requiredRunId();
    await sql.begin(async (transaction: typeof sql) => {
      await transaction`
        insert into devices (
          id, user_id, device_digest, label, browser, operating_system,
          first_seen_at, last_seen_at
        ) values (
          ${deviceId}, ${user.user_id}, ${`studio-${runId}`}, 'Chrome do estúdio',
          'Chrome', 'Windows', now() - interval '1 day', now() - interval '1 hour'
        )
      `;
      await transaction`
        insert into sessions (
          id, user_id, device_id, token_digest, issued_at, last_seen_at,
          idle_expires_at, absolute_expires_at, reauthenticated_at
        ) values (
          ${sessionId}, ${user.user_id}, ${deviceId},
          ${createHash("sha256").update(`studio-session:${runId}`).digest("hex")},
          now() - interval '1 day', now() - interval '1 hour',
          now() + interval '29 days', now() + interval '89 days', now() - interval '1 hour'
        )
      `;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

function requiredRunId(): string {
  const runId = process.env.E2E_RUN_ID;
  if (!runId || !/^run-[a-z0-9][a-z0-9-]{14,62}$/.test(runId)) {
    throw new Error("phase 2 fixture requires a validated run scope");
  }
  return runId;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by phase 2 fixture setup`);
  return value;
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
  const message = await waitForMailbox(mailRoot, recipient, (text) => text.includes(challengeId));
  const code = otpCodeFromMailbox(message, recipient, challengeId);
  if (!code) throw new Error("phase 2 auth setup mailbox did not contain an OTP code");
  return code;
}

async function waitForInvitationToken(mailRoot: string, recipient: string): Promise<string> {
  const message = await waitForMailbox(mailRoot, recipient, (text) =>
    /convites\/aceitar#token=/.test(text),
  );
  const match = /convites\/aceitar#token=([A-Za-z0-9_-]{16,512})/.exec(message);
  if (!match) throw new Error("phase 2 fixture mailbox did not contain an invitation context");
  return match[1];
}

async function waitForMailbox(
  mailRoot: string,
  recipient: string,
  matches: (text: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const name of await readdir(mailRoot)) {
      if (!name.endsWith(".json")) continue;
      const message = await readFile(path.join(mailRoot, name), "utf8");
      if (message.includes(recipient) && matches(message)) return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`phase 2 fixture mailbox timed out for ${recipient}`);
}
