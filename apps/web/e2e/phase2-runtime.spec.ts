import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const EXPECTED_RUNTIME_CASES = [
  "provisional-to-trusted",
  "invitation-seven-day-one-use",
  "sensitive-membership-step-up",
  "audit-visibility",
  "cross-tenant-denial",
  "second-origin-logo",
] as const;
const repositoryRoot = path.resolve(process.cwd(), "../..");
const databaseRequire = createRequire(path.join(repositoryRoot, "packages/database/package.json"));
const postgresModule = databaseRequire("postgres");
const postgres = postgresModule.default ?? postgresModule;
const evidence = parseEvidence();
const ownerEmail = `owner-${evidence.runScopeId}@example.test`;
const adminEmail = `admin-${evidence.runScopeId}@example.test`;
const memberEmail = `member-${evidence.runScopeId}@example.test`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type RuntimeState = {
  ownerContext: BrowserContext;
  ownerPage: Page;
  adminContext?: BrowserContext;
  adminPage?: Page;
  memberContext?: BrowserContext;
  memberPage?: Page;
  sql: ReturnType<typeof postgres>;
  csrf: string;
  ownerUserId: string;
  ownerSessionId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  scopeId: string;
  adminMembershipId: string;
  memberMembershipId: string;
};

test.describe
  .serial("phase 2 real runtime", () => {
    const state = {} as RuntimeState;
    test.setTimeout(180_000);

    test.beforeAll(async ({ browser }) => {
      expect(new Set(evidence.cases)).toEqual(new Set(EXPECTED_RUNTIME_CASES));
      expect(evidence.runScopeId).toBe(process.env.E2E_RUN_ID);
      state.sql = postgres(required("DATABASE_URL"), { max: 1, prepare: false });
      state.ownerContext = await browser.newContext({ baseURL: evidence.webOrigin });
      state.ownerPage = await state.ownerContext.newPage();
    });

    test.afterAll(async () => {
      await Promise.all([
        state.ownerContext?.close(),
        state.adminContext?.close(),
        state.memberContext?.close(),
      ]);
      await state.sql?.end({ timeout: 2 });
    });

    test("provisional-to-trusted", async () => {
      const page = state.ownerPage;
      await page.goto("/entrar");
      state.csrf = await acquireCsrf(page);
      const oldToken = await discordSignIn(page, state.csrf);
      state.csrf = await acquireCsrf(page);

      const denied = await browserForm(page, "/api/platform/organizations", state.csrf, {
        name: "Denied Provisional Organization",
      });
      expect(denied.status).toBe(403);
      const [deniedCount] = await state.sql`
      select count(*)::int as count from organizations where name = 'Denied Provisional Organization'
    `;
      expect(deniedCount.count).toBe(0);

      const challenge = await requestOtp(page, "verify-provisional-email", ownerEmail, state.csrf);
      const code = await waitForOtp(ownerEmail, challenge);
      const promoted = await browserJson(
        page,
        "POST",
        "/api/platform/identity/email/otp/verify-provisional-email/verify",
        state.csrf,
        { challengeId: challenge, email: ownerEmail, code },
      );
      expect(promoted.status).toBe(201);
      const replacementToken = await sessionToken(state.ownerContext);
      expect(replacementToken).not.toBe(oldToken);
      const oldResponse = await fetch(`${evidence.apiOrigin}/platform/organizations`, {
        headers: { cookie: `__Host-session=${oldToken}`, origin: evidence.webOrigin },
      });
      expect(oldResponse.status).toBe(401);
      state.csrf = promoted.headers["x-csrf-token"] ?? (await acquireCsrf(page));

      state.organizationName = `Runtime ${evidence.runScopeId.slice(-8)}`;
      const created = await browserForm(page, "/api/platform/organizations", state.csrf, {
        name: state.organizationName,
      });
      expect(created.status).toBe(201);
      const body = created.body as {
        organization: { id: string; slug: string; name: string; membershipRole: string };
      };
      expect(body.organization).toMatchObject({
        name: state.organizationName,
        membershipRole: "owner",
      });
      state.organizationId = body.organization.id;
      state.organizationSlug = body.organization.slug;
      const [owner] = await state.sql`
      select om.user_id, s.id as session_id
      from organization_memberships om
      join sessions s on s.user_id = om.user_id and s.revoked_at is null
      where om.organization_id = ${state.organizationId} and om.role = 'owner'
      order by s.created_at desc limit 1
    `;
      state.ownerUserId = owner.user_id;
      state.ownerSessionId = owner.session_id;
    });

    test("invitation-seven-day-one-use", async ({ browser }) => {
      state.scopeId = randomUUID();
      await state.sql`
      insert into authorization_scopes (id, organization_id, kind, label)
      values (${state.scopeId}, ${state.organizationId}, 'tournament', 'Runtime Championship')
    `;
      const invite = await browserJson(
        state.ownerPage,
        "POST",
        `/api/platform/organizations/${state.organizationId}/invitations`,
        state.csrf,
        {
          email: adminEmail,
          organizationRole: "admin",
          assignments: [
            { authorizationScopeId: state.scopeId, role: "referee" },
            { authorizationScopeId: state.scopeId, role: "broadcast" },
          ],
        },
      );
      expect(invite.status).toBe(201);
      const [invitation] = await state.sql`
      select id, issued_at, expires_at from invitations
      where organization_id = ${state.organizationId} and normalized_email = ${adminEmail}
    `;
      expect(
        new Date(invitation.expires_at).getTime() - new Date(invitation.issued_at).getTime(),
      ).toBe(7 * 86_400_000);
      const token = await waitForInvitationToken(adminEmail);

      const wrongEmail = `wrong-${evidence.runScopeId}@example.test`;
      const wrongContext = await browser.newContext({ baseURL: evidence.webOrigin });
      const wrongPage = await wrongContext.newPage();
      const wrongCsrf = await signInEmail(wrongPage, wrongEmail);
      const mismatchedPreview = await browserJson(
        wrongPage,
        "POST",
        "/api/platform/invitations/preview",
        wrongCsrf,
        { context: token },
      );
      expect(mismatchedPreview.body).toMatchObject({ status: "valid", emailMatches: false });
      const mismatchedAcceptance = await browserJson(
        wrongPage,
        "POST",
        "/api/platform/invitations/accept",
        wrongCsrf,
        { confirmation: true },
      );
      expect(mismatchedAcceptance.status).toBeGreaterThanOrEqual(400);
      const [unchangedInvitation] = await state.sql`
      select accepted_at from invitations where id = ${invitation.id}
    `;
      expect(unchangedInvitation.accepted_at).toBeNull();
      await wrongContext.close();

      state.adminContext = await browser.newContext({ baseURL: evidence.webOrigin });
      state.adminPage = await state.adminContext.newPage();
      let adminCsrf = await signInEmail(state.adminPage, adminEmail);
      const preview = await browserJson(
        state.adminPage,
        "POST",
        "/api/platform/invitations/preview",
        adminCsrf,
        { context: token },
      );
      expect(preview.body).toMatchObject({ status: "valid", emailMatches: true });
      const accepted = await browserJson(
        state.adminPage,
        "POST",
        "/api/platform/invitations/accept",
        adminCsrf,
        { confirmation: true },
      );
      expect(accepted.status).toBe(201);
      const [effectsBeforeReplay] = await state.sql`
      select
        (select count(*)::int from organization_memberships om
          join verified_emails ve on ve.user_id = om.user_id and ve.revoked_at is null
          where om.organization_id = ${state.organizationId}
            and ve.normalized_email = ${adminEmail}) as memberships,
        (select count(*)::int from audit_events
          where organization_id = ${state.organizationId}
            and action = 'invitation.accepted') as audits,
        (select count(*)::int from outbox_events
          where aggregate_id = ${invitation.id}
            and event_type = 'invitation.accepted') as outbox
    `;
      const replay = await browserJson(
        state.adminPage,
        "POST",
        "/api/platform/invitations/accept",
        adminCsrf,
        { confirmation: true },
      );
      expect(replay.status).toBeGreaterThanOrEqual(400);
      const [effectsAfterReplay] = await state.sql`
      select
        (select count(*)::int from organization_memberships om
          join verified_emails ve on ve.user_id = om.user_id and ve.revoked_at is null
          where om.organization_id = ${state.organizationId}
            and ve.normalized_email = ${adminEmail}) as memberships,
        (select count(*)::int from audit_events
          where organization_id = ${state.organizationId}
            and action = 'invitation.accepted') as audits,
        (select count(*)::int from outbox_events
          where aggregate_id = ${invitation.id}
            and event_type = 'invitation.accepted') as outbox
    `;
      expect(effectsAfterReplay).toEqual(effectsBeforeReplay);
      expect(effectsAfterReplay).toMatchObject({ memberships: 1, audits: 1, outbox: 1 });
      const [adminMembership] = await state.sql`
      select om.id, om.role,
        coalesce(array_agg(ra.role order by ra.role) filter (where ra.id is not null), '{}') as assignments
      from organization_memberships om
      join verified_emails ve on ve.user_id = om.user_id and ve.revoked_at is null
      left join role_assignments ra on ra.membership_id = om.id and ra.status = 'active'
      where om.organization_id = ${state.organizationId} and ve.normalized_email = ${adminEmail}
      group by om.id, om.role
    `;
      expect(adminMembership).toMatchObject({
        role: "admin",
      });
      expect([...adminMembership.assignments].sort()).toEqual(["broadcast", "referee"]);
      state.adminMembershipId = adminMembership.id;

      const expiredEmail = `expired-${evidence.runScopeId}@example.test`;
      const expiredInvite = await browserJson(
        state.ownerPage,
        "POST",
        `/api/platform/organizations/${state.organizationId}/invitations`,
        state.csrf,
        { email: expiredEmail, organizationRole: "member", assignments: [] },
      );
      expect(expiredInvite.status).toBe(201);
      const expiredToken = await waitForInvitationToken(expiredEmail);
      await state.sql`
      update invitations set issued_at = now() - interval '8 days', expires_at = now() - interval '1 day'
      where organization_id = ${state.organizationId} and normalized_email = ${expiredEmail}
    `;
      const expiredContext = await browser.newContext({ baseURL: evidence.webOrigin });
      const expiredPage = await expiredContext.newPage();
      const expiredCsrf = await signInEmail(expiredPage, expiredEmail);
      const expiredPreview = await browserJson(
        expiredPage,
        "POST",
        "/api/platform/invitations/preview",
        expiredCsrf,
        { context: expiredToken },
      );
      expect(expiredPreview.body).toEqual({ status: "expired" });
      await expiredContext.close();
      adminCsrf = await acquireCsrf(state.adminPage);
      expect(adminCsrf).toBeTruthy();
    });

    test("sensitive-membership-step-up", async ({ browser }) => {
      state.memberContext = await browser.newContext({ baseURL: evidence.webOrigin });
      state.memberPage = await state.memberContext.newPage();
      await signInEmail(state.memberPage, memberEmail);
      const [memberUser] = await state.sql`
      select user_id from verified_emails where normalized_email = ${memberEmail} and revoked_at is null
    `;
      state.memberMembershipId = randomUUID();
      await state.sql`
      insert into organization_memberships (id, organization_id, user_id, role, status)
      values (${state.memberMembershipId}, ${state.organizationId}, ${memberUser.user_id}, 'member', 'active')
    `;
      const targetUserId = randomUUID();
      const targetMembershipId = randomUUID();
      await state.sql`insert into users (id, display_name) values (${targetUserId}, 'Revocation Target')`;
      await state.sql`
      insert into organization_memberships (id, organization_id, user_id, role, status)
      values (${targetMembershipId}, ${state.organizationId}, ${targetUserId}, 'member', 'active')
    `;

      await clearStepUp();
      const auditsBeforeRole = await auditCount();
      const deniedRole = await updateMember(state.memberMembershipId, "member", []);
      expect(deniedRole.status).toBeGreaterThanOrEqual(400);
      expect(await auditCount()).toBe(auditsBeforeRole);
      state.csrf = await discordStepUp(state.ownerPage);
      const updatedRole = await updateMember(state.memberMembershipId, "member", [
        { authorizationScopeId: state.scopeId, role: "analyst" },
      ]);
      expect(updatedRole.status).toBe(200);
      expect(await auditCount()).toBe(auditsBeforeRole + 1);

      await clearStepUp();
      const auditsBeforeRevoke = await auditCount();
      const deniedRevoke = await revokeMember(targetMembershipId);
      expect(deniedRevoke.status).toBeGreaterThanOrEqual(400);
      expect(await auditCount()).toBe(auditsBeforeRevoke);
      state.csrf = await discordStepUp(state.ownerPage);
      const revoked = await revokeMember(targetMembershipId);
      expect(revoked.status).toBe(201);
      expect(await auditCount()).toBe(auditsBeforeRevoke + 1);

      const [ownerMembership] = await state.sql`
      select id from organization_memberships
      where organization_id = ${state.organizationId} and user_id = ${state.ownerUserId}
    `;
      const auditsBeforeLastOwner = await auditCount();
      const deniedLastOwnerRevocation = await revokeMember(ownerMembership.id);
      expect(deniedLastOwnerRevocation.status).toBeGreaterThanOrEqual(400);
      expect(await auditCount()).toBe(auditsBeforeLastOwner);
      const [preservedOwner] = await state.sql`
      select role, status from organization_memberships where id = ${ownerMembership.id}
    `;
      expect(preservedOwner).toMatchObject({ role: "owner", status: "active" });

      await clearStepUp();
      const auditsBeforeTransfer = await auditCount();
      const deniedTransfer = await transferOwnership();
      expect(deniedTransfer.status).toBeGreaterThanOrEqual(400);
      expect(await auditCount()).toBe(auditsBeforeTransfer);
      state.csrf = await discordStepUp(state.ownerPage);
      const transferred = await transferOwnership();
      expect(transferred.status).toBe(201);
      expect(await auditCount()).toBe(auditsBeforeTransfer + 1);
      const [formerOwner] = await state.sql`
      select role from organization_memberships
      where organization_id = ${state.organizationId} and user_id = ${state.ownerUserId}
    `;
      expect(formerOwner.role).toBe("member");
      await state.sql`
      update organization_memberships set role = 'admin'
      where organization_id = ${state.organizationId} and user_id = ${state.ownerUserId}
    `;

      async function clearStepUp() {
        await state.sql`update sessions set reauthenticated_at = null where id = ${state.ownerSessionId}`;
      }
      async function auditCount() {
        const [row] = await state.sql`
        select count(*)::int as count from audit_events where organization_id = ${state.organizationId}
      `;
        return row.count as number;
      }
      function updateMember(
        membershipId: string,
        organizationRole: string,
        assignments: unknown[],
      ) {
        return browserJson(
          state.ownerPage,
          "PATCH",
          `/api/platform/organizations/${state.organizationId}/members/${membershipId}`,
          state.csrf,
          { organizationRole, assignments, reason: "Runtime role update evidence" },
        );
      }
      function revokeMember(membershipId: string) {
        return browserJson(
          state.ownerPage,
          "POST",
          `/api/platform/organizations/${state.organizationId}/members/${membershipId}/revoke`,
          state.csrf,
          { reason: "Runtime revocation evidence" },
        );
      }
      function transferOwnership() {
        return browserJson(
          state.ownerPage,
          "POST",
          `/api/platform/organizations/${state.organizationId}/ownership/transfer`,
          state.csrf,
          {
            targetMembershipId: state.adminMembershipId,
            organizationNameConfirmation: state.organizationName,
            reason: "Runtime ownership transfer evidence",
          },
        );
      }
    });

    test("audit-visibility", async () => {
      const ownerView = await browserGet(
        state.adminPage as Page,
        `/api/platform/organizations/${state.organizationId}/audit?visibility=self&pageSize=3`,
      );
      const adminView = await browserGet(
        state.ownerPage,
        `/api/platform/organizations/${state.organizationId}/audit?visibility=self&pageSize=3`,
      );
      const memberView = await browserGet(
        state.memberPage as Page,
        `/api/platform/organizations/${state.organizationId}/audit?visibility=all&pageSize=3`,
      );
      expect([ownerView.status, adminView.status, memberView.status]).toEqual([200, 200, 200]);
      const ownerAudit = ownerView.body as { visibility: string; events: unknown[] };
      const adminAudit = adminView.body as { visibility: string; events: unknown[] };
      const memberAudit = memberView.body as { visibility: string; events: { actorId?: string }[] };
      expect(ownerAudit.visibility).toBe("all");
      expect(adminAudit.visibility).toBe("all");
      expect(memberAudit.visibility).toBe("self");
      expect(memberAudit.events.every((event) => !event.actorId)).toBe(true);
      expect(ownerAudit.events.length).toBeGreaterThanOrEqual(3);
    });

    test("cross-tenant-denial", async () => {
      const foreignOrganizationId = randomUUID();
      const auditBefore = await state.sql`select count(*)::int as count from audit_events`;
      const denied = await browserJson(
        state.ownerPage,
        "PATCH",
        `/api/platform/organizations/${foreignOrganizationId}/members/${state.memberMembershipId}`,
        state.csrf,
        { organizationRole: "admin", assignments: [], reason: "Cross tenant attempt blocked" },
      );
      expect(denied.status).toBe(403);
      const auditAfter = await state.sql`select count(*)::int as count from audit_events`;
      expect(auditAfter[0].count).toBe(auditBefore[0].count);
    });

    test("second-origin-logo", async () => {
      const uploaded = await state.ownerPage.evaluate(
        async ({ organizationId, csrf, bytes }) => {
          const form = new FormData();
          form.set(
            "logo",
            new File([Uint8Array.from(bytes)], "runtime.png", { type: "image/png" }),
          );
          const response = await fetch(`/api/platform/organizations/${organizationId}/logo`, {
            method: "PUT",
            credentials: "same-origin",
            headers: { "x-csrf-token": csrf },
            body: form,
          });
          return { status: response.status, body: await response.json() };
        },
        { organizationId: state.organizationId, csrf: state.csrf, bytes: [...png] },
      );
      expect(uploaded.status).toBe(200);
      const url = (uploaded.body as { url: string }).url;
      expect(new URL(url).origin).toBe(evidence.logoOrigin);
      await state.ownerPage.goto(`/o/${state.organizationSlug}`);
      const loaded = await state.ownerPage.evaluate(
        (source) =>
          new Promise<boolean>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image.naturalWidth === 1);
            image.onerror = () => resolve(false);
            image.src = source;
            document.body.append(image);
          }),
        url,
      );
      expect(loaded).toBe(true);
      const response = await state.ownerPage.request.get(url);
      expect(response.status()).toBe(200);
      expect(Buffer.from(await response.body())).toEqual(png);
    });
  });

async function acquireCsrf(page: Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/platform/security/csrf", {
      credentials: "same-origin",
      cache: "no-store",
    });
    return { status: response.status, token: response.headers.get("x-csrf-token") };
  });
  expect(result.status).toBe(200);
  expect(result.token).toBeTruthy();
  return result.token as string;
}

async function discordSignIn(page: Page, csrf: string): Promise<string> {
  const started = await startDiscordNavigation(page, "sign-in", csrf);
  const location = started.headers().location;
  expect(location).toBeTruthy();
  const state = new URL(location).searchParams.get("state");
  expect(state).toBeTruthy();
  await page.goto("/entrar");
  const callback = await browserJson(
    page,
    "POST",
    "/api/platform/identity/oauth/discord/sign-in/callback",
    csrf,
    { purpose: "sign-in", code: "e2e-code", state },
  );
  expect(callback.status).toBe(201);
  return sessionToken(page.context());
}

async function discordStepUp(page: Page): Promise<string> {
  const csrf = await acquireCsrf(page);
  const started = await startDiscordNavigation(page, "step-up", csrf);
  const state = new URL(started.headers().location).searchParams.get("state");
  await page.goto("/");
  const callback = await browserJson(
    page,
    "POST",
    "/api/platform/identity/oauth/discord/step-up/callback",
    csrf,
    { purpose: "step-up", code: "e2e-code", state },
  );
  expect(callback.status).toBe(201);
  return callback.headers["x-csrf-token"] ?? acquireCsrf(page);
}

async function startDiscordNavigation(page: Page, purpose: "sign-in" | "step-up", csrf: string) {
  const routePath = `/api/platform/identity/oauth/discord/${purpose}/start`;
  await page.route("https://discord.com/**", (route) => route.abort());
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === routePath,
  );
  await page.evaluate(
    ({ routePath, purpose, csrf }) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = routePath;
      for (const [name, value] of Object.entries({
        csrfToken: csrf,
        purpose,
        returnPath: "/",
      })) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
    },
    { routePath, purpose, csrf },
  );
  const response = await responsePromise;
  await page.unroute("https://discord.com/**");
  expect(response.status()).toBe(302);
  return response;
}

async function signInEmail(page: Page, email: string): Promise<string> {
  await page.goto("/entrar");
  let csrf = await acquireCsrf(page);
  const challenge = await requestOtp(page, "sign-in", email, csrf);
  const code = await waitForOtp(email, challenge);
  const verified = await browserJson(
    page,
    "POST",
    "/api/platform/identity/email/otp/sign-in/verify",
    csrf,
    { challengeId: challenge, email, code },
  );
  expect(verified.status).toBe(201);
  csrf = verified.headers["x-csrf-token"] ?? (await acquireCsrf(page));
  return csrf;
}

async function requestOtp(
  page: Page,
  purpose: "sign-in" | "verify-provisional-email",
  email: string,
  csrf: string,
): Promise<string> {
  const requested = await browserJson(
    page,
    "POST",
    `/api/platform/identity/email/otp/${purpose}/request`,
    csrf,
    { email },
  );
  expect(requested.status, JSON.stringify(requested.body)).toBe(201);
  const challenge = requested.headers["x-otp-challenge-id"];
  expect(challenge).toBeTruthy();
  return challenge as string;
}

async function waitForOtp(email: string, challengeId: string): Promise<string> {
  const message = await waitForMailbox(email, (text) => text.includes(challengeId));
  const match = /\b(\d{8})\b/.exec(message);
  if (!match) throw new Error("OTP mailbox did not contain an eight-digit code");
  return match[1];
}

async function waitForInvitationToken(email: string): Promise<string> {
  const message = await waitForMailbox(email, (text) => /convites\/aceitar#token=/.test(text));
  const match = /convites\/aceitar#token=([A-Za-z0-9_-]{16,512})/.exec(message);
  if (!match) throw new Error("invitation mailbox did not contain its opaque token");
  return decodeURIComponent(match[1]);
}

async function waitForMailbox(email: string, matches: (text: string) => boolean): Promise<string> {
  const root = required("E2E_MAIL_ROOT");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const name of await readdir(root)) {
      if (!name.endsWith(".json")) continue;
      const text = await readFile(path.join(root, name), "utf8");
      if (text.includes(email) && matches(text)) return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`mailbox evidence timed out for ${email}`);
}

async function browserJson(
  page: Page,
  method: string,
  url: string,
  csrf: string,
  body: unknown,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return page.evaluate(
    async ({ method, url, csrf, body }) => {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-correlation-id": crypto.randomUUID(),
          "x-csrf-token": csrf,
        },
        body: JSON.stringify(body),
      });
      const headers = Object.fromEntries(response.headers.entries());
      return { status: response.status, body: await response.json(), headers };
    },
    { method, url, csrf, body },
  );
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
        headers: { "x-correlation-id": crypto.randomUUID(), "x-csrf-token": csrf },
        body: form,
      });
      return { status: response.status, body: await response.json() };
    },
    { url, csrf, fields },
  );
}

async function browserGet(page: Page, url: string): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, { credentials: "same-origin", cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, url);
}

async function sessionToken(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((candidate) => candidate.name === "__Host-session");
  expect(cookie).toBeTruthy();
  return cookie?.value as string;
}

function parseEvidence(): {
  cases: string[];
  runScopeId: string;
  webOrigin: string;
  apiOrigin: string;
  logoOrigin: string;
} {
  const raw = process.env.PHASE2_RUNTIME_EVIDENCE;
  if (!raw) {
    return {
      cases: [...EXPECTED_RUNTIME_CASES],
      runScopeId: process.env.E2E_RUN_ID ?? "run-list-abcdef0123456789",
      webOrigin: process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3100",
      apiOrigin: process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3101",
      logoOrigin: process.env.E2E_LOGO_ORIGIN ?? "http://127.0.0.1:3103",
    };
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.cases) || parsed.cases.length !== EXPECTED_RUNTIME_CASES.length) {
    throw new Error("runtime evidence case inventory is invalid");
  }
  return parsed;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the real runtime spec`);
  return value;
}
