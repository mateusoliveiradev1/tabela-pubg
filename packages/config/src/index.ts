import { z } from "zod";

export const LogLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE_NAME: z.string().min(1),
  LOG_LEVEL: LogLevelSchema.default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;

const weakSecretPattern = /(change|example|local|password|replace|secret|test)/i;

function strongSecret(fieldName: string): z.ZodString {
  return z
    .string()
    .min(32, `${fieldName} must have at least 32 characters`)
    .max(512)
    .refine((value) => !weakSecretPattern.test(value), `${fieldName} is not strong enough`);
}

const OptionalExceptionIdSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).max(120).optional(),
);

const StringBooleanSchema = z.enum(["true", "false"]).transform((value) => value === "true");

const CanonicalOriginSchema = z.url().transform((value, context) => {
  const parsed = new URL(value);
  if (
    value !== parsed.origin ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    context.addIssue({
      code: "custom",
      message: "APP_ORIGIN must be a canonical origin without trailing slash or URL components",
    });
    return z.NEVER;
  }
  return parsed.origin;
});

export const DiscordPkceModeSchema = z
  .enum(["required", "documented-exception"])
  .default("required");

export const Phase2EnvSchema = BaseEnvSchema.extend({
  APP_ORIGIN: CanonicalOriginSchema,
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
  DISCORD_CLIENT_SECRET: strongSecret("DISCORD_CLIENT_SECRET"),
  DISCORD_REDIRECT_URI: z.url(),
  DISCORD_PKCE_MODE: DiscordPkceModeSchema,
  DISCORD_PKCE_EXCEPTION_ID: OptionalExceptionIdSchema,
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default("pubg-camp-session"),
  SESSION_COOKIE_SECRET: strongSecret("SESSION_COOKIE_SECRET"),
  SESSION_COOKIE_SECURE: StringBooleanSchema.default(false),
  SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(2_592_000),
  SESSION_ABSOLUTE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3_600)
    .max(7_776_000)
    .default(7_776_000),
  SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  CSRF_SECRET: strongSecret("CSRF_SECRET"),
  OTP_PEPPER: strongSecret("OTP_PEPPER"),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(600),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  OTP_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  AES_GCM_KEY_V1: z.string().regex(/^[a-fA-F0-9]{64}$/),
  ENCRYPTION_KEY_VERSION: z.literal("v1").default("v1"),
  REDIS_URL: z.url(),
  RESEND_API_KEY: strongSecret("RESEND_API_KEY"),
  EMAIL_FROM: z.email().max(254),
  TRUSTED_PROXY: z.enum(["none", "loopback", "private"]).default("none"),
}).superRefine((env, context) => {
  if (env.SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS >= env.SESSION_IDLE_TTL_SECONDS) {
    context.addIssue({
      code: "custom",
      path: ["SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS"],
      message:
        "SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS must be lower than SESSION_IDLE_TTL_SECONDS",
    });
  }

  if (!env.SESSION_COOKIE_SECURE && env.SESSION_COOKIE_NAME.startsWith("__Host-")) {
    context.addIssue({
      code: "custom",
      path: ["SESSION_COOKIE_NAME"],
      message: "__Host- cookies require SESSION_COOKIE_SECURE=true",
    });
  }

  if (env.DISCORD_PKCE_MODE === "documented-exception") {
    if (env.DISCORD_PKCE_EXCEPTION_ID === undefined) {
      context.addIssue({
        code: "custom",
        path: ["DISCORD_PKCE_EXCEPTION_ID"],
        message: "DISCORD_PKCE_EXCEPTION_ID is required for a documented exception",
      });
    }
  } else if (env.DISCORD_PKCE_EXCEPTION_ID !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["DISCORD_PKCE_EXCEPTION_ID"],
      message: "DISCORD_PKCE_EXCEPTION_ID is forbidden when PKCE is required",
    });
  }

  if (env.NODE_ENV === "production") {
    if (!env.APP_ORIGIN.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "APP_ORIGIN must use HTTPS in production",
      });
    }
    if (!env.DISCORD_REDIRECT_URI.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["DISCORD_REDIRECT_URI"],
        message: "DISCORD_REDIRECT_URI must use HTTPS in production",
      });
    }
    if (!env.SESSION_COOKIE_SECURE) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_COOKIE_SECURE"],
        message: "SESSION_COOKIE_SECURE must be true in production",
      });
    }
  }

  const secretFields = [
    "DISCORD_CLIENT_SECRET",
    "SESSION_COOKIE_SECRET",
    "CSRF_SECRET",
    "OTP_PEPPER",
    "AES_GCM_KEY_V1",
    "RESEND_API_KEY",
  ] as const;
  const firstFieldByValue = new Map<string, (typeof secretFields)[number]>();

  for (const field of secretFields) {
    const value = env[field];
    if (firstFieldByValue.has(value)) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} must use a separate value`,
      });
    } else {
      firstFieldByValue.set(value, field);
    }
  }
});

export type Phase2Env = z.infer<typeof Phase2EnvSchema>;

export const secretKeyPattern =
  /(state|code|otp|invitation|email|authorization|cookie|ciphertext|provider.*token|token|secret|password|api[_-]?key)/i;

export function loadEnv<T extends z.ZodType>(
  schema: T,
  input: Record<string, unknown> = process.env,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const fields = result.error.issues.map((issue) => issue.path.join(".") || "environment");
  throw new Error(`Invalid environment configuration: ${[...new Set(fields)].join(", ")}`);
}

export function redactConfig(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      secretKeyPattern.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

export function getSecurityWarnings(env: Phase2Env): readonly string[] {
  return env.DISCORD_PKCE_MODE === "documented-exception"
    ? ["Discord PKCE documented exception is active."]
    : [];
}
