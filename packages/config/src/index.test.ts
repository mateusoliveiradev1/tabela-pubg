import { describe, expect, it } from "vitest";
import { BaseEnvSchema, loadEnv, redactConfig } from "./index.js";

describe("configuration", () => {
  it("applies safe defaults", () => {
    const env = loadEnv(BaseEnvSchema, { SERVICE_NAME: "worker" });
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("reports invalid field names without leaking values", () => {
    expect(() => loadEnv(BaseEnvSchema, { SERVICE_NAME: "", API_TOKEN: "super-secret" })).toThrow(
      "SERVICE_NAME",
    );
    expect(() =>
      loadEnv(BaseEnvSchema, { SERVICE_NAME: "", API_TOKEN: "super-secret" }),
    ).not.toThrow("super-secret");
  });

  it("redacts common secret keys", () => {
    expect(redactConfig({ DATABASE_PASSWORD: "value", PORT: 3000 })).toEqual({
      DATABASE_PASSWORD: "[REDACTED]",
      PORT: 3000,
    });
  });
});
