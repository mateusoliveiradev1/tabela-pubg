import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const validationRelativePath =
  ".planning/phases/02-identidade-organizacoes-e-autorizacao/02-VALIDATION.md";

const requiredRequirements = [
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

const decisionCoverage = new Map([
  ["D-01", "02-06, 02-07, 02-12"],
  ["D-02", "02-02, 02-06, 02-12"],
  ["D-03", "02-04, 02-06, 02-13"],
  ["D-04", "02-09, 02-13"],
  ["D-05", "02-03, 02-04, 02-06, 02-13"],
  ["D-06", "02-03, 02-04, 02-06"],
  ["D-07", "02-04, 02-06, 02-08, 02-13, 02-16"],
  ["D-08", "02-04, 02-06, 02-09, 02-13, 02-14"],
  ["D-09", "02-03, 02-05, 02-09"],
  ["D-10", "02-05, 02-08, 02-09, 02-14"],
  ["D-11", "02-05, 02-09, 02-12"],
  ["D-12", "02-01, 02-05, 02-09, 02-14"],
  ["D-13", "02-01, 02-09, 02-14"],
  ["D-14", "02-01, 02-09, 02-14"],
  ["D-15", "02-01, 02-09, 02-16"],
  ["D-16", "02-06, 02-09, 02-14"],
  ["D-17", "02-05, 02-09, 02-14"],
]);

const requiredFiles = [
  "packages/authorization/src/authorization.spec.ts",
  "apps/api/src/identity/identity.service.spec.ts",
  "apps/api/test/security.integration.spec.ts",
  "packages/database/test/identity-organizations.integration.spec.ts",
  "packages/database/test/last-owner.concurrent.spec.ts",
  "packages/database/test/invitation.concurrent.spec.ts",
  "apps/web/e2e/phase2-accessibility.spec.ts",
  "scripts/run-phase2-integration.mjs",
  "scripts/run-phase2-e2e.mjs",
  ".github/workflows/ci.yml",
];

const requiredCommands = [
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
  "rtk pnpm --filter @pubg-camp/web test:e2e:smoke",
  "rtk pnpm --filter @pubg-camp/web test:e2e",
  "rtk pnpm verify:secrets",
  "rtk pnpm lint:boundaries",
  "rtk pnpm test",
  "rtk pnpm build",
  `rtk node scripts/validate-phase2-validation.mjs --check ${validationRelativePath}`,
];

const requiredPackageScripts = new Map([
  [
    "package.json",
    [
      "phase2:integration:preflight",
      "phase2:integration",
      "phase2:concurrent",
      "verify:secrets",
      "lint:boundaries",
      "test",
      "build",
    ],
  ],
  ["apps/web/package.json", ["test:e2e:smoke", "test:e2e"]],
]);

const requiredCiJobs = [
  "Quality and affected build",
  "Phase 2 integration",
  "Phase 2 concurrent",
  "Image discord-bot",
  "Image worker",
  "Image api",
  "Image web",
  "Phase 2 browser E2E",
];

function fail(message) {
  throw new Error(`phase 2 validation rejected: ${message}`);
}

function requireText(content, expected, description = expected) {
  if (!content.includes(expected)) fail(`missing ${description}`);
}

function requirePattern(content, pattern, description) {
  if (!pattern.test(content)) fail(`missing or ambiguous ${description}`);
}

async function requireFile(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch {
    fail(`referenced file does not exist: ${relativePath}`);
  }
}

function readBooleanFlag(content, name) {
  const matches = [...content.matchAll(new RegExp(`^${name}:\\s*(true|false)\\s*$`, "gm"))];
  if (matches.length !== 1) fail(`${name} must occur exactly once as a boolean`);
  return matches[0][1] === "true";
}

async function validatePackageScripts() {
  for (const [manifestPath, scriptNames] of requiredPackageScripts) {
    const manifest = JSON.parse(await requireFile(manifestPath));
    for (const scriptName of scriptNames) {
      if (typeof manifest.scripts?.[scriptName] !== "string") {
        fail(`command references missing package script ${manifestPath}#${scriptName}`);
      }
    }
  }
}

async function validatePlanCoverage(content) {
  for (let number = 1; number <= 24; number += 1) {
    const id = `02-${String(number).padStart(2, "0")}`;
    await requireFile(`.planning/phases/02-identidade-organizacoes-e-autorizacao/${id}-PLAN.md`);
    requirePattern(content, new RegExp(`^\\| ${id} \\|`, "m"), `coverage row for ${id}`);

    if (![15, 20].includes(number)) {
      const summary = `${id}-SUMMARY.md`;
      await requireFile(`.planning/phases/02-identidade-organizacoes-e-autorizacao/${summary}`);
      requireText(content, summary, `summary evidence for ${id}`);
    }
  }

  requirePattern(
    content,
    /^\| 02-15 \|[^\n]*02-15-PLAN\.md[^\n]*manual pendente[^\n]*\|$/m,
    "02-15 manual-pending status",
  );
  requirePattern(
    content,
    /^\| 02-20 \|[^\n]*02-20-PLAN\.md[^\n]*validador atual[^\n]*\|$/m,
    "02-20 current-validator status",
  );
}

function validateRequirementsAndDecisions(content) {
  for (const requirement of requiredRequirements) {
    requirePattern(
      content,
      new RegExp(`^\\| ${requirement} \\|`, "m"),
      `requirement row ${requirement}`,
    );
  }
  for (const [decision, plans] of decisionCoverage) {
    requirePattern(
      content,
      new RegExp(`^\\| ${decision} \\|[^\\n]*${plans.replaceAll("-", "\\-")}[^\\n]*\\|$`, "m"),
      `decision coverage ${decision} -> ${plans}`,
    );
  }
}

async function validateFilesAndCommands(content) {
  for (const file of requiredFiles) {
    await requireFile(file);
    requireText(content, `\`${file}\``, `file reference ${file}`);
  }
  for (const command of requiredCommands) {
    requireText(content, `\`${command}\``, `RTK command ${command}`);
  }
  const commandLiterals = [...content.matchAll(/`(rtk [^`]+)`/g)].map((match) => match[1]);
  if (commandLiterals.length < requiredCommands.length) fail("command matrix is incomplete");
  if (commandLiterals.some((command) => /\bwatch\b/i.test(command))) {
    fail("watch mode is forbidden in validation commands");
  }
  await validatePackageScripts();
}

function validateManualCheckpoints(content) {
  const manualRows = [
    ["MANUAL-01", "02-15 / Task 1", "Discord/PKCE sandbox"],
    ["MANUAL-02", "02-15 / Task 2", "acessibilidade assistiva"],
    ["MANUAL-03", "02-15 / Task 3", "Resend/TLS"],
  ];
  for (const [id, task, scope] of manualRows) {
    const rowPattern = new RegExp(
      `^\\| ${id} \\| ${task.replace("/", "\\/")} \\| ${scope} \\| pendente \\|$`,
      "mi",
    );
    requirePattern(content, rowPattern, `${id} explicit pending checkpoint`);
  }
  if (/^\| MANUAL-0[123] \|[^\n]*\|\s*(?:aprovado|success|conclu[ií]do)\s*\|$/gim.test(content)) {
    fail("02-15 manual checkpoint was marked complete without human evidence");
  }
  requireText(
    content,
    "Nyquist automatizado não aprova os checkpoints manuais do plano 02-15.",
    "manual/automated separation statement",
  );
}

async function validateDistinctEvidence(content) {
  const infraPath = ".planning/phases/02-identidade-organizacoes-e-autorizacao/02-17-SUMMARY.md";
  const ciPath = ".planning/phases/02-identidade-organizacoes-e-autorizacao/02-24-SUMMARY.md";
  const infra = await requireFile(infraPath);
  const ci = await requireFile(ciPath);

  for (const evidence of [
    "PostgreSQL Neon isolado",
    "Redis real restrito ao loopback",
    "phase 2 integration preflight passed against PostgreSQL and Redis",
    "exit code 0",
  ]) {
    requireText(infra, evidence, `02-17 infrastructure evidence: ${evidence}`);
  }
  if (infra.includes("32676449341")) fail("02-17 evidence must be distinct from final CI evidence");

  const exactCiEvidence = [
    "**Event:** `push`",
    "**HEAD SHA:** `a41f87c539435ed00dd848571699e5ebede8f97c`",
    "**Cardinality:** exatamente 1 run correspondente",
    "**Run ID / attempt:** `32676449341` / `1`",
    "https://github.com/mateusoliveiradev1/tabela-pubg/actions/runs/32676449341",
    "**Status / conclusion:** `completed` / `success`",
    "O smoke executou 2 testes",
    "26 passados e 6 skips condicionais esperados",
    "suites obrigatórias não skipped",
  ];
  for (const evidence of exactCiEvidence) {
    requireText(ci, evidence, `02-24 final CI evidence: ${evidence}`);
  }
  for (const job of requiredCiJobs) {
    requirePattern(
      ci,
      new RegExp(`^\\| ${job.replaceAll("/", "\\/")} \\| [0-9]+ \\| success \\|`, "m"),
      `successful mandatory CI job ${job}`,
    );
  }

  requireText(content, `\`${infraPath}\``, "02-17 evidence link");
  requireText(content, `\`${ciPath}\``, "02-24 evidence link");
  requireText(content, "32676449341", "final CI run id in validation matrix");
  requireText(
    content,
    "integration + concurrent + smoke + E2E completo",
    "complete CI suite statement",
  );
  requireText(content, "nenhuma suíte obrigatória skipped", "no mandatory skipped statement");
}

async function validateDocument(filePath, expectedFlags) {
  const content = await readFile(filePath, "utf8").catch(() => fail(`cannot read ${filePath}`));

  requireText(content, "status: validated-automated", "validated automated status");
  await validatePlanCoverage(content);
  validateRequirementsAndDecisions(content);
  await validateFilesAndCommands(content);
  validateManualCheckpoints(content);
  await validateDistinctEvidence(content);
  requirePattern(content, /^## Runtimes medidos$/m, "measured runtimes section");
  if (/❌\s*Wave 0|IDs de tarefa serão substituídos|pendente da geração/i.test(content)) {
    fail("draft or unresolved Wave 0 marker remains");
  }

  const waveComplete = readBooleanFlag(content, "wave_0_complete");
  const nyquistCompliant = readBooleanFlag(content, "nyquist_compliant");
  if (waveComplete !== expectedFlags || nyquistCompliant !== expectedFlags) {
    fail(
      `expected wave_0_complete and nyquist_compliant to both be ${expectedFlags ? "true" : "false"}`,
    );
  }
  return content;
}

async function promoteCandidate(candidatePath, targetPath) {
  const candidate = await validateDocument(candidatePath, false);
  const promoted = candidate
    .replace(/^wave_0_complete:\s*false\s*$/m, "wave_0_complete: true")
    .replace(/^nyquist_compliant:\s*false\s*$/m, "nyquist_compliant: true");

  const verificationPath = `${candidatePath}.verified-${process.pid}`;
  await writeFile(verificationPath, promoted, { encoding: "utf8", flag: "wx" });
  try {
    await validateDocument(verificationPath, true);
    await rename(verificationPath, targetPath);
    await validateDocument(targetPath, true);
    await unlink(candidatePath);
  } catch (error) {
    await rename(verificationPath, candidatePath).catch(() => undefined);
    throw error;
  }
}

async function expectRejected(label, content, expectedFlags = true) {
  const temporaryPath = path.join(tmpdir(), `phase2-validation-${process.pid}-${label}.md`);
  await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
  let rejected = false;
  try {
    await validateDocument(temporaryPath, expectedFlags);
  } catch {
    rejected = true;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  if (!rejected) fail(`self-test ${label} was accepted unexpectedly`);
}

async function runSelfTest(targetPath) {
  const baseline = await validateDocument(targetPath, true);
  await expectRejected("missing-requirement", baseline.replace(/^\| AUTH-006 \|.*\r?\n/m, ""));
  await expectRejected("wrong-run", baseline.replaceAll("32676449341", "32676449342"));
  await expectRejected(
    "mandatory-skip",
    baseline.replace(
      "integration + concurrent + smoke + E2E completo e nenhuma suíte obrigatória skipped",
      "integration + concurrent + smoke + E2E completo com suíte obrigatória skipped",
    ),
  );
  await expectRejected(
    "manual-premature",
    baseline.replace(
      "| MANUAL-01 | 02-15 / Task 1 | Discord/PKCE sandbox | pendente |",
      "| MANUAL-01 | 02-15 / Task 1 | Discord/PKCE sandbox | aprovado |",
    ),
  );
  await expectRejected(
    "premature-flags",
    baseline
      .replace(/^wave_0_complete:\s*true\s*$/m, "wave_0_complete: false")
      .replace(/^nyquist_compliant:\s*true\s*$/m, "nyquist_compliant: false"),
  );
}

const [mode = "--check", firstPath = validationRelativePath, secondPath] = process.argv.slice(2);
if (mode === "--check") {
  await validateDocument(path.resolve(root, firstPath), true);
} else if (mode === "--candidate") {
  await validateDocument(path.resolve(root, firstPath), false);
} else if (mode === "--promote") {
  if (!secondPath) fail("--promote requires candidate and target paths");
  await promoteCandidate(path.resolve(root, firstPath), path.resolve(root, secondPath));
} else if (mode === "--self-test") {
  await runSelfTest(path.resolve(root, firstPath));
} else {
  fail(`unknown mode ${mode}`);
}

console.log(`phase 2 validation passed (${mode}): ${firstPath}`);
