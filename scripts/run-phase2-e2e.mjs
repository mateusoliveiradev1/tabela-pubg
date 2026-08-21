import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
const webOrigin = `http://127.0.0.1:${WEB_PORT}`;
const apiOrigin = `http://127.0.0.1:${API_PORT}`;
const organization = {
  id: "00000000-0000-4000-8000-000000000111",
  slug: "arena-alpha",
  name: "Arena Alpha",
  membershipRole: "owner",
};

if (process.argv.includes("--serve-api")) {
  await serveApi();
} else {
  await runLifecycle();
}

async function runLifecycle() {
  requireInfrastructure();
  const runId = process.env.E2E_RUN_ID ?? `run-${randomBytes(12).toString("hex")}`;
  if (!/^run-[a-z0-9][a-z0-9-]{14,62}$/.test(runId)) throw new Error("E2E_RUN_ID is invalid");
  const objectRoot = await mkdtemp(path.join(tmpdir(), "pubg-camp-phase2-e2e-"));
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    E2E_PROVIDER_MODE: "fake",
    E2E_RUN_ID: runId,
    E2E_OBJECT_ROOT: objectRoot,
    E2E_WEB_ORIGIN: webOrigin,
    E2E_API_ORIGIN: apiOrigin,
    API_INTERNAL_ORIGIN: apiOrigin,
    NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS: apiOrigin,
  };
  const children = [];
  let seeded = false;
  try {
    await runPnpm(["phase2:integration:preflight"], environment);
    await runNode(["scripts/seed-phase2-e2e.mjs"], environment);
    seeded = true;
    children.push(spawnNode(["scripts/run-phase2-e2e.mjs", "--serve-api"], environment));
    await waitFor(`${apiOrigin}/health/live`);
    children.push(
      spawnPnpm(
        [
          "--filter",
          "@pubg-camp/web",
          "exec",
          "next",
          "dev",
          "--port",
          String(WEB_PORT),
          "--hostname",
          "127.0.0.1",
        ],
        { ...environment, NODE_ENV: "development" },
      ),
    );
    await waitFor(`${webOrigin}/entrar`);
    const browserArguments = ["--filter", "@pubg-camp/web", "exec", "playwright", "test"];
    if (process.argv.includes("--smoke")) {
      browserArguments.push("e2e/phase2-smoke.spec.ts", "--project=desktop-1440");
    }
    await runPnpm(browserArguments, environment);
  } finally {
    await Promise.all(children.reverse().map(stopChild));
    if (seeded) {
      await runNode(["scripts/seed-phase2-e2e.mjs", "--cleanup"], environment).catch(
        () => undefined,
      );
    }
    await rm(objectRoot, { recursive: true, force: true });
  }
}

async function serveApi() {
  const runId = assertFakeEnvironment();
  const objectRoot = process.env.E2E_OBJECT_ROOT;
  if (!objectRoot || !path.isAbsolute(objectRoot)) throw new Error("E2E_OBJECT_ROOT is required");
  const logoPath = path.join(objectRoot, runId, "logo.png");
  await mkdir(path.dirname(logoPath), { recursive: true });
  let logoAvailable = false;
  let remoteSessionActive = true;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", apiOrigin);
      if (url.pathname === "/health/live") return json(response, 200, { state: "ok" });
      if (url.pathname === "/security/csrf" && request.method === "GET") {
        return json(response, 200, { csrfToken: `csrf-${runId}-0123456789abcdef` });
      }
      if (url.pathname === "/identity/email/otp/request" && request.method === "POST") {
        response.setHeader("x-otp-challenge-id", "00000000-0000-4000-8000-000000000222");
        return json(response, 200, { status: "accepted", retryAfterSeconds: 1 });
      }
      if (url.pathname === "/identity/email/otp/verify" && request.method === "POST") {
        const body = await jsonBody(request);
        if (body.code !== "12345678") return json(response, 400, { status: "cancelled" });
        remoteSessionActive = true;
        response.setHeader(
          "set-cookie",
          "e2e-session=authenticated; Path=/; HttpOnly; SameSite=Lax",
        );
        return json(response, 200, { status: "authenticated", nextPath: "/" });
      }
      if (!hasSession(request)) return json(response, 401, { status: "unauthorized" });
      if (url.pathname === "/platform/organizations" && request.method === "GET") {
        return json(response, 200, {
          organizations: [
            {
              ...organization,
              logoUrl: logoAvailable ? `${webOrigin}${logoUrl(runId)}` : null,
            },
          ],
        });
      }
      if (
        url.pathname === `/platform/organizations/${organization.id}/logo` &&
        request.method === "PUT"
      ) {
        const multipart = await rawBody(request);
        const signature = multipart.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const end = multipart.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44]), signature);
        if (signature < 0 || end < 0) return json(response, 415, { status: "invalid" });
        const pngEnd = end + 8;
        const bytes = multipart.subarray(signature, pngEnd);
        await writeFile(logoPath, bytes);
        logoAvailable = true;
        return json(response, 200, {
          id: "00000000-0000-4000-8000-000000000333",
          detectedMime: "image/png",
          byteSize: bytes.length,
          url: logoUrl(runId),
        });
      }
      if (url.pathname === `/__e2e/logos/${runId}/logo.png` && request.method === "GET") {
        const bytes = await readFile(logoPath);
        response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        return response.end(bytes);
      }
      if (url.pathname === "/platform/invitations/preview" && request.method === "POST") {
        const body = await jsonBody(request);
        const context = typeof body.context === "string" ? body.context : "";
        if (context.startsWith("expired-")) return json(response, 200, { status: "expired" });
        if (context.startsWith("revoked-")) return json(response, 200, { status: "revoked" });
        if (context.startsWith("used-"))
          return json(response, 200, { status: "used", organizationSlug: organization.slug });
        if (context.startsWith("invalid-")) return json(response, 200, { status: "invalid" });
        return json(response, 200, {
          status: "valid",
          organization: {
            id: organization.id,
            name: organization.name,
            logoUrl: logoAvailable ? logoUrl(runId) : null,
          },
          invitedBy: "Organizador Alpha",
          maskedEmail: "o•••@example.com",
          organizationRole: "member",
          assignments: [],
          expiresAt: "2026-08-28T12:00:00.000Z",
          emailMatches: !context.startsWith("wrong-user-"),
        });
      }
      if (url.pathname === "/identity/sessions" && request.method === "GET") {
        const sessions = [
          session("00000000-0000-4000-8000-000000000444", "Este Chrome", true, true),
        ];
        if (remoteSessionActive)
          sessions.push(
            session("00000000-0000-4000-8000-000000000555", "Chrome do estúdio", false, true),
          );
        return json(response, 200, { sessions });
      }
      if (
        url.pathname === "/identity/sessions/00000000-0000-4000-8000-000000000555/revoke" &&
        request.method === "POST"
      ) {
        remoteSessionActive = false;
        return json(response, 200, {
          status: "revoked",
          revokedSessionId: "00000000-0000-4000-8000-000000000555",
        });
      }
      if (
        url.pathname === `/platform/organizations/${organization.id}/members` &&
        request.method === "GET"
      ) {
        return json(response, 200, { members: [member()] });
      }
      if (
        url.pathname === `/platform/organizations/${organization.id}/invitations` &&
        request.method === "GET"
      ) {
        return json(response, 200, { invitations: [] });
      }
      if (
        url.pathname === `/platform/organizations/${organization.id}/audit` &&
        request.method === "GET"
      ) {
        return json(response, 200, {
          visibility: "all",
          events: [],
          page: 1,
          pageSize: 25,
          total: 0,
          totalPages: 1,
        });
      }
      return json(response, 404, { status: "not-found" });
    } catch {
      return json(response, 500, { status: "unavailable" });
    }
  });
  server.listen(API_PORT, "127.0.0.1");
  process.once("SIGTERM", () => server.close());
  process.once("SIGINT", () => server.close());
  await new Promise((resolve) => server.once("close", resolve));
}

function logoUrl(runId) {
  return `/api/platform/__e2e/logos/${runId}/logo.png`;
}
function hasSession(request) {
  return /(?:^|;\s*)e2e-session=authenticated(?:;|$)/.test(request.headers.cookie ?? "");
}
function session(id, label, isCurrent, active) {
  return {
    id,
    device: { label, browser: "Chrome", operatingSystem: "Windows 11" },
    approximateLocation: "São Paulo, SP",
    createdAt: "2026-08-20T12:00:00.000Z",
    lastSeenAt: "2026-08-21T12:00:00.000Z",
    idleExpiresAt: "2026-08-28T12:00:00.000Z",
    absoluteExpiresAt: "2026-09-20T12:00:00.000Z",
    isCurrent,
    status: active ? "active" : "revoked",
  };
}
function member() {
  return {
    id: "00000000-0000-4000-8000-000000000666",
    user: {
      id: "00000000-0000-4000-8000-000000000777",
      displayName: "Organizador Alpha",
      maskedEmail: "o•••@example.com",
    },
    organizationRole: "owner",
    status: "active",
    assignments: [],
    joinedAt: "2026-08-20T12:00:00.000Z",
  };
}
function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
async function rawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function jsonBody(request) {
  const body = await rawBody(request);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

function assertFakeEnvironment() {
  if (
    process.env.E2E_PROVIDER_MODE !== "fake" ||
    process.env.NODE_ENV !== "test" ||
    !/^run-[a-z0-9][a-z0-9-]{14,62}$/.test(process.env.E2E_RUN_ID ?? "")
  )
    throw new Error("E2E fake API requires the complete test-only provider conjunction");
  return process.env.E2E_RUN_ID;
}
function requireInfrastructure() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
    throw new Error("DATABASE_URL and REDIS_URL are required; E2E never skips infrastructure");
}
function spawnNode(args, env) {
  return spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env,
    stdio: "inherit",
    shell: false,
  });
}
function spawnPnpm(args, env) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: pnpm lifecycle path is supplied by the package manager on Windows.
  const entry = process.env.npm_execpath;
  if (process.platform === "win32" && !entry)
    throw new Error("npm_execpath is required on Windows");
  return spawn(
    process.platform === "win32" ? process.execPath : "pnpm",
    process.platform === "win32" ? [entry, ...args] : args,
    { cwd: repositoryRoot, env, stdio: "inherit", shell: false },
  );
}
function runNode(args, env) {
  return waitChild(spawnNode(args, env), args.join(" "));
}
function runPnpm(args, env) {
  return waitChild(spawnPnpm(args, env), `pnpm ${args.join(" ")}`);
}
function waitChild(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} exited with ${code ?? "unknown"}`)),
    );
  });
}
async function stopChild(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    await waitChild(
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }),
      "taskkill E2E process tree",
    ).catch(() => undefined);
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
async function waitFor(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`readiness timed out for ${new URL(url).origin}`);
}
