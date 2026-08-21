import type { OrphanStorageCleanupRow } from "@pubg-camp/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLogoCleanupProcessor,
  type LogoCleanupStore,
  type StorageObjectDeleter,
} from "./logo-cleanup.processor.js";

const cleanupId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const objectKey = `branding/${organizationId}/33333333-3333-4333-8333-333333333333`;
const now = new Date("2026-08-21T13:00:00.000Z");

function claimed(overrides: Partial<OrphanStorageCleanupRow> = {}): OrphanStorageCleanupRow {
  return {
    cleanupId,
    provider: "s3",
    objectKey,
    objectKeyDigest: "a".repeat(64),
    status: "claimed",
    attempts: 0,
    nextAttemptAt: now,
    claimedAt: now,
    completedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setup(row: OrphanStorageCleanupRow | null = claimed()) {
  const store: LogoCleanupStore = {
    claim: vi.fn(async () => row),
    complete: vi.fn(async () => true),
    retry: vi.fn(async () => true),
  };
  const storage: StorageObjectDeleter = {
    deleteObject: vi.fn(async () => undefined),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };
  return {
    store,
    storage,
    logger,
    processor: createLogoCleanupProcessor({
      store,
      storage,
      clock: { now: () => now },
      logger,
      retryBaseDelayMs: 1_000,
    }),
  };
}

describe("organization logo cleanup processor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("accepts only cleanupId, resolves the key from the claimed ledger and completes once", async () => {
    const { processor, store, storage, logger } = setup();

    await expect(processor({ cleanupId })).resolves.toEqual({ status: "completed" });

    expect(store.claim).toHaveBeenCalledWith(cleanupId, now);
    expect(storage.deleteObject).toHaveBeenCalledWith(objectKey);
    expect(store.complete).toHaveBeenCalledWith(cleanupId, now);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(objectKey);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(organizationId);
  });

  it("rejects payload fields and invalid ledger keys before touching object storage", async () => {
    const first = setup();
    await expect(
      first.processor({ cleanupId, objectKey: "branding/user-controlled" }),
    ).rejects.toThrow("invalid organization logo cleanup job");
    expect(first.store.claim).not.toHaveBeenCalled();

    const corrupted = setup(claimed({ objectKey: "branding/user-controlled" }));
    await expect(corrupted.processor({ cleanupId })).rejects.toThrow(/key|storage/i);
    expect(corrupted.storage.deleteObject).not.toHaveBeenCalled();
    expect(JSON.stringify(corrupted.logger.warn.mock.calls)).not.toContain("user-controlled");
  });

  it("treats an already-missing object as idempotent success and ignores completed replays", async () => {
    const missing = setup();
    vi.mocked(missing.storage.deleteObject).mockRejectedValueOnce(
      Object.assign(new Error("not found"), {
        name: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(missing.processor({ cleanupId })).resolves.toEqual({ status: "completed" });
    expect(missing.store.complete).toHaveBeenCalledWith(cleanupId, now);

    const replay = setup(null);
    await expect(replay.processor({ cleanupId })).resolves.toEqual({ status: "ignored" });
    expect(replay.storage.deleteObject).not.toHaveBeenCalled();
    expect(replay.store.complete).not.toHaveBeenCalled();
  });

  it("records a bounded failure and exponential nextAttemptAt before rethrowing for BullMQ", async () => {
    const { processor, store, storage, logger } = setup(claimed({ attempts: 2 }));
    vi.mocked(storage.deleteObject).mockRejectedValueOnce(
      new Error(`provider unavailable for ${objectKey}`),
    );

    await expect(processor({ cleanupId })).rejects.toThrow("organization logo cleanup failed");

    expect(store.retry).toHaveBeenCalledWith(cleanupId, {
      now,
      nextAttemptAt: new Date("2026-08-21T13:00:04.000Z"),
      error: "object storage delete failed",
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(objectKey);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(organizationId);
  });

  it("claims, retries and completes a persisted cleanup without duplicating a successful delete", async () => {
    let clockNow = now;
    let ledger = claimed({ status: "pending", claimedAt: null });
    const store: LogoCleanupStore = {
      claim: vi.fn(async (id, at) => {
        if (
          id !== cleanupId ||
          ledger.status === "completed" ||
          ledger.nextAttemptAt.getTime() > at.getTime()
        ) {
          return null;
        }
        ledger = { ...ledger, status: "claimed", claimedAt: at, updatedAt: at };
        return ledger;
      }),
      retry: vi.fn(async (id, input) => {
        if (id !== cleanupId || ledger.status !== "claimed") return false;
        ledger = {
          ...ledger,
          status: "failed",
          attempts: ledger.attempts + 1,
          claimedAt: null,
          nextAttemptAt: input.nextAttemptAt,
          lastError: input.error,
          updatedAt: input.now,
        };
        return true;
      }),
      complete: vi.fn(async (id, at) => {
        if (id !== cleanupId || ledger.status !== "claimed") return false;
        ledger = {
          ...ledger,
          status: "completed",
          attempts: ledger.attempts + 1,
          completedAt: at,
          updatedAt: at,
        };
        return true;
      }),
    };
    const storage: StorageObjectDeleter = {
      deleteObject: vi
        .fn<StorageObjectDeleter["deleteObject"]>()
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockResolvedValue(undefined),
    };
    const processor = createLogoCleanupProcessor({
      store,
      storage,
      clock: { now: () => clockNow },
      logger: { info: vi.fn(), warn: vi.fn() },
      retryBaseDelayMs: 1_000,
    });

    await expect(processor({ cleanupId })).rejects.toThrow("organization logo cleanup failed");
    expect(ledger).toMatchObject({ status: "failed", attempts: 1 });

    clockNow = new Date(now.getTime() + 1_000);
    await expect(processor({ cleanupId })).resolves.toEqual({ status: "completed" });
    await expect(processor({ cleanupId })).resolves.toEqual({ status: "ignored" });
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(ledger).toMatchObject({ status: "completed", attempts: 2 });
  });
});
