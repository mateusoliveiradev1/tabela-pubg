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
const integrationIndex = job.search(/pnpm phase2:integration(?=\s|$)/);
const concurrentIndex = job.indexOf("pnpm phase2:concurrent");

if (!(preflightIndex < integrationIndex && integrationIndex < concurrentIndex)) {
  throw new Error("phase 2 CI must run preflight, integration, then concurrent suites in order");
}

console.log(`phase 2 CI structure passed: ${path.relative(process.cwd(), workflowPath)}`);
