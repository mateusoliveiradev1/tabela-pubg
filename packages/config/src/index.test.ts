import { describe, expect, it } from "vitest";
import {
  BaseEnvSchema,
  getSecurityWarnings,
  loadEnv,
  Phase2EnvSchema,
  redactConfig,
} from "./index.js";

const validPhase2Env = {
  SERVICE_NAME: "api",
  APP_ORIGIN: "http://localhost:3000",
  DISCORD_CLIENT_ID: "123456789012345678",
  DISCORD_CLIENT_SECRET: "dsc_6qT2kJ8mW4xP9vN3rF7yH5uC1aB0eZsL",
  DISCORD_REDIRECT_URI: "http://localhost:3000/entrar/discord/retorno",
  SESSION_COOKIE_SECRET: "ses_9mA3vK7xQ2nT6cR8pL4yH1uF5wD0eJsB",
  SESSION_COOKIE_SECURE: "false",
  CSRF_SECRET: "csr_2vN8kP4mY6tR1xQ9aL5wH3uF7cD0eJsB",
  OTP_PEPPER: "otp_7xR3mK9vQ2nT6pL8aF4wH1uC5yD0eJsB",
  AES_GCM_KEY_V1: "5f4dcc3b5aa765d61d8327deb882cf994f4dcc3b5aa765d61d8327deb882cf99",
  ENCRYPTION_KEY_VERSION: "v1",
  REDIS_URL: "redis://localhost:6379",
  RESEND_API_KEY: "re_4nQ8vK2mT6xP9aL3yH7uF1cR5wD0eJsB",
  EMAIL_FROM: "security@example.com",
  TRUSTED_PROXY: "loopback",
} as const;

describe("configuration", () => {
  it.each([
    "http://localhost:3000/",
    "http://localhost:3000/path",
    "http://localhost:3000?mode=unsafe",
    "http://localhost:3000#fragment",
    "http://user:password@localhost:3000",
  ])("rejects non-canonical APP_ORIGIN shape %s", (appOrigin) => {
    expect(() =>
      loadEnv(Phase2EnvSchema, { ...validPhase2Env, APP_ORIGIN: appOrigin }),
    ).toThrow("APP_ORIGIN");
  });

  it("rejects __Host cookies without Secure and accepts the documented local cookie mode", () => {
    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        SESSION_COOKIE_NAME: "__Host-session",
        SESSION_COOKIE_SECURE: "false",
      }),
    ).toThrow("SESSION_COOKIE_NAME");

    expect(
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        SESSION_COOKIE_NAME: "pubg-camp-session",
        SESSION_COOKIE_SECURE: "false",
      }),
    ).toMatchObject({
      APP_ORIGIN: "http://localhost:3000",
      SESSION_COOKIE_NAME: "pubg-camp-session",
      SESSION_COOKIE_SECURE: false,
    });
  });

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

  it("redacts every phase-two credential and PII key", () => {
    const sensitive = {
      oauth_state: "state-value",
      authorization_code: "code-value",
      otp: "12345678",
      invitation_context: "invite-value",
      recipient_email: "person@example.com",
      authorization: "Bearer value",
      cookie: "session=value",
      ciphertext: "encrypted-value",
      discord_provider_token: "provider-value",
    };

    expect(Object.values(redactConfig(sensitive))).toEqual(
      Array(Object.keys(sensitive).length).fill("[REDACTED]"),
    );
  });

  it("boots with required PKCE by default and forbids an exception ID", () => {
    const env = loadEnv(Phase2EnvSchema, validPhase2Env);
    expect(env.DISCORD_PKCE_MODE).toBe("required");

    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        DISCORD_PKCE_MODE: "required",
        DISCORD_PKCE_EXCEPTION_ID: "SEC-2026-001",
      }),
    ).toThrow("DISCORD_PKCE_EXCEPTION_ID");
  });

  it("requires a nonblank exception ID only in documented-exception mode", () => {
    for (const exceptionId of [undefined, "", "   "]) {
      expect(() =>
        loadEnv(Phase2EnvSchema, {
          ...validPhase2Env,
          DISCORD_PKCE_MODE: "documented-exception",
          DISCORD_PKCE_EXCEPTION_ID: exceptionId,
        }),
      ).toThrow("DISCORD_PKCE_EXCEPTION_ID");
    }

    const env = loadEnv(Phase2EnvSchema, {
      ...validPhase2Env,
      DISCORD_PKCE_MODE: "documented-exception",
      DISCORD_PKCE_EXCEPTION_ID: "SEC-2026-001",
    });
    const warnings = getSecurityWarnings(env);

    expect(warnings).toEqual(["Discord PKCE documented exception is active."]);
    expect(JSON.stringify(warnings)).not.toContain("SEC-2026-001");
  });

  it("rejects unknown PKCE modes without leaking the supplied value", () => {
    const invalidMode = "disabled-with-secret-value";
    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        DISCORD_PKCE_MODE: invalidMode,
      }),
    ).toThrow("DISCORD_PKCE_MODE");
    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        DISCORD_PKCE_MODE: invalidMode,
      }),
    ).not.toThrow(invalidMode);
  });

  it("fails closed on weak or reused secrets and reports field names only", () => {
    const weakSecret = "replace-with-production-secret-value";
    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        OTP_PEPPER: weakSecret,
      }),
    ).toThrow("OTP_PEPPER");
    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        OTP_PEPPER: weakSecret,
      }),
    ).not.toThrow(weakSecret);

    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        OTP_PEPPER: validPhase2Env.CSRF_SECRET,
      }),
    ).toThrow("OTP_PEPPER");
  });

  it("requires HTTPS origins and Secure cookies in production", () => {
    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        NODE_ENV: "production",
        SESSION_COOKIE_SECURE: "false",
      }),
    ).toThrow("SESSION_COOKIE_SECURE");

    expect(() =>
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        NODE_ENV: "production",
        APP_ORIGIN: "http://camp.example.com",
        DISCORD_REDIRECT_URI: "http://camp.example.com/entrar/discord/retorno",
        SESSION_COOKIE_SECURE: "true",
      }),
    ).toThrow("APP_ORIGIN");

    expect(
      loadEnv(Phase2EnvSchema, {
        ...validPhase2Env,
        NODE_ENV: "production",
        APP_ORIGIN: "https://camp.example.com",
        DISCORD_REDIRECT_URI: "https://camp.example.com/entrar/discord/retorno",
        SESSION_COOKIE_SECURE: "true",
      }).NODE_ENV,
    ).toBe("production");
  });
});
