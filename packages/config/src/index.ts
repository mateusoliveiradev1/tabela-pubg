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

export const secretKeyPattern = /(token|secret|password|api[_-]?key|authorization|cookie)/i;

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
