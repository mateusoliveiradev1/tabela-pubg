import { copyFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const phaseDir = ".planning/phases/02-identidade-organizacoes-e-autorizacao";
const validationPath = `${phaseDir}/02-VALIDATION.md`;
const evidencePath = `${phaseDir}/02-34-SUMMARY.md`;
const workflowPath = ".github/workflows/ci.yml";
const OLD_RUN = 32676449341;
const OLD_SHA = "a41f87c539435ed00dd848571699e5ebede8f97c";
const OLD_LABEL = "superseded for final Phase 2 closure - synthetic-only/pre-remediation";

const requirements = [
  "AUTH-001",
  "AUTH-002",
  "AUTH-003",
  "AUTH-004",
  "AUTH-005",
  "AUTH-006",
  "ORG-001",
  "ORG-002",
  "ORG-003",
  "ORG-004",
  "ORG-005",
  "AUD-001",
  "NFR-005",
];
const prerequisites = [
  ...Array.from({ length: 9 }, (_, index) => `02-${index + 25}-SUMMARY.md`),
  ...Array.from({ length: 5 }, (_, index) => `02-${index + 35}-SUMMARY.md`),
  "02-41-SUMMARY.md",
  "02-42-SUMMARY.md",
];
const jobs = [
  ["quality", "", "Quality and affected build"],
  ["phase2-integration", "suite=integration", "Phase 2 integration"],
  ["phase2-integration", "suite=concurrent", "Phase 2 concurrent"],
  ["phase2-e2e", "", "Phase 2 browser E2E"],
  ["images", "app=web", "Image web"],
  ["images", "app=api", "Image api"],
  ["images", "app=worker", "Image worker"],
  ["images", "app=discord-bot", "Image discord-bot"],
];
const components = [
  "Next+BFF",
  "Nest",
  "PostgreSQL",
  "Redis",
  "outbox publisher",
  "BullMQ consumers",
  "worker",
  "browser",
];
const decisions = new Map([
  ["D-01", ["02-37"]],
  ["D-02", ["02-30", "02-36"]],
  ["D-03", ["02-30", "02-32", "02-36", "02-37", "02-42"]],
  ["D-04", ["02-30", "02-36", "02-39"]],
  ["D-05", ["02-27", "02-32"]],
  ["D-06", ["02-27"]],
  ["D-07", ["02-26", "02-27", "02-36"]],
  ["D-08", ["02-30", "02-32", "02-36", "02-37", "02-42"]],
  ["D-09", ["02-29"]],
  ["D-10", ["02-01", "02-05", "02-09", "02-39"]],
  ["D-11", ["02-09", "02-39"]],
  ["D-12", ["02-01", "02-05", "02-09", "02-39"]],
  ["D-13", ["02-01", "02-05", "02-09", "02-39"]],
  ["D-14", ["02-01", "02-05", "02-09", "02-39"]],
  ["D-15", ["02-29", "02-35"]],
  ["D-16", ["02-01", "02-05", "02-09", "02-39"]],
  ["D-17", ["02-03", "02-05", "02-09", "02-39"]],
]);
const historical = [
  [
    "02-01",
    [
      /convites expiram em 7 dias/i,
      /Owner e admin atuam na organiza[cç][aã]o inteira/i,
      /ownership transfer permanece exclusivo de owner/i,
    ],
    [
      "packages/domain/src/identity.ts",
      "packages/domain/src/organizations.ts",
      "packages/authorization/src/index.ts",
      "packages/authorization/src/authorization.spec.ts",
    ],
  ],
  [
    "02-03",
    [/auditoria append-only/i, /schema persistente modular.*auditoria/is],
    ["packages/database/src/schema/audit.ts"],
  ],
  [
    "02-05",
    [
      /convite de sete dias/i,
      /convite single-use/i,
      /prote[cç][aã]o concorrente do [uú]ltimo owner/i,
      /visibilidade owner\/admin completa e member self-only/i,
    ],
    [
      "packages/database/src/repositories/organizations.ts",
      "packages/database/src/repositories/audit.ts",
      "packages/database/test/invitation.concurrent.spec.ts",
      "packages/database/test/last-owner.concurrent.spec.ts",
    ],
  ],
  [
    "02-09",
    [
      /convites por e-mail.*aceite at[oô]mico/is,
      /gest[aã]o de membros, cargos e transfer[eê]ncia de ownership com step-up/i,
      /Owners\/admins veem auditoria da organiza[cç][aã]o e membros somente os pr[oó]prios eventos/i,
    ],
    [
      "apps/api/src/organizations/invitations.service.ts",
      "apps/api/src/organizations/invitations.controller.ts",
      "apps/api/src/organizations/members.service.ts",
      "apps/api/src/organizations/members.controller.ts",
      "apps/api/src/audit/audit.service.ts",
      "apps/api/src/audit/audit.controller.ts",
      "apps/api/src/organizations/invitation-delivery.integration.spec.ts",
      "apps/api/src/audit/audit.integration.spec.ts",
    ],
  ],
];
const ledgerFiles = [
  ...new Set([
    ...historical.flatMap(([, , files]) => files),
    "apps/api/src/identity/identity.service.spec.ts",
    "apps/api/test/security.integration.spec.ts",
    "packages/database/test/identity-organizations.integration.spec.ts",
    "packages/database/test/identity-security-change.integration.spec.ts",
    "apps/web/e2e/phase2-accessibility.spec.ts",
    "apps/web/e2e/phase2-runtime.spec.ts",
    "scripts/run-phase2-integration.mjs",
    "scripts/run-phase2-e2e.mjs",
    "scripts/validate-phase2-ci.mjs",
    "scripts/validate-phase2-validation.mjs",
    workflowPath,
  ]),
];
const commands = [
  "rtk pnpm --filter @pubg-camp/authorization test",
  "rtk pnpm --filter @pubg-camp/api test -- identity/oauth",
  "rtk pnpm --filter @pubg-camp/api test -- identity/otp",
  "rtk pnpm --filter @pubg-camp/api test -- identity/session",
  "rtk pnpm --filter @pubg-camp/api test -- organizations",
  "rtk pnpm --filter @pubg-camp/api test -- audit",
  "rtk pnpm --filter @pubg-camp/api test -- security",
  "rtk pnpm --filter @pubg-camp/database test -- last-owner.concurrent",
  "rtk pnpm --filter @pubg-camp/database test -- invitation.concurrent",
  "rtk pnpm phase2:integration:preflight",
  "rtk pnpm phase2:integration",
  "rtk pnpm phase2:concurrent",
  "rtk pnpm test:e2e:runtime",
  "rtk pnpm --filter @pubg-camp/web test:e2e:smoke",
  "rtk pnpm --filter @pubg-camp/web test:e2e",
  "rtk pnpm verify:secrets",
  "rtk pnpm lint:boundaries",
  "rtk pnpm test",
  "rtk pnpm build",
  `rtk node scripts/validate-phase2-validation.mjs --check ${validationPath}`,
];

class Rejection extends Error {
  constructor(category, message) {
    super(`phase 2 validation rejected [${category}]: ${message}`);
    this.category = category;
  }
}
const need = (condition, category, message) => {
  if (!condition) throw new Rejection(category, message);
};
const text = (source, value, category, label = value) =>
  need(source.includes(value), category, `missing ${label}`);
const pattern = (source, value, category, label) =>
  need(value.test(source), category, `missing ${label}`);
const sameSet = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === new Set(actual).size &&
  expected.length === new Set(expected).size &&
  [...actual].sort().join("\n") === [...expected].sort().join("\n");
const exactSet = (actual, expected, category, label) =>
  need(sameSet(actual, expected), category, `${label} must equal the canonical set`);
function keys(value, expected, category, label) {
  need(
    value && typeof value === "object" && !Array.isArray(value),
    category,
    `${label} must be an object`,
  );
  exactSet(Object.keys(value), expected, category, `${label} keys`);
}
function jsonUnder(content, heading, category) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headings = [...content.matchAll(new RegExp(`^## ${escaped}\\s*$`, "gm"))];
  need(headings.length === 1, category, `${heading} heading must occur exactly once`);
  const tail = content.slice(headings[0].index + headings[0][0].length);
  const block = /^\s*```json\s*\r?\n([\s\S]*?)\r?\n```/i.exec(tail);
  need(block, category, `${heading} must have one JSON fence`);
  try {
    return JSON.parse(block[1]);
  } catch {
    throw new Rejection(category, `${heading} JSON is malformed`);
  }
}
const optional = (relative) => readFile(path.join(root, relative), "utf8").catch(() => undefined);
async function fixture(ledgerPath) {
  const plans = new Map();
  const summaries = new Map();
  for (let number = 1; number <= 42; number += 1) {
    const id = `02-${String(number).padStart(2, "0")}`;
    plans.set(id, await optional(`${phaseDir}/${id}-PLAN.md`));
    summaries.set(id, await optional(`${phaseDir}/${id}-SUMMARY.md`));
  }
  const files = new Set();
  for (const file of ledgerFiles) if (await optional(file)) files.add(file);
  return {
    ledger: await readFile(ledgerPath, "utf8"),
    evidence: await optional(evidencePath),
    workflow: await optional(workflowPath),
    plans,
    summaries,
    files,
    rootPackage: await optional("package.json"),
    webPackage: await optional("apps/web/package.json"),
  };
}
const clone = (value) => ({
  ...value,
  plans: new Map(value.plans),
  summaries: new Map(value.summaries),
  files: new Set(value.files),
});

function authorityFrom(content) {
  need(typeof content === "string", "authority", "02-34-SUMMARY.md is required");
  const value = jsonUnder(content, "Phase 2 Post-Remediation Evidence", "authority");
  keys(
    value,
    [
      "schemaVersion",
      "planCoverage",
      "branch",
      "headSha",
      "workflow",
      "mandatoryJobCount",
      "mandatoryJobs",
      "runtime",
      "cleanup",
      "reverification",
    ],
    "authority",
    "authority",
  );
  need(value.schemaVersion === 1, "authority", "schemaVersion must be 1");
  keys(value.planCoverage, ["prerequisiteSummaries", "closurePlan"], "authority", "planCoverage");
  exactSet(
    value.planCoverage.prerequisiteSummaries,
    prerequisites,
    "authority",
    "prerequisiteSummaries",
  );
  need(value.planCoverage.closurePlan === "02-40", "authority", "closurePlan must be 02-40");
  need(
    typeof value.branch === "string" && value.branch.length && value.branch.trim() === value.branch,
    "authority",
    "branch must be non-empty and trimmed",
  );
  need(
    /^[0-9a-f]{40}$/.test(value.headSha) && value.headSha !== OLD_SHA,
    "authority",
    "headSha must be a new lowercase 40-hex SHA",
  );
  keys(
    value.workflow,
    ["event", "cardinality", "runId", "runUrl", "attempt", "status", "conclusion"],
    "authority",
    "workflow evidence",
  );
  need(
    value.workflow.event === "push" && value.workflow.cardinality === 1,
    "authority",
    "workflow must be one push run",
  );
  need(
    Number.isSafeInteger(value.workflow.runId) &&
      value.workflow.runId > 0 &&
      value.workflow.runId !== OLD_RUN,
    "authority",
    "runId must be positive and post-remediation",
  );
  need(
    new RegExp(`(?:^|/)${value.workflow.runId}(?:$|[/?#])`).test(value.workflow.runUrl),
    "authority",
    "runUrl must contain exact runId",
  );
  need(
    Number.isSafeInteger(value.workflow.attempt) && value.workflow.attempt > 0,
    "authority",
    "attempt must be positive",
  );
  need(
    value.workflow.status === "completed" && value.workflow.conclusion === "success",
    "authority",
    "workflow must be completed/success",
  );
  return value;
}
const signature = (job) =>
  `${job.key}|${
    job.matrix
      ? Object.entries(job.matrix)
          .map(([key, value]) => `${key}=${value}`)
          .join("&")
      : ""
  }|${job.name}`;
function validateJobs(value) {
  need(
    value.mandatoryJobCount === 8 && Array.isArray(value.mandatoryJobs),
    "jobs",
    "mandatory job count/list must mirror eight jobs",
  );
  const actual = value.mandatoryJobs.map((job, index) => {
    keys(
      job,
      job.matrix ? ["key", "matrix", "name", "conclusion"] : ["key", "name", "conclusion"],
      "jobs",
      `job ${index}`,
    );
    if (job.matrix)
      keys(job.matrix, [job.key === "images" ? "app" : "suite"], "jobs", `job ${index} matrix`);
    need(job.conclusion === "success", "jobs", `${job.name} must conclude success`);
    return signature(job);
  });
  exactSet(
    actual,
    jobs.map(([key, matrix, name]) => `${key}|${matrix}|${name}`),
    "jobs",
    "authority jobs",
  );
}
function section(workflow, key) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`  ${key}:`);
  need(start >= 0, "workflow", `missing ${key}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1)
    if (/^ {2}[\w-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  return lines.slice(start, end).join("\n");
}
const nameOf = (source) => {
  const match = /^ {4}name:\s*(.+?)\s*$/m.exec(source);
  need(match, "workflow", "missing job name");
  return match[1];
};
function validateWorkflow(workflow) {
  need(typeof workflow === "string", "workflow", "tracked workflow is required");
  const quality = section(workflow, "quality"),
    integration = section(workflow, "phase2-integration"),
    e2e = section(workflow, "phase2-e2e"),
    images = section(workflow, "images");
  const suites =
    /^ {8}suite:\s*\[([^\]]+)\]/m
      .exec(integration)?.[1]
      .split(",")
      .map((value) => value.trim()) ?? [];
  const apps = [...images.matchAll(/^ {10}- app:\s*(\S+)/gm)].map((match) => match[1]);
  const suiteExpression = "$" + "{{ matrix.suite }}";
  const appExpression = "$" + "{{ matrix.app }}";
  const expanded = [
    ["quality", "", nameOf(quality)],
    ...suites.map((suite) => [
      "phase2-integration",
      `suite=${suite}`,
      nameOf(integration).replace(suiteExpression, suite),
    ]),
    ["phase2-e2e", "", nameOf(e2e)],
    ...apps.map((app) => ["images", `app=${app}`, nameOf(images).replace(appExpression, app)]),
  ];
  exactSet(
    expanded.map((item) => item.join("|")),
    jobs.map((item) => item.join("|")),
    "workflow",
    "tracked expanded jobs",
  );
  pattern(
    e2e,
    /^ {6}E2E_RUN_ID:\s*run-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-phase2\s*$/m,
    "workflow",
    "exact E2E_RUN_ID source",
  );
  pattern(e2e, /^\s*run:\s*pnpm test:e2e:runtime\s*$/m, "workflow", "runtime command");
}
function validateRuntime(value) {
  const runtime = value.runtime;
  keys(
    runtime,
    ["jobName", "command", "runScopeId", "runScopeSource", "components", "syntheticApi"],
    "runtime",
    "runtime",
  );
  need(
    runtime.jobName === "Phase 2 browser E2E" && runtime.command === "rtk pnpm test:e2e:runtime",
    "runtime",
    "runtime job/command must be exact",
  );
  need(
    typeof runtime.runScopeId === "string" &&
      runtime.runScopeId.length >= 19 &&
      runtime.runScopeId.length <= 67 &&
      /^run-[a-z0-9][a-z0-9-]{14,62}$/.test(runtime.runScopeId) &&
      !/^run-(all|any|default|shared|global|public|phase2|e2e|test)(-|$)/.test(runtime.runScopeId),
    "runtime",
    "invalid or broad runScopeId",
  );
  need(
    runtime.runScopeSource === ".github/workflows/ci.yml#jobs.phase2-e2e.env.E2E_RUN_ID",
    "runtime",
    "runScopeSource must be exact",
  );
  exactSet(runtime.components, components, "runtime", "runtime components");
  need(runtime.syntheticApi === false, "runtime", "synthetic API is forbidden");
}
function validateCleanup(value) {
  keys(value.cleanup, ["schema", "redisBullmqPrefix", "objectMailRoot"], "cleanup", "cleanup");
  for (const key of ["schema", "redisBullmqPrefix", "objectMailRoot"]) {
    const entry = value.cleanup[key];
    keys(entry, ["identifier", "scopeId", "removed"], "cleanup", key);
    need(
      typeof entry.identifier === "string" &&
        entry.identifier.trim() === entry.identifier &&
        entry.identifier.length &&
        !/^(\*|all|any|default|shared|global|public|phase2|e2e|test)$/i.test(entry.identifier),
      "cleanup",
      `${key} identifier invalid/broad`,
    );
    need(
      entry.scopeId === value.runtime.runScopeId && entry.removed === true,
      "cleanup",
      `${key} must match scope and be removed`,
    );
  }
}
function validateReverification(value) {
  keys(
    value.reverification,
    ["truthsPassed", "truthsTotal", "requirementsPassed", "requirementsTotal"],
    "reverification",
    "reverification",
  );
  need(
    value.reverification.truthsPassed === 6 &&
      value.reverification.truthsTotal === 6 &&
      value.reverification.requirementsPassed === 13 &&
      value.reverification.requirementsTotal === 13,
    "reverification",
    "re-verification must be exactly 6/6 and 13/13",
  );
}
function validateCoverage(data, authority) {
  for (let number = 1; number <= 42; number += 1) {
    const id = `02-${String(number).padStart(2, "0")}`;
    need(data.plans.get(id), "coverage", `${id}-PLAN.md missing`);
    const rows = [...data.ledger.matchAll(new RegExp(`^\\| ${id} \\|[^\\n]*\\|$`, "gm"))];
    need(rows.length === 1, "coverage", `${id} row must occur once`);
    const row = rows[0][0];
    if ([15, 20].includes(number)) {
      text(row, `${id}-PLAN.md`, "coverage");
      pattern(row, /established no-SUMMARY exception/i, "coverage", `${id} exception`);
    } else if (number === 34) {
      text(row, "02-34-SUMMARY.md", "coverage");
      pattern(
        row,
        /checkpoint.*excluded from implementation prerequisites/i,
        "coverage",
        "02-34 exclusion",
      );
    } else if (number === 40) {
      text(row, "02-40-PLAN.md", "coverage");
      pattern(
        row,
        /ledger.*excluded from implementation prerequisites/i,
        "coverage",
        "02-40 exclusion",
      );
    } else {
      need(data.summaries.get(id), "coverage", `${id}-SUMMARY.md missing`);
      text(row, `${id}-SUMMARY.md`, "coverage");
    }
  }
  exactSet(
    authority.planCoverage.prerequisiteSummaries,
    prerequisites,
    "coverage",
    "prerequisites",
  );
  exactSet(
    [...data.plans]
      .filter(([id, source]) => id !== "02-34" && source.includes("02-34-SUMMARY.md"))
      .map(([id]) => id),
    ["02-40"],
    "coverage",
    "02-34 consumers",
  );
}
const allowed = (plan) =>
  [...plan.matchAll(/<(behavior|action|acceptance_criteria)>([\s\S]*?)<\/\1>/g)]
    .map((match) => match[2])
    .join("\n");
const ownsCode = (plan) =>
  [
    ...plan.matchAll(
      /<task\b[^>]*type="auto"[^>]*>[\s\S]*?<files>([\s\S]*?)<\/files>[\s\S]*?<\/task>/g,
    ),
  ]
    .flatMap((match) => match[1].split(",").map((value) => value.trim()))
    .some(
      (file) =>
        !file.startsWith(".planning/") &&
        !file.startsWith(".github/") &&
        /\.(ts|tsx|mjs)$/.test(file),
    );
const hasDecisionTask = (plan, decision) =>
  [...plan.matchAll(/<task\b[^>]*>[\s\S]*?<\/task>/g)].some(
    (match) =>
      /<task\b[^>]*type="auto"/.test(match[0]) &&
      ownsCode(match[0]) &&
      allowed(match[0]).includes(decision),
  );
function rowPlans(ledger, decision) {
  const rows = [...ledger.matchAll(new RegExp(`^\\| ${decision} \\|([^\\n]*)\\|$`, "gm"))];
  need(rows.length === 1, "decisions", `${decision} row must occur once`);
  return [...rows[0][1].matchAll(/02-\d{2}/g)].map((match) => match[0]);
}
function validateDecisions(data) {
  for (const [decision, expected] of decisions) {
    exactSet(rowPlans(data.ledger, decision), expected, "decisions", `${decision} mapping`);
    for (const id of expected.filter((value) => Number(value.slice(3)) >= 25)) {
      const plan = data.plans.get(id);
      need(
        hasDecisionTask(plan, decision),
        "decisions",
        `${decision}/${id} needs one implementing auto task with executable files`,
      );
    }
  }
  const runtime = allowed(data.plans.get("02-39"));
  const phrases = [
    "`expires_at` is exactly issued-at plus seven days",
    "accepts it once only",
    "rejects replay",
    "exact verified email",
    "declared initial organization role",
    "every declared operational assignment",
    "Role change",
    "member revocation",
    "ownership transfer",
    "fresh reauthentication",
    "mutation plus one redacted reasoned audit row become visible together",
    "Owner and admin sessions see complete organization audit history",
    "ordinary member sees only events whose actor is that member",
  ];
  for (const phrase of phrases)
    text(runtime, phrase, "decisions", `02-39 runtime phrase ${phrase}`);
}
function validateHistorical(data) {
  for (const [id, claims, artifacts] of historical) {
    const plan = data.plans.get(id),
      summary = data.summaries.get(id);
    need(plan && summary, "historical", `${id} PLAN/SUMMARY required`);
    for (const claim of claims) pattern(summary, claim, "historical", `${id} SUMMARY claim`);
    for (const artifact of artifacts) {
      need(data.files.has(artifact), "historical", `${id} artifact ${artifact}`);
      text(plan, artifact, "historical");
    }
  }
}
function flags(content) {
  const read = (name) => {
    const matches = [...content.matchAll(new RegExp(`^${name}:\\s*(true|false)\\s*$`, "gm"))];
    need(matches.length === 1, "flags", `${name} must occur once`);
    return matches[0][1] === "true";
  };
  return [read("wave_0_complete"), read("nyquist_compliant")];
}
async function validate(data, expectedFlags) {
  text(data.ledger, "status: validated-automated", "ledger");
  const authority = authorityFrom(data.evidence);
  validateWorkflow(data.workflow);
  validateJobs(authority);
  validateRuntime(authority);
  validateCleanup(authority);
  validateReverification(authority);
  validateCoverage(data, authority);
  validateDecisions(data);
  validateHistorical(data);
  for (const requirement of requirements)
    pattern(
      data.ledger,
      new RegExp(`^\\| ${requirement} \\|[^\\n]*\\| verified \\|$`, "m"),
      "ledger",
      `${requirement} row`,
    );
  for (const file of ledgerFiles) {
    need(data.files.has(file), "ledger", `${file} missing`);
    text(data.ledger, `\`${file}\``, "ledger");
  }
  for (const command of commands) text(data.ledger, `\`${command}\``, "ledger");
  const rootPackage = JSON.parse(data.rootPackage),
    webPackage = JSON.parse(data.webPackage);
  need(
    rootPackage.scripts?.["test:e2e:runtime"] === "pnpm --filter @pubg-camp/web test:e2e:runtime" &&
      webPackage.scripts?.["test:e2e:runtime"] ===
        "node ../../scripts/run-phase2-e2e.mjs --runtime",
    "ledger",
    "runtime scripts missing",
  );
  const mirror = jsonUnder(data.ledger, "Final Post-Remediation Authority Mirror", "ledger");
  need(
    JSON.stringify(mirror) === JSON.stringify(authority),
    "ledger",
    "ledger mirror differs from 02-34 authority",
  );
  text(
    data.ledger,
    `Run \`${OLD_RUN}\` and SHA \`${OLD_SHA}\` — ${OLD_LABEL}`,
    "history",
    "superseded history annotation",
  );
  text(data.ledger, "`02-17-SUMMARY.md`", "history");
  text(data.ledger, "`02-24-SUMMARY.md`", "history");
  need(
    !JSON.stringify(authority).includes(String(OLD_RUN)) &&
      !JSON.stringify(authority).includes(OLD_SHA),
    "authority",
    "old authority reused",
  );
  pattern(data.ledger, /^## Runtime and cleanup evidence$/m, "ledger", "runtime section");
  const actualFlags = flags(data.ledger);
  need(
    actualFlags.every((value) => value === expectedFlags),
    "flags",
    `both flags must be ${expectedFlags}`,
  );
}

function replaceJson(content, heading, value) {
  const start = content.indexOf(`## ${heading}`),
    tailStart = start + heading.length + 3,
    tail = content.slice(tailStart),
    block = /^\s*```json\s*\r?\n[\s\S]*?\r?\n```/i.exec(tail);
  need(start >= 0 && block, "self-test", `${heading} fixture missing`);
  return `${content.slice(0, tailStart)}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`${tail.slice(block[0].length)}`;
}
const setAuthority = (data, mutate, mirror = false) => {
  const value = mutate(structuredClone(authorityFrom(data.evidence)));
  data.evidence = replaceJson(data.evidence, "Phase 2 Post-Remediation Evidence", value);
  if (mirror)
    data.ledger = replaceJson(data.ledger, "Final Post-Remediation Authority Mirror", value);
};
const changeRow = (ledger, decision, ids) =>
  ledger.replace(new RegExp(`^(\\| ${decision} \\|)[^\\n]*(\\|)$`, "m"), `$1 ${ids.join(" + ")} |`);
const deleteKey = (value, dotted) => {
  const copy = structuredClone(value),
    parts = dotted.split("."),
    last = parts.pop();
  let target = copy;
  for (const part of parts) target = target[part];
  delete target[last];
  return copy;
};

async function selfTest(target) {
  const base = await fixture(target);
  await validate(base, true);
  const cases = [];
  const add = (name, category, mutate, expected = true) =>
    cases.push({ name, category, mutate, expected });
  add("authority-missing", "authority", (data) => {
    data.evidence = data.evidence.replace(
      "## Phase 2 Post-Remediation Evidence",
      "## Removed Evidence",
    );
  });
  add("authority-duplicate", "authority", (data) => {
    data.evidence += "\n## Phase 2 Post-Remediation Evidence\n```json\n{}\n```\n";
  });
  add("authority-malformed", "authority", (data) => {
    data.evidence = data.evidence.replace('"schemaVersion": 1', '"schemaVersion": }');
  });
  add("authority-ledger-only", "authority", (data) => {
    data.evidence = data.ledger;
  });
  for (const key of [
    "schemaVersion",
    "planCoverage",
    "branch",
    "headSha",
    "workflow",
    "mandatoryJobCount",
    "mandatoryJobs",
    "runtime",
    "cleanup",
    "reverification",
  ])
    add(`authority-missing-${key}`, "authority", (data) =>
      setAuthority(data, (value) => deleteKey(value, key), true),
    );
  for (const [name, patch] of [
    ["branch", { branch: "" }],
    ["old-sha", { headSha: OLD_SHA }],
    ["uppercase-sha", { headSha: "5B1555D7693B0F5678EEAA131550CEDC985345AD" }],
  ])
    add(`authority-${name}`, "authority", (data) =>
      setAuthority(data, (value) => ({ ...value, ...patch }), true),
    );
  for (const summary of ["02-25-SUMMARY.md", "02-41-SUMMARY.md", "02-42-SUMMARY.md"])
    add(`authority-omit-${summary.slice(0, 5)}`, "authority", (data) =>
      setAuthority(
        data,
        (value) => ({
          ...value,
          planCoverage: {
            ...value.planCoverage,
            prerequisiteSummaries: value.planCoverage.prerequisiteSummaries.filter(
              (item) => item !== summary,
            ),
          },
        }),
        true,
      ),
    );
  for (const summary of ["02-34-SUMMARY.md", "02-40-SUMMARY.md"])
    add(`authority-include-${summary.slice(0, 5)}`, "authority", (data) =>
      setAuthority(
        data,
        (value) => ({
          ...value,
          planCoverage: {
            ...value.planCoverage,
            prerequisiteSummaries: [...value.planCoverage.prerequisiteSummaries, summary],
          },
        }),
        true,
      ),
    );
  add("authority-duplicate-prerequisite", "authority", (data) =>
    setAuthority(
      data,
      (value) => ({
        ...value,
        planCoverage: {
          ...value.planCoverage,
          prerequisiteSummaries: [
            ...value.planCoverage.prerequisiteSummaries,
            value.planCoverage.prerequisiteSummaries[0],
          ],
        },
      }),
      true,
    ),
  );
  add("authority-closure", "authority", (data) =>
    setAuthority(
      data,
      (value) => ({ ...value, planCoverage: { ...value.planCoverage, closurePlan: "02-34" } }),
      true,
    ),
  );
  for (const key of ["event", "cardinality", "runId", "runUrl", "attempt", "status", "conclusion"])
    add(`authority-workflow-missing-${key}`, "authority", (data) =>
      setAuthority(data, (value) => ({ ...value, workflow: deleteKey(value.workflow, key) }), true),
    );
  for (const [name, patch] of [
    ["event", { event: "workflow_dispatch" }],
    ["cardinality", { cardinality: 2 }],
    ["old-run", { runId: OLD_RUN, runUrl: `https://github/actions/runs/${OLD_RUN}` }],
    ["url", { runUrl: "https://github/actions/runs/1" }],
    ["attempt", { attempt: 0 }],
    ["status", { status: "queued" }],
    ["conclusion", { conclusion: "failure" }],
  ])
    add(`authority-workflow-${name}`, "authority", (data) =>
      setAuthority(
        data,
        (value) => ({ ...value, workflow: { ...value.workflow, ...patch } }),
        true,
      ),
    );
  for (let index = 0; index < 8; index += 1)
    add(`jobs-remove-${index}`, "jobs", (data) =>
      setAuthority(
        data,
        (value) => ({
          ...value,
          mandatoryJobCount: 7,
          mandatoryJobs: value.mandatoryJobs.filter((_, current) => current !== index),
        }),
        true,
      ),
    );
  add("jobs-count", "jobs", (data) =>
    setAuthority(data, (value) => ({ ...value, mandatoryJobCount: 7 }), true),
  );
  for (const [name, mutate] of [
    ["rename-key", (job) => ({ ...job, key: "renamed" })],
    ["rename-name", (job) => ({ ...job, name: "Renamed" })],
  ])
    add(`jobs-${name}`, "jobs", (data) =>
      setAuthority(
        data,
        (value) => ({
          ...value,
          mandatoryJobs: value.mandatoryJobs.map((job, index) => (index ? job : mutate(job))),
        }),
        true,
      ),
    );
  add("jobs-duplicate", "jobs", (data) =>
    setAuthority(
      data,
      (value) => ({
        ...value,
        mandatoryJobCount: 9,
        mandatoryJobs: [...value.mandatoryJobs, value.mandatoryJobs[0]],
      }),
      true,
    ),
  );
  add("jobs-unexpected", "jobs", (data) =>
    setAuthority(
      data,
      (value) => ({
        ...value,
        mandatoryJobCount: 9,
        mandatoryJobs: [
          ...value.mandatoryJobs,
          { key: "extra", name: "Extra", conclusion: "success" },
        ],
      }),
      true,
    ),
  );
  for (const conclusion of ["failure", "skipped", "neutral", "cancelled"])
    add(`jobs-${conclusion}`, "jobs", (data) =>
      setAuthority(
        data,
        (value) => ({
          ...value,
          mandatoryJobs: value.mandatoryJobs.map((job, index) =>
            index ? job : { ...job, conclusion },
          ),
        }),
        true,
      ),
    );
  const runIdExpression =
    "E2E_RUN_ID: run-ci-$" + "{{ github.run_id }}-$" + "{{ github.run_attempt }}-phase2";
  const workflowMutations = [
    ["quality", "  quality:", "  removed-quality:"],
    ["integration", "suite: [integration, concurrent]", "suite: [concurrent]"],
    ["concurrent", "suite: [integration, concurrent]", "suite: [integration]"],
    ["e2e", "  phase2-e2e:", "  removed-e2e:"],
    ["web", "          - app: web\n", ""],
    ["api", "          - app: api\n", ""],
    ["worker", "          - app: worker\n", ""],
    ["discord", "          - app: discord-bot\n", ""],
    ["name", "name: Quality and affected build", "name: Renamed"],
    ["runtime", "run: pnpm test:e2e:runtime", "run: pnpm missing"],
    ["scope", runIdExpression, "E2E_RUN_ID: run-shared-shared-all"],
  ];
  for (const [name, before, after] of workflowMutations)
    add(`workflow-${name}`, "workflow", (data) => {
      data.workflow = data.workflow.replace(before, after);
    });
  for (const key of [
    "jobName",
    "command",
    "runScopeId",
    "runScopeSource",
    "components",
    "syntheticApi",
  ])
    add(`runtime-missing-${key}`, "runtime", (data) =>
      setAuthority(data, (value) => ({ ...value, runtime: deleteKey(value.runtime, key) }), true),
    );
  add("runtime-job", "runtime", (data) =>
    setAuthority(
      data,
      (value) => ({ ...value, runtime: { ...value.runtime, jobName: "Wrong" } }),
      true,
    ),
  );
  add("runtime-command", "runtime", (data) =>
    setAuthority(
      data,
      (value) => ({ ...value, runtime: { ...value.runtime, command: "rtk pnpm test:e2e" } }),
      true,
    ),
  );
  for (const component of components)
    add(`runtime-remove-${component}`, "runtime", (data) =>
      setAuthority(
        data,
        (value) => ({
          ...value,
          runtime: {
            ...value.runtime,
            components: value.runtime.components.filter((item) => item !== component),
          },
        }),
        true,
      ),
    );
  add("runtime-extra-component", "runtime", (data) =>
    setAuthority(
      data,
      (value) => ({
        ...value,
        runtime: { ...value.runtime, components: [...value.runtime.components, "synthetic"] },
      }),
      true,
    ),
  );
  add("runtime-duplicate-component", "runtime", (data) =>
    setAuthority(
      data,
      (value) => ({
        ...value,
        runtime: {
          ...value.runtime,
          components: [...value.runtime.components, value.runtime.components[0]],
        },
      }),
      true,
    ),
  );
  add("runtime-synthetic", "runtime", (data) =>
    setAuthority(
      data,
      (value) => ({ ...value, runtime: { ...value.runtime, syntheticApi: true } }),
      true,
    ),
  );
  const scopes = [
    ["empty", ""],
    ["under", "run-short"],
    ["over", `run-${"a".repeat(64)}`],
    ["uppercase", "run-ABCDEFabcdef1234567890"],
    ["space", "run-valid-scope-with space"],
    ["path", "run-valid-scope/with-path"],
    ["broad", "run-shared-shared-all"],
    ["regex", "bad-valid-scope-123456789"],
  ];
  for (const [name, runScopeId] of scopes) {
    add(`runtime-scope-${name}`, "runtime", (data) =>
      setAuthority(
        data,
        (value) => ({ ...value, runtime: { ...value.runtime, runScopeId } }),
        true,
      ),
    );
    add(`runtime-equal-cleanup-${name}`, "runtime", (data) =>
      setAuthority(
        data,
        (value) => ({
          ...value,
          runtime: { ...value.runtime, runScopeId },
          cleanup: Object.fromEntries(
            Object.entries(value.cleanup).map(([key, entry]) => [
              key,
              { ...entry, scopeId: runScopeId },
            ]),
          ),
        }),
        true,
      ),
    );
  }
  add("runtime-source", "runtime", (data) =>
    setAuthority(
      data,
      (value) => ({ ...value, runtime: { ...value.runtime, runScopeSource: "wrong" } }),
      true,
    ),
  );
  for (const cleanup of ["schema", "redisBullmqPrefix", "objectMailRoot"]) {
    add(`cleanup-missing-${cleanup}`, "cleanup", (data) =>
      setAuthority(
        data,
        (value) => ({ ...value, cleanup: deleteKey(value.cleanup, cleanup) }),
        true,
      ),
    );
    for (const field of ["identifier", "scopeId", "removed"])
      add(`cleanup-${cleanup}-${field}`, "cleanup", (data) =>
        setAuthority(
          data,
          (value) => ({
            ...value,
            cleanup: { ...value.cleanup, [cleanup]: deleteKey(value.cleanup[cleanup], field) },
          }),
          true,
        ),
      );
    for (const [name, patch] of [
      ["broad", { identifier: "all" }],
      ["mismatch", { scopeId: "run-other-valid-scope-123456" }],
      ["false", { removed: false }],
    ])
      add(`cleanup-${cleanup}-${name}`, "cleanup", (data) =>
        setAuthority(
          data,
          (value) => ({
            ...value,
            cleanup: { ...value.cleanup, [cleanup]: { ...value.cleanup[cleanup], ...patch } },
          }),
          true,
        ),
      );
  }
  for (const key of ["truthsPassed", "truthsTotal", "requirementsPassed", "requirementsTotal"]) {
    add(`reverify-missing-${key}`, "reverification", (data) =>
      setAuthority(
        data,
        (value) => ({ ...value, reverification: deleteKey(value.reverification, key) }),
        true,
      ),
    );
    add(`reverify-wrong-${key}`, "reverification", (data) =>
      setAuthority(
        data,
        (value) => ({
          ...value,
          reverification: { ...value.reverification, [key]: value.reverification[key] - 1 },
        }),
        true,
      ),
    );
  }
  add("flags-partial-wave", "flags", (data) => {
    data.ledger = data.ledger.replace("wave_0_complete: true", "wave_0_complete: false");
  });
  add("flags-partial-nyquist", "flags", (data) => {
    data.ledger = data.ledger.replace("nyquist_compliant: true", "nyquist_compliant: false");
  });
  add("flags-premature", "flags", () => {}, false);
  for (const decision of decisions.keys())
    for (const ids of [["02-33"], ["02-34"], ["02-40"], ["02-33", "02-34", "02-40"]])
      add(`${decision}-${ids.join("-")}`, "decisions", (data) => {
        data.ledger = changeRow(data.ledger, decision, ids);
      });
  add("D-04-without-otp", "decisions", (data) => {
    data.ledger = changeRow(data.ledger, "D-04", ["02-39"]);
  });
  add("D-08-without-42", "decisions", (data) => {
    data.ledger = changeRow(data.ledger, "D-08", ["02-30", "02-32", "02-36", "02-37"]);
  });
  for (const [name, mutate] of [
    ["context", (plan) => `${plan.replaceAll("D-01", "D-X1")}\n<context>D-01</context>`],
    [
      "source-audit",
      (plan) =>
        `${plan.replaceAll("D-01", "D-X1")}\n<source_coverage_audit>D-01</source_coverage_audit>`,
    ],
    [
      "checkpoint",
      (plan) => plan.replace(/<task type="auto"[^>]*>/, '<task type="checkpoint:human-verify">'),
    ],
    [
      "planning-files",
      (plan) =>
        plan.replace(
          /<files>[\s\S]*?<\/files>/,
          "<files>.planning/x.md, .github/workflows/ci.yml</files>",
        ),
    ],
  ])
    add(`decision-${name}`, "decisions", (data) =>
      data.plans.set("02-37", mutate(data.plans.get("02-37"))),
    );
  for (const [decision, ids] of [
    ["D-10", ["02-01", "02-05", "02-09", "02-39"]],
    ["D-16", ["02-01", "02-05", "02-09", "02-39"]],
    ["D-17", ["02-03", "02-05", "02-09", "02-39"]],
  ]) {
    for (const id of ids)
      add(`${decision}-missing-${id}`, "decisions", (data) => {
        data.ledger = changeRow(
          data.ledger,
          decision,
          ids.filter((item) => item !== id),
        );
      });
    for (const [name, selected] of [
      ["producer-only", ids.slice(0, -1)],
      ["runtime-only", ["02-39"]],
      ["partial", ids.slice(0, 2)],
      ["unrelated", ["02-27", "02-28"]],
      ["infra", ["02-25", "02-33", "02-41"]],
    ])
      add(`${decision}-${name}`, "decisions", (data) => {
        data.ledger = changeRow(data.ledger, decision, selected);
      });
  }
  const phrases = [
    "`expires_at` is exactly issued-at plus seven days",
    "accepts it once only",
    "rejects replay",
    "exact verified email",
    "declared initial organization role",
    "every declared operational assignment",
    "Role change",
    "member revocation",
    "ownership transfer",
    "fresh reauthentication",
    "mutation plus one redacted reasoned audit row become visible together",
    "Owner and admin sessions see complete organization audit history",
    "ordinary member sees only events whose actor is that member",
  ];
  for (const phrase of phrases)
    add(`runtime-proof-${phrase}`, "decisions", (data) =>
      data.plans.set("02-39", data.plans.get("02-39").replaceAll(phrase, "removed runtime proof")),
    );
  for (const [id, claims, artifacts] of historical) {
    for (const claim of claims)
      add(`historical-${id}-claim-${claim.source}`, "historical", (data) =>
        data.summaries.set(id, data.summaries.get(id).replace(claim, "removed claim")),
      );
    for (const artifact of artifacts)
      add(`historical-${id}-${artifact}`, "historical", (data) => data.files.delete(artifact));
  }
  add("history-run", "history", (data) => {
    data.ledger = data.ledger.replace(String(OLD_RUN), "32676449342");
  });
  add("history-sha", "history", (data) => {
    data.ledger = data.ledger.replace(OLD_SHA, `b${OLD_SHA.slice(1)}`);
  });
  add("history-label", "history", (data) => {
    data.ledger = data.ledger.replace(OLD_LABEL, "historical");
  });
  add("ledger-mirror", "ledger", (data) => {
    data.ledger = data.ledger.replace("run-ci-32798458788-1-phase2", "run-ci-32798458788-1-phase3");
  });
  add("coverage-missing-42", "coverage", (data) => {
    data.ledger = data.ledger.replace(/^\| 02-42 \|.*\r?\n/m, "");
  });
  add("coverage-missing-summary", "coverage", (data) => data.summaries.set("02-38", undefined));
  add("coverage-other-consumer", "coverage", (data) =>
    data.plans.set("02-39", `${data.plans.get("02-39")}\n@${evidencePath}`),
  );
  const EXPECTED = 284;
  need(
    cases.length === EXPECTED,
    "self-test",
    `negative inventory expected ${EXPECTED}, got ${cases.length}`,
  );
  for (const item of cases) {
    const data = clone(base);
    item.mutate(data);
    let caught;
    try {
      await validate(data, item.expected);
    } catch (error) {
      caught = error;
    }
    need(caught instanceof Rejection, "self-test", `${item.name} accepted unexpectedly`);
    need(
      caught.category === item.category,
      "self-test",
      `${item.name} rejected as ${caught.category}, expected ${item.category}: ${caught.message}`,
    );
  }
  console.log(`phase 2 validation self-test passed: ${cases.length} named negative cases`);
}

async function document(file, expected) {
  const data = await fixture(file);
  await validate(data, expected);
}
async function promote(candidate, target) {
  await document(candidate, false);
  const source = await readFile(candidate, "utf8");
  const promoted = source
    .replace(/^wave_0_complete:\s*false$/m, "wave_0_complete: true")
    .replace(/^nyquist_compliant:\s*false$/m, "nyquist_compliant: true");
  const verified = `${target}.verified-${process.pid}`,
    backup = `${target}.backup-${process.pid}`;
  await writeFile(verified, promoted, { flag: "wx" });
  await document(verified, true);
  await copyFile(target, backup);
  try {
    await rename(verified, target);
    await document(target, true);
    await unlink(candidate);
    await unlink(backup);
  } catch (error) {
    await rename(backup, target).catch(() => undefined);
    await unlink(verified).catch(() => undefined);
    throw error;
  }
}

const [mode = "--check", first = validationPath, second] = process.argv.slice(2);
if (mode === "--check") await document(path.resolve(root, first), true);
else if (mode === "--candidate") {
  await document(path.resolve(root, first), false);
  if (second)
    await writeFile(path.resolve(root, second), await readFile(path.resolve(root, first)), {
      flag: "wx",
    });
} else if (mode === "--promote") {
  need(second, "cli", "--promote requires candidate and target");
  await promote(path.resolve(root, first), path.resolve(root, second));
} else if (mode === "--self-test") await selfTest(path.resolve(root, first));
else throw new Rejection("cli", `unknown mode ${mode}`);
console.log(`phase 2 validation passed (${mode}): ${first}`);
