import { readFile } from "node:fs/promises";
import path from "node:path";

const workflowPath = path.resolve(process.argv[2] ?? ".github/workflows/ci.yml");
const workflow = await readFile(workflowPath, "utf8");
const lines = workflow.split(/\r?\n/);
const jobStart = lines.findIndex((line) => /^ {2}phase2-integration:\s*$/.test(line));

if (jobStart < 0) {
  throw new Error("CI must define the phase2-integration job");
}

let jobEnd = lines.length;
for (let index = jobStart + 1; index < lines.length; index += 1) {
  if (/^ {2}[a-zA-Z0-9_-]+:\s*$/.test(lines[index])) {
    jobEnd = index;
    break;
  }
}

const job = lines.slice(jobStart, jobEnd).join("\n");
const requiredPatterns = [
  [/^ {4}services:\s*$/m, "services block"],
  [/^ {4}strategy:\s*$/m, "matrix strategy"],
  [/^ {8}suite:\s*\[integration, concurrent\]\s*$/m, "integration and concurrent matrix"],
  [/^ {6}postgres:\s*$/m, "PostgreSQL service"],
  [/^ {6}redis:\s*$/m, "Redis service"],
  [/--health-cmd[^\n]*pg_isready/i, "PostgreSQL healthcheck"],
  [/--health-cmd[^\n]*redis-cli[^\n]*ping/i, "Redis healthcheck"],
  [/^ {4}env:\s*$/m, "job environment"],
  [/^ {6}DATABASE_URL:\s*\S+/m, "DATABASE_URL"],
  [/^ {6}REDIS_URL:\s*\S+/m, "REDIS_URL"],
  [/pnpm install --frozen-lockfile/, "frozen dependency install"],
  [/pnpm --filter @pubg-camp\/storage build/, "fresh-checkout storage build"],
  [/pnpm phase2:integration:preflight/, "explicit preflight"],
  [/pnpm phase2:integration(?=\s|$)/m, "integration suite"],
  [/pnpm phase2:concurrent\b/m, "concurrent suite"],
  [/set -o pipefail/, "pipeline failure propagation"],
  [/\[REDACTED\]/, "credential redaction"],
  [/actions\/upload-artifact@v\d+/, "redacted log artifact upload"],
  [/name:\s*phase2-\$\{\{ matrix\.suite \}\}-logs/, "per-suite artifact name"],
];

for (const [pattern, description] of requiredPatterns) {
  if (!pattern.test(job)) {
    throw new Error(`phase2-integration job is missing ${description}`);
  }
}

const forbiddenPatterns = [
  [/continue-on-error\s*:/i, "continue-on-error"],
  [/\b(?:TODO|FIXME|placeholder)\b/i, "placeholder marker"],
  [/\bskip(?:ped|ping)?\b/i, "skip marker"],
  [/^\s*if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/im, "disabled step"],
];

for (const [pattern, description] of forbiddenPatterns) {
  if (pattern.test(job)) {
    throw new Error(`phase2-integration job contains forbidden ${description}`);
  }
}

const preflightIndex = job.indexOf("pnpm phase2:integration:preflight");
const storageBuildIndex = job.indexOf("pnpm --filter @pubg-camp/storage build");
const integrationIndex = job.search(/pnpm phase2:integration(?=\s|$)/);
const concurrentIndex = job.indexOf("pnpm phase2:concurrent");

if (
  !(
    storageBuildIndex < preflightIndex &&
    preflightIndex < integrationIndex &&
    integrationIndex < concurrentIndex
  )
) {
  throw new Error("phase 2 CI must run preflight, integration, then concurrent suites in order");
}

const e2eJobStart = lines.findIndex((line) => /^ {2}phase2-e2e:\s*$/.test(line));
if (e2eJobStart < 0) throw new Error("CI must define the phase2-e2e job");
let e2eJobEnd = lines.length;
for (let index = e2eJobStart + 1; index < lines.length; index += 1) {
  if (/^ {2}[a-zA-Z0-9_-]+:\s*$/.test(lines[index])) {
    e2eJobEnd = index;
    break;
  }
}
const e2eJob = lines.slice(e2eJobStart, e2eJobEnd).join("\n");
const e2eRequirements = [
  [/^ {6}postgres:\s*$/m, "PostgreSQL browser service"],
  [/^ {6}redis:\s*$/m, "Redis browser service"],
  [/E2E_PROVIDER_MODE:\s*fake/, "fake provider mode"],
  [
    /E2E_RUN_ID:\s*run-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-phase2/,
    "run-scoped E2E id",
  ],
  [
    /pnpm turbo run build --filter=@pubg-camp\/web\^\.\.\./,
    "fresh-checkout browser dependency build",
  ],
  [/playwright install --with-deps chromium/, "official Chromium install"],
  [/test:e2e:smoke/, "browser smoke"],
  [/test:e2e(?=\s|$)/m, "complete browser suite"],
  [/if:\s*failure\(\)/, "failure-only browser artifacts"],
];
for (const [pattern, description] of e2eRequirements) {
  if (!pattern.test(e2eJob)) throw new Error(`phase2-e2e job is missing ${description}`);
}
if (
  e2eJob.indexOf("pnpm turbo run build --filter=@pubg-camp/web^...") >=
  e2eJob.indexOf("pnpm phase2:integration:preflight")
) {
  throw new Error(
    "phase 2 browser CI must build web workspace dependencies before preflight and browser suites",
  );
}
if (e2eJob.indexOf("test:e2e:smoke") >= e2eJob.search(/test:e2e(?=\s|$)/m)) {
  throw new Error("phase 2 browser smoke must run before the complete E2E suite");
}
if (
  !/^\s*branches:\s*\[main,\s*"phase\/02-identidade-organizacoes-e-autorizacao"\]\s*$/m.test(
    workflow,
  )
) {
  throw new Error("CI push branches must preserve main and the exact phase 2 branch");
}
if (!/^\s*pull_request:\s*$/m.test(workflow)) {
  throw new Error("CI must preserve the pull_request trigger");
}

console.log(`phase 2 CI structure passed: ${path.relative(process.cwd(), workflowPath)}`);
