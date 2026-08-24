import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type VitestSelectionConfig = {
  test?: {
    include?: string[];
    exclude?: string[];
  };
};

const offlineConfigPath = new URL("../../vitest.config.ts", import.meta.url);
const redisConfigPath = new URL("../../vitest.redis-integration.config.ts", import.meta.url);
const rootPackagePath = new URL("../../../../package.json", import.meta.url);
const redisSpecPath = new URL(
  "./adapters/redis-auth-rate-limiter.integration.spec.ts",
  import.meta.url,
);
const redisSpecSelector = "src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts";

describe("identity test selection structure", () => {
  it("keeps API offline tests inside src and excludes every integration or dist spec", async () => {
    expect(existsSync(offlineConfigPath)).toBe(true);
    if (!existsSync(offlineConfigPath)) return;

    const config = await loadConfig(offlineConfigPath);
    expect(config.test?.include).toEqual(["src/**/*.spec.ts"]);
    expect(config.test?.exclude).toEqual(
      expect.arrayContaining(["src/**/*.integration.spec.ts", "dist/**"]),
    );
  });

  it("selects exactly one source Redis spec through the fail-closed dedicated chain", async () => {
    expect(existsSync(redisConfigPath)).toBe(true);
    if (!existsSync(redisConfigPath)) return;

    const config = await loadConfig(redisConfigPath);
    expect(config.test?.include).toEqual([redisSpecSelector]);
    expect(config.test?.exclude).toContain("dist/**");

    const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const dedicatedCommand = rootPackage.scripts?.["phase2:redis-integration"] ?? "";
    expect(dedicatedCommand).toContain("phase2:integration:preflight");
    expect(dedicatedCommand).toContain("vitest.redis-integration.config.ts");
    expect(dedicatedCommand).not.toContain("passWithNoTests");
    expect(dedicatedCommand.indexOf("phase2:integration:preflight")).toBeLessThan(
      dedicatedCommand.indexOf("vitest.redis-integration.config.ts"),
    );

    const redisSpec = readFileSync(redisSpecPath, "utf8");
    expect(redisSpec).not.toMatch(
      /describe\.runIf|it\.runIf|describe\.skip|it\.skip|\.todo\(|passWithNoTests/,
    );
  });
});

async function loadConfig(file: URL): Promise<VitestSelectionConfig> {
  const loaded = (await import(file.href)) as {
    default: VitestSelectionConfig;
  };
  return loaded.default;
}
