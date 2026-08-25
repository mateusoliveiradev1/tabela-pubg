import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const selfTest = process.argv.includes("--self-test");
const workflowArgument = process.argv.slice(2).find((argument) => argument !== "--self-test");
const workflowPath = path.resolve(workflowArgument ?? ".github/workflows/ci.yml");

const sourcePaths = {
  workflow: workflowPath,
  rootPackage: path.join(repositoryRoot, "package.json"),
  webPackage: path.join(repositoryRoot, "apps/web/package.json"),
  runner: path.join(repositoryRoot, "scripts/run-phase2-e2e.mjs"),
  providerSpec: path.join(repositoryRoot, "apps/api/src/e2e/provider-mode.spec.ts"),
  runtimeSpec: path.join(repositoryRoot, "apps/web/e2e/phase2-runtime.spec.ts"),
  playwrightConfig: path.join(repositoryRoot, "apps/web/playwright.config.ts"),
  authSetup: path.join(repositoryRoot, "apps/web/e2e/global-setup.ts"),
  authState: path.join(repositoryRoot, "apps/web/e2e/auth-state.ts"),
  browserFixtures: path.join(repositoryRoot, "apps/web/e2e/fixtures.ts"),
  secondarySession: path.join(repositoryRoot, "apps/web/e2e/secondary-session.ts"),
  accessibilitySpec: path.join(repositoryRoot, "apps/web/e2e/phase2-accessibility.spec.ts"),
  workerMain: path.join(repositoryRoot, "apps/worker/src/main.ts"),
  integrationConfig: path.join(repositoryRoot, "vitest.integration.config.ts"),
  lastOwnerSpec: path.join(repositoryRoot, "packages/database/test/last-owner.concurrent.spec.ts"),
  invitationSpec: path.join(repositoryRoot, "packages/database/test/invitation.concurrent.spec.ts"),
};

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(sourcePaths).map(async ([name, sourcePath]) => [
      name,
      await readFile(sourcePath, "utf8"),
    ]),
  ),
);

const LIFECYCLE_CASES = [
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
];
const PROVIDER_CASES = [
  "passes the validated run id to the 02-41 scope contract without rebuilding prefixes",
  "keeps default production namespaces stable and exposes no fake provider",
  "rejects absent, broad and mismatched fake scope before any Redis write",
  "provides a deterministic test-only Discord transport only after the complete conjunction",
];
const RUNTIME_CASES = [
  "provisional-to-trusted",
  "identity-reauthentication-management",
  "invitation-seven-day-one-use",
  "sensitive-membership-step-up",
  "audit-visibility",
  "cross-tenant-denial",
  "second-origin-logo",
];
const EXPANDED_JOBS = [
  ["quality", "Quality and affected build"],
  ["phase2-integration[suite=integration]", "Phase 2 integration"],
  ["phase2-integration[suite=concurrent]", "Phase 2 concurrent"],
  ["phase2-e2e", "Phase 2 browser E2E"],
  ["images[app=web]", "Image web"],
  ["images[app=api]", "Image api"],
  ["images[app=worker]", "Image worker"],
  ["images[app=discord-bot]", "Image discord-bot"],
];
const SUITE_EXPRESSION = "$" + "{{ matrix.suite }}";
const APP_EXPRESSION = "$" + "{{ matrix.app }}";

validate(sources);
if (selfTest) runSelfTest(sources);
else console.log(`phase 2 CI structure passed: ${path.relative(process.cwd(), workflowPath)}`);

function validate(input) {
  const workflow = input.workflow;
  const quality = jobSection(workflow, "quality");
  const integration = jobSection(workflow, "phase2-integration");
  const e2e = jobSection(workflow, "phase2-e2e");
  const images = jobSection(workflow, "images");

  requireMatch(
    workflow,
    /^\s*branches:\s*\[main,\s*"phase\/02-identidade-organizacoes-e-autorizacao"\]\s*$/m,
    "exact main and phase 2 push branches",
  );
  requireMatch(workflow, /^\s*pull_request:\s*$/m, "pull_request trigger");
  rejectMatch(
    [quality, integration, e2e, images].join("\n"),
    /continue-on-error\s*:|--passWithNoTests|\.(?:skip|fixme)\s*\(|\b(?:test|describe)\.skip\b/i,
    "skippable or vacuous mandatory evidence",
  );
  rejectMatch(
    [quality, integration, e2e, images].join("\n"),
    /^ {4}if:\s*|^\s+if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/im,
    "conditional mandatory job",
  );
  rejectMatch(workflow, /--serve-api/, "synthetic mandatory API");

  const expanded = expandedJobs(quality, integration, e2e, images);
  if (JSON.stringify(expanded) !== JSON.stringify(EXPANDED_JOBS)) {
    throw new Error(
      `mandatory expanded CI jobs must equal the canonical eight pairs: ${JSON.stringify(EXPANDED_JOBS)}`,
    );
  }

  requireAll(quality, [
    [/pnpm install --frozen-lockfile/, "frozen dependency install"],
    [/pnpm verify:secrets/, "secret scan"],
    [/pnpm verify:migrations/, "migration validation"],
    [/pnpm turbo run lint typecheck test build --affected/, "affected package builds and tests"],
  ]);
  requireAll(integration, [
    [/^ {6}postgres:\s*$/m, "PostgreSQL integration service"],
    [/^ {6}redis:\s*$/m, "Redis integration service"],
    [/--health-cmd[^\n]*pg_isready/i, "PostgreSQL healthcheck"],
    [/--health-cmd[^\n]*redis-cli[^\n]*ping/i, "Redis healthcheck"],
    [/pnpm phase2:integration:preflight/, "integration Redis/PostgreSQL preflight"],
    [/pnpm phase2:integration(?=\s|$)/m, "integration suite"],
    [/pnpm phase2:concurrent\b/m, "concurrent suite"],
    [/set -o pipefail/, "pipeline failure propagation"],
    [/\[REDACTED\]/, "credential redaction"],
    [/if:\s*always\(\)/, "always-run redacted log collection"],
  ]);
  requireAll(e2e, [
    [/needs:\s*\[quality, phase2-integration\]/, "blocking quality and integration dependencies"],
    [/^ {6}postgres:\s*$/m, "PostgreSQL browser service"],
    [/^ {6}redis:\s*$/m, "Redis browser service"],
    [/pnpm install --frozen-lockfile/, "frozen browser dependency install"],
    [/pnpm turbo run build --filter=@pubg-camp\/web\^\.\.\./, "fresh-checkout browser build"],
    [
      /^\s*run:\s*pnpm turbo run build --filter=@pubg-camp\/api\^\.\.\. --filter=@pubg-camp\/worker\^\.\.\.\s*$/m,
      "fresh-checkout API and worker dependency-only build",
    ],
    [/pnpm phase2:integration:preflight/, "browser Redis/PostgreSQL preflight"],
    [/pnpm --filter @pubg-camp\/authorization exec vitest run/, "authorization suite"],
    [/src\/authorization\.spec\.ts/, "authorization selector"],
    [/src\/authorization\/permission\.guard\.spec\.ts/, "Nest authorization suite"],
    [/src\/identity\/adapters\/discord-oauth\.pkce\.spec\.ts/, "Discord PKCE suite"],
    [/src\/app\/api\/platform\/\[\.\.\.path\]\/route\.spec\.ts/, "BFF secret-boundary suite"],
    [/playwright install --with-deps chromium/, "official Chromium install"],
    [/run:\s*pnpm test:e2e:runtime\s*$/m, "mandatory runtime command"],
    [/test:e2e:smoke\s*$/m, "browser smoke"],
    [/run:\s*pnpm --filter @pubg-camp\/web test:e2e\s*$/m, "complete browser suite"],
    [/if:\s*failure\(\)/, "failure-only browser artifacts"],
  ]);
  rejectMatch(
    e2e,
    /(?:E2E_MAIL_ROOT|E2E_OBJECT_ROOT|DATABASE_URL|REDIS_URL).*path:/i,
    "secret or mailbox artifact",
  );

  const order = [
    e2e.indexOf("pnpm turbo run build --filter=@pubg-camp/web^..."),
    e2e.indexOf("pnpm turbo run build --filter=@pubg-camp/api^... --filter=@pubg-camp/worker^..."),
    e2e.indexOf("pnpm phase2:integration:preflight"),
    e2e.indexOf("pnpm --filter @pubg-camp/authorization exec vitest run"),
    e2e.indexOf("playwright install --with-deps chromium"),
    e2e.indexOf("pnpm test:e2e:runtime"),
    e2e.indexOf("test:e2e:smoke"),
    matchIndex(e2e, /^\s*run:\s*pnpm --filter @pubg-camp\/web test:e2e\s*$/m),
  ];
  if (
    order.some((index) => index < 0) ||
    order.some((index, offset) => offset > 0 && index <= order[offset - 1])
  ) {
    throw new Error(
      "phase 2 CI order must be browser dependencies, API/worker dependency closure, preflight, security, Chromium, runtime, smoke, full browser",
    );
  }

  const rootPackage = JSON.parse(input.rootPackage);
  const webPackage = JSON.parse(input.webPackage);
  if (rootPackage.scripts?.["test:e2e:runtime"] !== "pnpm --filter @pubg-camp/web test:e2e:runtime")
    throw new Error("root package is missing the exact runtime command");
  if (
    webPackage.scripts?.["test:e2e:runtime"] !== "node ../../scripts/run-phase2-e2e.mjs --runtime"
  )
    throw new Error("web package is missing the exact runtime selector");

  requireNamedInventory(input.runner, LIFECYCLE_CASES, "lifecycle", 2);
  requireNamedInventory(input.providerSpec, PROVIDER_CASES, "provider", 1);
  requireNamedInventory(input.runtimeSpec, RUNTIME_CASES, "runtime browser", 2);
  rejectMatch(
    `${input.runner}\n${input.providerSpec}\n${input.runtimeSpec}`,
    /--passWithNoTests|\.(?:skip|fixme)\s*\(|\b(?:test|describe)\.skip\b/i,
    "skipped owned selector",
  );
  requireAll(input.runner, [
    [/"@pubg-camp\/api"/, "real API process"],
    [/"@pubg-camp\/worker"/, "real worker process"],
    [/waitFor\(`\$\{workerOrigin\}\/health\/ready`\)/, "worker readiness"],
    [/waitFor\(`\$\{apiOrigin\}\/security\/csrf`/, "API readiness"],
    [/finally\s*\{/, "failure cleanup boundary"],
    [/cleanupPhase2E2ESeed\(cleanupEnvironment\)/, "scoped database and Redis cleanup"],
    [/assertNoCurrentRunKeys/, "current-run key cleanup assertion"],
    [/assertForeignSentinel/, "foreign-run preservation assertion"],
    [/removeOwnedRoot\(objectRoot\)/, "owned root cleanup"],
    [/E2E_BROWSER_AUTH_MODE:/, "explicit browser authentication mode"],
  ]);
  rejectMatch(input.runner, /--serve-api/, "synthetic runner path");
  requireAll(input.playwrightConfig, [
    [/globalSetup:\s*"\.\/e2e\/global-setup\.ts"/, "single browser authentication setup"],
    [/storageState:\s*authStatePath/, "reused browser authentication state"],
  ]);
  requireAll(input.authSetup, [
    [/phase2AuthStatePath\(process\.env\)/, "run-owned authentication state path"],
    [/context\.storageState\(\{ path: statePath \}\)/, "persisted reusable authentication state"],
    [/requiredRunMailRoot\(statePath, process\.env\.E2E_MAIL_ROOT\)/, "run-owned OTP mailbox"],
    [/const code = await waitForOtp\(/, "real OTP mailbox lookup"],
    [/phase2FixtureStatePath\(process\.env\)/, "run-owned browser fixture state"],
    [/createOrganization\(page, csrf\)/, "real smoke organization fixture"],
    [
      /createInvitation\(page, csrf, organization\.organizationId, invitee\)/,
      "real smoke invitation fixture",
    ],
    [/writeFile\(fixturePath,/, "persisted browser fixture metadata"],
  ]);
  rejectMatch(input.authSetup, /12345678/, "hardcoded browser OTP");
  rejectMatch(
    input.browserFixtures,
    /Receber código|Código de 8 dígitos|organizer@example\.com/,
    "per-test OTP authentication",
  );
  requireAll(input.authState, [
    [/export function phase2FixtureStatePath\(/, "owned fixture state path"],
    [/export function parsePhase2FixtureState\(/, "validated fixture state parser"],
  ]);
  requireAll(input.browserFixtures, [
    [/readFile\(phase2FixtureStatePath\(process\.env\)/, "real fixture state lookup"],
    [/parsePhase2FixtureState\(/, "validated real fixture metadata"],
    [/replacePhase2SecondarySession\(/, "per-test secondary session fixture"],
  ]);
  requireAll(input.secondarySession, [
    [/phase2SecondarySessionScope\(/, "run and test scoped session identity"],
    [/update sessions set revoked_at = now\(\)/, "prior owned session retirement"],
    [/insert into sessions/, "fresh per-test secondary session"],
  ]);
  requireAll(input.runtimeSpec, [
    [/select correlation_id from outbox_events/, "real PostgreSQL correlation assertion"],
    [
      /expect\(otpOutbox\.correlation_id\)\.toBe\(otpRequest\.correlationId\)/,
      "outbox correlation propagation",
    ],
  ]);
  requireAll(input.workerMain, [
    [/new OutboxPublisher\(/, "real outbox publisher"],
    [/publisher\.start\(\)/, "started outbox publisher"],
  ]);
  requireAll(input.integrationConfig, [
    [/packages\/database\/test\/\*\*\/\*\.concurrent\.spec\.ts/, "concurrency selector"],
    [/packages\/database\/test\/\*\*\/\*\.integration\.spec\.ts/, "integration selector"],
  ]);
  requireMatch(
    input.lastOwnerSpec,
    /describe\.runIf\(Boolean\(databaseUrl\)\)\("last owner concurrency"/,
    "last-owner concurrency suite",
  );
  requireMatch(
    input.invitationSpec,
    /describe\.runIf\(Boolean\(databaseUrl\)\)\("invitation concurrency"/,
    "invitation concurrency suite",
  );
  requireMatch(input.accessibilitySpec, /^\s*test\(/m, "accessibility browser suite");
}

function expandedJobs(quality, integration, e2e, images) {
  const integrationSuites = parseInlineValues(integration, /^ {8}suite:\s*\[([^\]]+)\]\s*$/m);
  const imageApps = [...images.matchAll(/^ {10}- app:\s*([^\s]+)\s*$/gm)].map((match) => match[1]);
  const pairs = [["quality", jobName(quality)]];
  for (const suite of integrationSuites)
    pairs.push([
      `phase2-integration[suite=${suite}]`,
      jobName(integration).replace(SUITE_EXPRESSION, suite),
    ]);
  pairs.push(["phase2-e2e", jobName(e2e)]);
  for (const app of imageApps)
    pairs.push([`images[app=${app}]`, jobName(images).replace(APP_EXPRESSION, app)]);
  return pairs;
}

function jobSection(workflow, key) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`  ${key}:`);
  if (start < 0) throw new Error(`CI must define the ${key} job`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function jobName(job) {
  const match = /^ {4}name:\s*(.+)\s*$/m.exec(job);
  if (!match) throw new Error("mandatory job is missing its tracked name");
  return match[1].trim();
}

function parseInlineValues(source, pattern) {
  const match = pattern.exec(source);
  return match ? match[1].split(",").map((value) => value.trim()) : [];
}

function matchIndex(source, pattern) {
  return pattern.exec(source)?.index ?? -1;
}

function requireAll(source, requirements) {
  for (const [pattern, description] of requirements) requireMatch(source, pattern, description);
}

function requireMatch(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`phase 2 CI is missing ${description}`);
}

function rejectMatch(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`phase 2 CI contains forbidden ${description}`);
}

function requireNamedInventory(source, names, label, expectedOccurrences) {
  if (names.length === 0) throw new Error(`${label} case inventory must be nonzero`);
  for (const name of names) {
    const occurrences = source.split(`"${name}"`).length - 1;
    if (occurrences !== expectedOccurrences)
      throw new Error(
        `${label} case inventory must contain ${name} exactly ${expectedOccurrences} times`,
      );
  }
}

function runSelfTest(baseline) {
  const cases = [
    [
      "missing-runtime-command",
      (value) =>
        mutate(value, "workflow", "run: pnpm test:e2e:runtime", "run: pnpm test:e2e:missing"),
    ],
    [
      "missing-lifecycle-case",
      (value) => mutate(value, "runner", `"${LIFECYCLE_CASES[0]}"`, '"removed-lifecycle-case"'),
    ],
    [
      "missing-provider-case",
      (value) => mutate(value, "providerSpec", `"${PROVIDER_CASES[0]}"`, '"removed provider case"'),
    ],
    [
      "missing-runtime-case",
      (value) => mutate(value, "runtimeSpec", `"${RUNTIME_CASES[0]}"`, '"removed-runtime-case"'),
    ],
    [
      "conditional-skip",
      (value) =>
        mutate(value, "runtimeSpec", 'test("audit-visibility"', 'test.skip("audit-visibility"'),
    ],
    [
      "pass-with-no-tests",
      (value) =>
        mutate(
          value,
          "workflow",
          "pnpm test:e2e:runtime",
          "pnpm test:e2e:runtime --passWithNoTests",
        ),
    ],
    [
      "missing-quality-pair",
      (value) => mutate(value, "workflow", "  quality:", "  quality-removed:"),
    ],
    [
      "missing-integration-pair",
      (value) =>
        mutate(value, "workflow", "suite: [integration, concurrent]", "suite: [concurrent]"),
    ],
    [
      "missing-concurrent-pair",
      (value) =>
        mutate(value, "workflow", "suite: [integration, concurrent]", "suite: [integration]"),
    ],
    [
      "missing-e2e-pair",
      (value) => mutate(value, "workflow", "  phase2-e2e:", "  phase2-e2e-removed:"),
    ],
    ["missing-image-web-pair", (value) => mutate(value, "workflow", "          - app: web\n", "")],
    ["missing-image-api-pair", (value) => mutate(value, "workflow", "          - app: api\n", "")],
    [
      "missing-image-worker-pair",
      (value) => mutate(value, "workflow", "          - app: worker\n", ""),
    ],
    [
      "missing-image-discord-pair",
      (value) => mutate(value, "workflow", "          - app: discord-bot\n", ""),
    ],
    [
      "renamed-quality",
      (value) => mutate(value, "workflow", "name: Quality and affected build", "name: Quality"),
    ],
    [
      "renamed-integration",
      (value) =>
        mutate(
          value,
          "workflow",
          `name: Phase 2 ${SUITE_EXPRESSION}`,
          `name: Integration ${SUITE_EXPRESSION}`,
        ),
    ],
    [
      "renamed-e2e",
      (value) => mutate(value, "workflow", "name: Phase 2 browser E2E", "name: Browser"),
    ],
    [
      "renamed-images",
      (value) =>
        mutate(
          value,
          "workflow",
          `name: Image ${APP_EXPRESSION}`,
          `name: Container ${APP_EXPRESSION}`,
        ),
    ],
    [
      "missing-redis-preflight",
      (value) =>
        mutate(
          value,
          "workflow",
          "run: pnpm phase2:integration:preflight",
          "run: pnpm phase2:integration:missing",
        ),
    ],
    [
      "missing-api-process",
      (value) => mutate(value, "runner", '"@pubg-camp/api"', '"@pubg-camp/api-removed"'),
    ],
    [
      "missing-worker-process",
      (value) => mutate(value, "runner", '"@pubg-camp/worker"', '"@pubg-camp/worker-removed"'),
    ],
    [
      "missing-publisher-process",
      (value) => mutate(value, "workerMain", "publisher.start();", "publisher.stop();"),
    ],
    [
      "missing-cleanup",
      (value) =>
        mutate(
          value,
          "runner",
          "cleanupPhase2E2ESeed(cleanupEnvironment)",
          "cleanupRemoved(cleanupEnvironment)",
        ),
    ],
    [
      "skippable-mandatory-job",
      (value) =>
        mutate(
          value,
          "workflow",
          "    runs-on: ubuntu-latest",
          "    if: false\n    runs-on: ubuntu-latest",
        ),
    ],
    [
      "runtime-after-browser",
      (value) =>
        swap(
          value,
          "workflow",
          "run: pnpm test:e2e:runtime",
          "run: pnpm --filter @pubg-camp/web test:e2e:smoke",
        ),
    ],
    [
      "missing-api-dependency-closure",
      (value) =>
        mutate(value, "workflow", "--filter=@pubg-camp/api^...", "--filter=@pubg-camp/config^..."),
    ],
    [
      "missing-worker-dependency-closure",
      (value) =>
        mutate(
          value,
          "workflow",
          "--filter=@pubg-camp/worker^...",
          "--filter=@pubg-camp/queue^...",
        ),
    ],
    [
      "runtime-dependency-build-after-runtime",
      (value) =>
        swap(
          value,
          "workflow",
          "pnpm turbo run build --filter=@pubg-camp/api^... --filter=@pubg-camp/worker^...",
          "pnpm test:e2e:runtime",
        ),
    ],
    [
      "missing-authorization-suite",
      (value) =>
        mutate(
          value,
          "workflow",
          "pnpm --filter @pubg-camp/authorization exec vitest run",
          "pnpm --filter @pubg-camp/contracts test",
        ),
    ],
    [
      "missing-pkce-suite",
      (value) =>
        mutate(
          value,
          "workflow",
          "src/identity/adapters/discord-oauth.pkce.spec.ts",
          "src/identity/adapters/discord-oauth.spec.ts",
        ),
    ],
    [
      "missing-secret-boundary-suite",
      (value) =>
        mutate(
          value,
          "workflow",
          '"src/app/api/platform/[...path]/route.spec.ts"',
          '"src/app/api/platform/route.spec.ts"',
        ),
    ],
    [
      "missing-last-owner-suite",
      (value) => mutate(value, "lastOwnerSpec", "last owner concurrency", "removed invariant"),
    ],
    [
      "missing-invitation-suite",
      (value) => mutate(value, "invitationSpec", "invitation concurrency", "removed suite"),
    ],
    [
      "missing-accessibility-suite",
      (value) => mutateAll(value, "accessibilitySpec", "test(", "removed("),
    ],
    [
      "missing-reusable-browser-auth-state",
      (value) =>
        mutate(
          value,
          "playwrightConfig",
          'globalSetup: "./e2e/global-setup.ts"',
          'globalSetup: "./e2e/missing-setup.ts"',
        ),
    ],
    [
      "missing-run-owned-auth-mailbox",
      (value) =>
        mutate(
          value,
          "authSetup",
          "requiredRunMailRoot(statePath, process.env.E2E_MAIL_ROOT)",
          "removedRunMailRoot(statePath)",
        ),
    ],
    [
      "missing-real-smoke-fixture",
      (value) =>
        mutate(
          value,
          "authSetup",
          "createOrganization(page, csrf)",
          "removedRealOrganizationFixture(page, csrf)",
        ),
    ],
  ];
  if (cases.length !== 37) throw new Error("CI validator self-test inventory cardinality changed");
  const executed = [];
  for (const [name, change] of cases) {
    let rejected = false;
    try {
      validate(change(structuredClone(baseline)));
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`CI validator self-test ${name} became vacuously valid`);
    executed.push(name);
  }
  if (executed.length !== cases.length)
    throw new Error("CI validator self-test executed zero or missing cases");
  console.log(`phase 2 CI validator self-test passed: ${executed.length} named negative cases`);
}

function mutate(value, key, before, after) {
  if (!value[key].includes(before)) throw new Error(`self-test mutation source missing: ${before}`);
  value[key] = value[key].replace(before, after);
  return value;
}

function mutateAll(value, key, before, after) {
  if (!value[key].includes(before)) throw new Error(`self-test mutation source missing: ${before}`);
  value[key] = value[key].replaceAll(before, after);
  return value;
}

function swap(value, key, first, second) {
  if (!value[key].includes(first) || !value[key].includes(second))
    throw new Error("self-test swap source missing");
  value[key] = value[key]
    .replace(first, "__PHASE2_SWAP__")
    .replace(second, first)
    .replace("__PHASE2_SWAP__", second);
  return value;
}
