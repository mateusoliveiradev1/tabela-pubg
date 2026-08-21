import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const EXPECTED_PACKAGE_NAMES = Object.freeze([
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-tabs",
  "@radix-ui/react-tooltip",
  "@radix-ui/react-toast",
  "lucide-react",
  "@testing-library/react",
  "@testing-library/user-event",
  "jsdom",
  "@playwright/test",
  "@axe-core/playwright",
]);

// Kept separate from the checkpoint contract so set equality is asserted before any network call.
const PACKAGE_ALLOWLIST = Object.freeze([
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-tabs",
  "@radix-ui/react-tooltip",
  "@radix-ui/react-toast",
  "lucide-react",
  "@testing-library/react",
  "@testing-library/user-event",
  "jsdom",
  "@playwright/test",
  "@axe-core/playwright",
]);

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const EXPECTED_CARDINALITY = 12;
const SUBPROCESS_TIMEOUT_MS = 30_000;
const DOWNLOAD_ATTEMPTS = 3;

function fail(message) {
  throw new Error(`phase 2 package audit failed closed: ${message}`);
}

function assertExactList() {
  if (!Object.isFrozen(EXPECTED_PACKAGE_NAMES) || !Object.isFrozen(PACKAGE_ALLOWLIST)) {
    fail("package lists must remain immutable");
  }

  if (
    EXPECTED_PACKAGE_NAMES.length !== EXPECTED_CARDINALITY ||
    PACKAGE_ALLOWLIST.length !== EXPECTED_CARDINALITY
  ) {
    fail(
      `expected ${EXPECTED_CARDINALITY} package names, received contract=${EXPECTED_PACKAGE_NAMES.length} allowlist=${PACKAGE_ALLOWLIST.length}`,
    );
  }

  const expectedSet = new Set(EXPECTED_PACKAGE_NAMES);
  const allowlistSet = new Set(PACKAGE_ALLOWLIST);
  if (expectedSet.size !== EXPECTED_CARDINALITY || allowlistSet.size !== EXPECTED_CARDINALITY) {
    fail("duplicate package name detected");
  }

  const missing = [...expectedSet].filter((name) => !allowlistSet.has(name));
  const extra = [...allowlistSet].filter((name) => !expectedSet.has(name));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `package set mismatch; missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}`,
    );
  }

  return {
    cardinality: EXPECTED_CARDINALITY,
    exact: true,
    packages: [...PACKAGE_ALLOWLIST],
  };
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: SUBPROCESS_TIMEOUT_MS,
    windowsHide: true,
  });

  if (result.error) {
    fail(`${label}: ${result.error.message}`);
  }
  if (result.signal) {
    fail(`${label}: terminated by ${result.signal}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "no subprocess output")
      .replace(ANSI_PATTERN, "")
      .trim()
      .slice(0, 500);
    fail(`${label}: exit ${String(result.status)}: ${detail}`);
  }

  return result.stdout;
}

function runNpm(args, label) {
  if (process.platform === "win32") {
    return run("cmd.exe", ["/d", "/s", "/c", "npm", ...args], label);
  }
  return run("npm", args, label);
}

function resolveSlopcheck() {
  const candidates = [
    process.platform === "win32"
      ? path.join(
          homedir(),
          ".cache",
          "codex-runtimes",
          "codex-primary-runtime",
          "dependencies",
          "python",
          "Scripts",
          "slopcheck.exe",
        )
      : undefined,
    "slopcheck",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: SUBPROCESS_TIMEOUT_MS,
      windowsHide: true,
    });
    if (!probe.error && probe.status === 0 && probe.stdout.trim()) {
      return { command: candidate, version: probe.stdout.trim() };
    }
  }

  fail("slopcheck executable not found; no package was approved or installed");
}

function parseJsonPayload(raw, label) {
  const clean = raw.replace(ANSI_PATTERN, "").trim();
  const match = clean.match(/^(?:\[|\{)/m);
  if (!match || match.index === undefined) fail(`${label}: JSON payload missing`);

  try {
    return JSON.parse(clean.slice(match.index));
  } catch (error) {
    fail(`${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeRepository(repository) {
  const url = typeof repository === "string" ? repository : repository?.url;
  if (typeof url !== "string" || url.trim() === "") fail("repository metadata missing");
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

function normalizeMaintainers(maintainers) {
  if (!Array.isArray(maintainers) || maintainers.length === 0) {
    fail("maintainer metadata missing");
  }
  return maintainers.map((maintainer) => {
    if (typeof maintainer === "string") return maintainer.split(" <", 1)[0];
    if (maintainer && typeof maintainer.name === "string") return maintainer.name;
    return fail("invalid maintainer metadata");
  });
}

function normalizePublisher(publisher, maintainers) {
  if (publisher && typeof publisher.name === "string" && publisher.name.trim()) {
    return publisher.name;
  }
  if (typeof publisher === "string" && publisher.trim()) {
    return publisher.split(" <", 1)[0];
  }
  return maintainers[0];
}

function validateMetadata(name, metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail(`${name}: npm metadata is not an object`);
  }

  const version = metadata.version;
  const createdAt = metadata.time?.created;
  const modifiedAt = metadata.time?.modified;
  const publishedAt = typeof version === "string" ? metadata.time?.[version] : undefined;
  const integrity = metadata["dist.integrity"];
  if (
    typeof version !== "string" ||
    typeof createdAt !== "string" ||
    typeof modifiedAt !== "string" ||
    typeof publishedAt !== "string" ||
    typeof integrity !== "string"
  ) {
    fail(`${name}: incomplete version, time, or dist.integrity metadata`);
  }

  const repository = normalizeRepository(metadata.repository);
  const maintainers = normalizeMaintainers(metadata.maintainers);
  const publisher = normalizePublisher(metadata._npmUser, maintainers);
  const scripts = metadata.scripts === undefined ? {} : metadata.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    fail(`${name}: invalid scripts metadata`);
  }
  if (typeof scripts.postinstall === "string" && scripts.postinstall.trim()) {
    fail(`${name}: unexpected postinstall script: ${scripts.postinstall.slice(0, 120)}`);
  }

  return {
    version,
    publisher,
    repository,
    maintainers,
    integrity,
    createdAt,
    publishedAt,
    modifiedAt,
    scripts,
    hasPostinstall: false,
  };
}

function validateSlopcheck(name, payload) {
  if (!Array.isArray(payload) || payload.length !== 1) {
    fail(`${name}: slopcheck must return exactly one result`);
  }
  const result = payload[0];
  if (result?.package !== name || result?.ecosystem !== "npm") {
    fail(`${name}: slopcheck returned a result for a different package or ecosystem`);
  }
  if (result.status !== "OK") {
    fail(`${name}: slopcheck verdict ${String(result.status)}`);
  }
  if (!Array.isArray(result.flags) || result.flags.length > 0) {
    fail(`${name}: slopcheck returned unexpected flags`);
  }
  return { status: result.status, flags: result.flags };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchRegistrySnapshot(name) {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(name)}&size=20`;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "pubg-camp-package-audit/1" },
      signal: AbortSignal.timeout(SUBPROCESS_TIMEOUT_MS),
    });
    if (response.status === 429 && attempt < DOWNLOAD_ATTEMPTS) {
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfterSeconds)
        ? Math.min(retryAfterSeconds * 1_000, 5_000)
        : attempt * 1_000;
      await wait(delay);
      continue;
    }
    if (!response.ok) fail(`${name}: npm registry search returned ${response.status}`);
    const payload = await response.json();
    const matches = Array.isArray(payload.objects)
      ? payload.objects.filter((item) => item?.package?.name === name)
      : [];
    if (matches.length !== 1) fail(`${name}: npm registry search did not return one exact match`);
    const match = matches[0];
    if (
      !Number.isSafeInteger(match.downloads?.weekly) ||
      typeof match.package?.version !== "string" ||
      typeof match.package?.publisher?.username !== "string" ||
      typeof match.package?.links?.repository !== "string" ||
      typeof match.package?.date !== "string"
    ) {
      fail(`${name}: incomplete npm registry provenance or download metadata`);
    }
    return {
      weeklyDownloads: match.downloads.weekly,
      version: match.package.version,
      publisher: match.package.publisher.username,
      repository: normalizeRepository(match.package.links.repository),
      publishedAt: match.package.date,
    };
  }
  fail(`${name}: npm registry search exhausted retry budget`);
}

function packageAgeDays(createdAt, now) {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || created > now.getTime()) fail("invalid package creation date");
  return Math.floor((now.getTime() - created) / 86_400_000);
}

async function auditPackage(name, slopcheck, now) {
  const npmRaw = runNpm(
    [
      "view",
      `${name}@latest`,
      "version",
      "time",
      "repository",
      "maintainers",
      "_npmUser",
      "dist.integrity",
      "scripts",
      "--json",
    ],
    `${name}: npm view`,
  );
  const metadata = validateMetadata(name, parseJsonPayload(npmRaw, `${name}: npm view`));

  const slopRaw = run(
    slopcheck.command,
    ["scan", "--pkg", "npm", "--json", name],
    `${name}: slopcheck scan`,
  );
  const verdict = validateSlopcheck(name, parseJsonPayload(slopRaw, `${name}: slopcheck scan`));
  const registry = await fetchRegistrySnapshot(name);
  if (
    registry.version !== metadata.version ||
    registry.publisher !== metadata.publisher ||
    registry.repository !== metadata.repository ||
    registry.publishedAt !== metadata.publishedAt
  ) {
    fail(`${name}: npm view and registry search provenance disagree`);
  }

  return {
    name,
    npmUrl: `https://www.npmjs.com/package/${name}`,
    ...metadata,
    ageDays: packageAgeDays(metadata.createdAt, now),
    weeklyDownloads: registry.weeklyDownloads,
    downloadWindow: "last-week",
    slopcheck: verdict,
  };
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function toMarkdown(report) {
  const lines = [
    `Auditoria coletada em ${report.collectedAt} com ${report.slopcheckVersion}.`,
    "",
    "| Pacote | Versão | Publisher | Repositório | Criado | Idade | Downloads/semana | Postinstall | slopcheck |",
    "|---|---:|---|---|---|---:|---:|---|---|",
  ];
  for (const item of report.packages) {
    lines.push(
      `| [${escapeCell(item.name)}](${item.npmUrl}) | ${escapeCell(item.version)} | ${escapeCell(item.publisher)} | [oficial](${item.repository}) | ${item.createdAt.slice(0, 10)} | ${item.ageDays} dias | ${item.weeklyDownloads.toLocaleString("pt-BR")} | ausente | ${item.slopcheck.status} |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const exactList = assertExactList();
  const args = new Set(process.argv.slice(2));
  const supportedArgs = new Set(["--verify-exact-list", "--json"]);
  const unknown = [...args].filter((arg) => !supportedArgs.has(arg));
  if (unknown.length > 0) fail(`unsupported argument(s): ${unknown.join(", ")}`);

  if (args.has("--verify-exact-list")) {
    console.log(JSON.stringify(exactList, null, 2));
    return;
  }

  const slopcheck = resolveSlopcheck();
  const now = new Date();
  const packages = [];
  for (const name of PACKAGE_ALLOWLIST) {
    packages.push(await auditPackage(name, slopcheck, now));
  }

  const report = {
    schemaVersion: 1,
    verifiedExactList: exactList.exact,
    collectedAt: now.toISOString(),
    slopcheckVersion: slopcheck.version,
    packages,
  };
  console.log(args.has("--json") ? JSON.stringify(report, null, 2) : toMarkdown(report));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
