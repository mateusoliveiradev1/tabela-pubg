import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts"],
    exclude: ["dist/**"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
