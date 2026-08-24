import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageManifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const rootPackageManifestPath = fileURLToPath(new URL("../../../package.json", import.meta.url));
const integrationConfigPath = fileURLToPath(
  new URL("../../../vitest.integration.config.ts", import.meta.url),
);
const integrationRunnerPath = fileURLToPath(
  new URL("../../../scripts/run-phase2-integration.mjs", import.meta.url),
);
const identitySecuritySpecPath = fileURLToPath(
  new URL("../test/identity-security-change.integration.spec.ts", import.meta.url),
);

describe("database test suite boundaries", () => {
  it("keeps real integration specs out of the offline package test command", async () => {
    const manifest = JSON.parse(await readFile(packageManifestPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const testCommand = manifest.scripts?.test ?? "";

    expect(testCommand).toContain('--exclude "test/**/*.integration.spec.ts"');
    expect(testCommand).toContain('--exclude "test/**/*.concurrent.spec.ts"');
    expect(testCommand).not.toContain("--passWithNoTests");
  });

  it("keeps the D-08 spec in the preflighted integration suite without skip escape hatches", async () => {
    const [rootManifestContents, config, runner, spec] = await Promise.all([
      readFile(rootPackageManifestPath, "utf8"),
      readFile(integrationConfigPath, "utf8"),
      readFile(integrationRunnerPath, "utf8"),
      readFile(identitySecuritySpecPath, "utf8"),
    ]);
    const rootManifest = JSON.parse(rootManifestContents) as {
      scripts?: Record<string, string>;
    };

    expect(rootManifest.scripts?.["phase2:integration"]).toBe(
      "node scripts/run-phase2-integration.mjs --suite integration",
    );
    expect(runner).toContain(
      'const pnpmArguments = ["exec", "vitest", "run", "--config", "vitest.integration.config.ts"]',
    );
    expect(config).toContain('"packages/database/test/**/*.integration.spec.ts"');
    expect("packages/database/test/identity-security-change.integration.spec.ts").toMatch(
      /^packages\/database\/test\/.*\.integration\.spec\.ts$/,
    );
    expect(runner.indexOf("await runPreflight();")).toBeGreaterThan(-1);
    expect(runner.indexOf("await runSuite(suite);")).toBeGreaterThan(
      runner.indexOf("await runPreflight();"),
    );
    expect(spec).toContain('describe("identity security change transaction"');
    expect(spec).not.toMatch(
      /describe\.(?:runIf|skip)|(?:it|test)\.skip|\.todo\(|--passWithNoTests/,
    );
  });
});
