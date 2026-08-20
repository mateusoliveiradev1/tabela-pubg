import pino, { type Logger, type LoggerOptions } from "pino";

const redactPaths = [
  "password",
  "token",
  "authorization",
  "cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.token",
  "*.secret",
];

export interface LoggerFactoryOptions {
  service: string;
  level?: LoggerOptions["level"];
  environment?: string;
}

export function createLogger(options: LoggerFactoryOptions): Logger {
  return pino({
    name: options.service,
    level: options.level ?? "info",
    base: {
      service: options.service,
      environment: options.environment ?? "development",
    },
    redact: {
      paths: redactPaths,
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
