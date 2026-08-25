import { defineConfig, devices } from "@playwright/test";
import { phase2AuthStatePath, shouldBootstrapPhase2Auth } from "./e2e/auth-state.js";

const baseURL = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3100";
const authStatePath =
  shouldBootstrapPhase2Auth(process.env) && process.env.E2E_RUN_ID && process.env.E2E_OBJECT_ROOT
    ? phase2AuthStatePath(process.env)
    : undefined;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  outputDir: "test-results",
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-320",
      testIgnore: "phase2-runtime.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 800 },
        ...(authStatePath === undefined ? {} : { storageState: authStatePath }),
      },
    },
    {
      name: "tablet-768",
      testIgnore: "phase2-runtime.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        ...(authStatePath === undefined ? {} : { storageState: authStatePath }),
      },
    },
    {
      name: "desktop-1440",
      testIgnore: "phase2-runtime.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...(authStatePath === undefined ? {} : { storageState: authStatePath }),
      },
    },
    {
      name: "reduced-motion",
      testIgnore: "phase2-runtime.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
        ...(authStatePath === undefined ? {} : { storageState: authStatePath }),
      },
    },
    {
      name: "phase2-runtime",
      testMatch: "phase2-runtime.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
