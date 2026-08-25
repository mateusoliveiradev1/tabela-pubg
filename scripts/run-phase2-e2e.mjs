import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanupPhase2E2ESeed, createPhase2E2ESeed } from "./seed-phase2-e2e.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queueRequire = createRequire(path.join(repositoryRoot, "packages/queue/package.json"));
const redisModule = queueRequire("ioredis");
const Redis = redisModule.Redis ?? redisModule.default ?? redisModule;
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{14,62}$/;
const GENERATED_RUN_ID = /^run-[0-9a-f]{24}$/;
const BROAD_RUN_ID = /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/;
const OWNED_ROOT_PREFIX = "pubg-camp-phase2-e2e-";
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
const WORKER_PORT = 3102;
const LOGO_PORT = 3103;
const webOrigin = `http://127.0.0.1:${WEB_PORT}`;
const apiOrigin = `http://127.0.0.1:${API_PORT}`;
const workerOrigin = `http://127.0.0.1:${WORKER_PORT}`;
const logoOrigin = `http://127.0.0.1:${LOGO_PORT}`;
const RUNTIME_CASES = Object.freeze([
  "provisional-to-trusted",
  "identity-reauthentication-management",
  "invitation-seven-day-one-use",
  "sensitive-membership-step-up",
  "audit-visibility",
  "cross-tenant-denial",
  "second-origin-logo",
]);
const SELF_TEST_CASES = Object.freeze([
  "reject-absent-run-id",
  "reject-empty-run-id",
  "reject-broad-run-id",
  "reject-malformed-run-id",
  "reject-under-19-run-id",
  "reject-over-67-run-id",
  "accept-generated-run-id",
  "scope-ids-are-byte-equal",
  "child-readiness-order",
  "failure-unwinds-in-reverse",
  "cleanup-target-is-owned",
]);

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  if (process.argv.includes("--self-test")) await runSelfTest();
  else await runLifecycle();
}

export function validateRunScopeId(candidate) {
  if (typeof candidate !== "string" || !RUN_ID.test(candidate) || BROAD_RUN_ID.test(candidate)) {
    throw new Error("E2E_RUN_ID must be a non-broad 19-67 character run scope");
  }
  return candidate;
}

export function resolveRunScopeId(environment = process.env) {
  if (Object.hasOwn(environment, "E2E_RUN_ID")) {
    return { runScopeId: validateRunScopeId(environment.E2E_RUN_ID), source: "environment" };
  }
  const runScopeId = `run-${randomBytes(12).toString("hex")}`;
  if (!GENERATED_RUN_ID.test(runScopeId) || runScopeId.length !== 28) {
    throw new Error("generated E2E_RUN_ID violated its canonical form");
  }
  return { runScopeId, source: "generated" };
}

export function deriveRunScopes(runScopeId) {
  const validated = validateRunScopeId(runScopeId);
  return Object.freeze({
    runScopeId: validated,
    schemaScopeId: validated,
    redisScopeId: validated,
    bullmqScopeId: validated,
    objectScopeId: validated,
    mailScopeId: validated,
  });
}

async function runSelfTest() {
  const executed = [];
  const expectReject = (name, value) => {
    let rejected = false;
    try {
      validateRunScopeId(value);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`self-test ${name} accepted an invalid run id`);
    executed.push(name);
  };
  expectReject("reject-absent-run-id", undefined);
  expectReject("reject-empty-run-id", "");
  expectReject("reject-broad-run-id", "run-shared-012345678901");
  expectReject("reject-malformed-run-id", "run-valid/../../escape");
  expectReject("reject-under-19-run-id", "run-01234567890123");
  expectReject("reject-over-67-run-id", `run-${"a".repeat(64)}`);

  const generated = resolveRunScopeId({});
  if (!GENERATED_RUN_ID.test(generated.runScopeId) || generated.source !== "generated") {
    throw new Error("self-test generated run id mismatch");
  }
  executed.push("accept-generated-run-id");

  const scopes = deriveRunScopes("run-abcdef0123456789abcdef01");
  if (Object.values(scopes).some((value) => value !== scopes.runScopeId)) {
    throw new Error("self-test cleanup scopes diverged");
  }
  executed.push("scope-ids-are-byte-equal");

  const lifecycle = ["worker", "api", "logo", "web", "browser"];
  if (lifecycle.join(">") !== "worker>api>logo>web>browser") {
    throw new Error("self-test readiness order mismatch");
  }
  executed.push("child-readiness-order");
  if ([...lifecycle.slice(0, -1)].reverse().join(">") !== "web>logo>api>worker") {
    throw new Error("self-test reverse unwind mismatch");
  }
  executed.push("failure-unwinds-in-reverse");

  const ownedRoot = path.join(tmpdir(), `${OWNED_ROOT_PREFIX}self-test`);
  const ownedTarget = resolveOwnedRunRoot(ownedRoot, scopes.runScopeId);
  if (!ownedTarget.startsWith(`${ownedRoot}${path.sep}`)) {
    throw new Error("self-test cleanup escaped its owned root");
  }
  executed.push("cleanup-target-is-owned");

  if (
    executed.length !== SELF_TEST_CASES.length ||
    SELF_TEST_CASES.some((name) => !executed.includes(name))
  ) {
    throw new Error("lifecycle self-test case inventory is incomplete");
  }
  process.stdout.write(`phase 2 E2E lifecycle self-test passed: ${executed.length} named cases\n`);
}

async function runLifecycle() {
  requireInfrastructure();
  const resolvedRun = resolveRunScopeId(process.env);
  const scopes = deriveRunScopes(resolvedRun.runScopeId);
  process.stdout.write(`phase 2 E2E run scope: ${scopes.runScopeId} (${resolvedRun.source})\n`);

  const objectRoot = await mkdtemp(path.join(tmpdir(), OWNED_ROOT_PREFIX));
  const baseEnvironment = runtimeEnvironment(process.env, scopes.runScopeId, objectRoot);
  const children = [];
  let cleanupEnvironment;
  let foreignRedis;
  const foreignKey = "pubg-camp:run-foreign-abcdef0123456789:sentinel";
  try {
    await runPnpm(["phase2:integration:preflight"], baseEnvironment);
    const seeded = await createPhase2E2ESeed(baseEnvironment);
    cleanupEnvironment = baseEnvironment;
    const environment = {
      ...seeded.environment,
      E2E_BROWSER_AUTH_MODE: process.argv.includes("--runtime") ? "runtime" : "shared",
      PHASE2_RUNTIME_EVIDENCE: JSON.stringify({
        cases: RUNTIME_CASES,
        runScopeId: scopes.runScopeId,
        webOrigin,
        apiOrigin,
        workerOrigin,
        logoOrigin,
      }),
    };

    foreignRedis = new Redis(environment.REDIS_URL, redisOptions());
    await foreignRedis.connect();
    await foreignRedis.set(foreignKey, "preserve", "EX", 3_600);

    children.push(
      spawnPnpm(["--filter", "@pubg-camp/worker", "exec", "tsx", "src/main.ts"], {
        ...environment,
        PORT: String(WORKER_PORT),
      }),
    );
    await waitFor(`${workerOrigin}/health/ready`);

    children.push(
      spawnPnpm(["--filter", "@pubg-camp/api", "exec", "tsx", "src/main.ts"], environment),
    );
    await waitFor(`${apiOrigin}/security/csrf`, { origin: webOrigin });

    const logoServer = await startLogoServer(objectRoot, scopes.runScopeId);
    children.push(logoServer);
    await waitFor(`${logoOrigin}/health/ready`);

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

    await runPnpm(browserArguments(), environment);
  } finally {
    for (const child of children.reverse()) await stopChild(child);
    if (cleanupEnvironment) {
      await cleanupPhase2E2ESeed(cleanupEnvironment);
      await assertForeignSentinel(foreignRedis, foreignKey);
      await assertNoCurrentRunKeys(foreignRedis, scopes.redisScopeId);
    }
    if (foreignRedis) {
      await foreignRedis.del(foreignKey);
      foreignRedis.disconnect();
    }
    await removeOwnedRoot(objectRoot);
  }
}

function runtimeEnvironment(source, runScopeId, objectRoot) {
  return {
    ...source,
    NODE_ENV: "test",
    E2E_PROVIDER_MODE: "fake",
    E2E_RUN_ID: runScopeId,
    E2E_OBJECT_ROOT: objectRoot,
    E2E_WEB_ORIGIN: webOrigin,
    E2E_API_ORIGIN: apiOrigin,
    E2E_WORKER_ORIGIN: workerOrigin,
    E2E_LOGO_ORIGIN: logoOrigin,
    API_INTERNAL_ORIGIN: apiOrigin,
    NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS: logoOrigin,
    APP_ORIGIN: webOrigin,
    PORT: String(API_PORT),
    DISCORD_CLIENT_ID: "123456789012345678",
    DISCORD_CLIENT_SECRET: "dsc_6qT2kJ8mW4xP9vN3rF7yH5uC1aB0eZsM",
    DISCORD_REDIRECT_URI: `${webOrigin}/entrar/discord/retorno`,
    DISCORD_PKCE_MODE: "required",
    SESSION_COOKIE_NAME: "__Host-session",
    SESSION_COOKIE_SECRET: "ses_9mA3vK7xQ2nT6cR8pL4yH1uF5wD0eJsC",
    SESSION_COOKIE_SECURE: "true",
    CSRF_SECRET: "csr_2vN8kP4mY6tR1xQ9aL5wH3uF7cD0eJsD",
    OTP_PEPPER: "otp_7xR3mK9vQ2nT6pL8aF4wH1uC5yD0eJsE",
    OTP_COOLDOWN_SECONDS: "10",
    AES_GCM_KEY_V1: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ENCRYPTION_KEY_VERSION: "v1",
    RESEND_API_KEY: "re_4nQ8vK2mT6xP9aL3yH7uF1cR5wD0eJsC",
    EMAIL_FROM: "runtime@example.test",
    TRUSTED_PROXY: "loopback",
    S3_ENDPOINT: "http://127.0.0.1:3999",
    S3_REGION: "e2e-local",
    S3_BUCKET: "phase2-runtime",
    S3_ACCESS_KEY: "e2e-access-key",
    S3_SECRET_KEY: "e2e-storage-secret-isolated-000001",
    RUN_MIGRATIONS: "false",
    LOG_LEVEL: "warn",
  };
}

function browserArguments() {
  const args = ["--filter", "@pubg-camp/web", "exec", "playwright", "test"];
  if (process.argv.includes("--runtime")) {
    args.push("e2e/phase2-runtime.spec.ts", "--project=phase2-runtime");
  } else if (process.argv.includes("--smoke")) {
    args.push("e2e/phase2-smoke.spec.ts", "--project=desktop-1440");
  }
  return args;
}

async function startLogoServer(root, runScopeId) {
  const exactRunRoot = resolveOwnedRunRoot(root, runScopeId);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", logoOrigin);
      if (url.pathname === "/health/ready") return send(response, 200, "text/plain", "ready");
      const match = /^\/objects\/([^/]+)\/([A-Za-z0-9_-]{16,512})$/.exec(url.pathname);
      if (!match || match[1] !== runScopeId) return send(response, 404, "text/plain", "not found");
      const objectKey = Buffer.from(match[2], "base64url").toString("utf8");
      if (!/^branding\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(objectKey)) {
        return send(response, 404, "text/plain", "not found");
      }
      const target = path.resolve(exactRunRoot, ...objectKey.split("/"));
      if (!target.startsWith(`${exactRunRoot}${path.sep}`)) {
        return send(response, 404, "text/plain", "not found");
      }
      const [bytes, contentType] = await Promise.all([
        readFile(target),
        readFile(`${target}.mime`, "utf8"),
      ]);
      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(bytes);
    } catch {
      send(response, 404, "text/plain", "not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(LOGO_PORT, "127.0.0.1", resolve);
  });
  return server;
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function resolveOwnedRunRoot(root, runScopeId) {
  validateRunScopeId(runScopeId);
  if (!path.isAbsolute(root) || !path.basename(root).startsWith(OWNED_ROOT_PREFIX)) {
    throw new Error("E2E root is not owned by this lifecycle");
  }
  const target = path.resolve(root, runScopeId);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("E2E run root escaped ownership");
  return target;
}

async function removeOwnedRoot(root) {
  const [resolvedRoot, resolvedTemp] = await Promise.all([realpath(root), realpath(tmpdir())]);
  const relative = path.relative(resolvedTemp, resolvedRoot);
  if (
    !(await stat(resolvedRoot)).isDirectory() ||
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(resolvedRoot).startsWith(OWNED_ROOT_PREFIX)
  ) {
    throw new Error("refusing broad E2E root cleanup");
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

async function assertNoCurrentRunKeys(redis, runScopeId) {
  let cursor = "0";
  let count = 0;
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `pubg-camp:${validateRunScopeId(runScopeId)}:*`,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    count += keys.length;
  } while (cursor !== "0");
  if (count !== 0) throw new Error("current-run Redis or BullMQ keys survived cleanup");
}

async function assertForeignSentinel(redis, foreignKey) {
  if ((await redis?.get(foreignKey)) !== "preserve") {
    throw new Error("E2E cleanup removed the foreign-run Redis sentinel");
  }
}

function requireInfrastructure() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
    throw new Error("DATABASE_URL and REDIS_URL are required; E2E never skips infrastructure");
  }
}

function spawnPnpm(args, env) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: pnpm lifecycle path is supplied by the package manager on Windows.
  const entry = process.env.npm_execpath;
  if (process.platform === "win32" && !entry) {
    return spawn("cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
      cwd: repositoryRoot,
      env,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
  }
  return spawn(
    process.platform === "win32" ? process.execPath : "pnpm",
    process.platform === "win32" ? [entry, ...args] : args,
    { cwd: repositoryRoot, env, stdio: "inherit", shell: false },
  );
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
  if (typeof child.close === "function" && child.pid === undefined) {
    await new Promise((resolve) => child.close(resolve));
    return;
  }
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

async function waitFor(url, headers = {}) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`readiness timed out for ${new URL(url).origin}`);
}

function redisOptions() {
  return { lazyConnect: true, maxRetriesPerRequest: null, enableReadyCheck: true };
}
