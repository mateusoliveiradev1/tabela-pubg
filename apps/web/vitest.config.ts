import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    include: /\.[jt]sx$/,
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/**/*.spec.tsx"],
        },
      },
    ],
  },
});
