import { OrganizationLogoCleanupJobSchema } from "@pubg-camp/contracts";
import type { OrphanStorageCleanupRow, RetryOrphanCleanupInput } from "@pubg-camp/database";
import { ObjectKeySchema } from "@pubg-camp/storage";

export interface LogoCleanupStore {
  claim(cleanupId: string, now: Date): Promise<OrphanStorageCleanupRow | null>;
  complete(cleanupId: string, now: Date): Promise<boolean>;
  retry(cleanupId: string, input: RetryOrphanCleanupInput): Promise<boolean>;
}

export interface StorageObjectDeleter {
  deleteObject(objectKey: string): Promise<void>;
}

export interface LogoCleanupLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

export interface LogoCleanupProcessorDependencies {
  store: LogoCleanupStore;
  storage: StorageObjectDeleter;
  clock: { now(): Date };
  logger: LogoCleanupLogger;
  retryBaseDelayMs?: number;
}

export type LogoCleanupProcessorResult = { status: "completed" } | { status: "ignored" };

export function createLogoCleanupProcessor(dependencies: LogoCleanupProcessorDependencies) {
  const retryBaseDelayMs = dependencies.retryBaseDelayMs ?? 1_000;
  if (!Number.isInteger(retryBaseDelayMs) || retryBaseDelayMs < 100 || retryBaseDelayMs > 60_000) {
    throw new Error("organization logo cleanup retry delay is invalid");
  }

  return async (job: unknown): Promise<LogoCleanupProcessorResult> => {
    const parsedJob = OrganizationLogoCleanupJobSchema.safeParse(job);
    if (!parsedJob.success) throw new Error("invalid organization logo cleanup job");
    const { cleanupId } = parsedJob.data;
    const now = dependencies.clock.now();
    const claimed = await dependencies.store.claim(cleanupId, now);
    if (!claimed) return { status: "ignored" };

    let objectKey: string;
    try {
      if (claimed.provider !== "s3") throw new Error("unsupported storage provider");
      objectKey = ObjectKeySchema.parse(claimed.objectKey);
      if (!objectKey.startsWith("branding/")) throw new Error("unsupported storage namespace");
    } catch {
      await scheduleRetry(dependencies, claimed, now, "invalid server-side object key");
      dependencies.logger.warn({ cleanupId, outcome: "invalid-ledger" }, "logo cleanup deferred");
      throw new Error("organization logo cleanup storage key is invalid");
    }

    try {
      await dependencies.storage.deleteObject(objectKey);
    } catch (error) {
      if (!isAlreadyMissing(error)) {
        await scheduleRetry(dependencies, claimed, now, "object storage delete failed");
        dependencies.logger.warn({ cleanupId, outcome: "retry" }, "logo cleanup deferred");
        throw new Error("organization logo cleanup failed");
      }
    }

    if (!(await dependencies.store.complete(cleanupId, now))) {
      throw new Error("organization logo cleanup completion was not persisted");
    }
    dependencies.logger.info({ cleanupId, outcome: "completed" }, "logo cleanup completed");
    return { status: "completed" };
  };
}

async function scheduleRetry(
  dependencies: LogoCleanupProcessorDependencies,
  claimed: OrphanStorageCleanupRow,
  now: Date,
  error: string,
): Promise<void> {
  const base = dependencies.retryBaseDelayMs ?? 1_000;
  const delay = Math.min(60_000, base * 2 ** Math.min(claimed.attempts, 10));
  const persisted = await dependencies.store.retry(claimed.cleanupId, {
    now,
    nextAttemptAt: new Date(now.getTime() + delay),
    error,
  });
  if (!persisted) throw new Error("organization logo cleanup retry was not persisted");
}

function isAlreadyMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.code === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}
