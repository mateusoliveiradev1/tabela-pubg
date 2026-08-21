import { defineConfig } from "vitest/config";

const suite = process.env.PHASE2_SUITE;

if (suite !== "integration" && suite !== "concurrent") {
  throw new Error("PHASE2_SUITE must be integration or concurrent");
}

export default defineConfig({
  test: {
    include:
      suite === "concurrent"
        ? ["packages/database/test/**/*.concurrent.spec.ts"]
        : ["packages/database/test/**/*.integration.spec.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    sequence: {
      concurrent: false,
    },
    testTimeout: suite === "concurrent" ? 30_000 : 15_000,
    hookTimeout: 30_000,
  },
});
