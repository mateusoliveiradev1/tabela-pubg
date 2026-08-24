import type {
  ClaimOutboxBatchInput,
  MarkOutboxPublishedInput,
  OutboxEventRow,
  RetryOutboxEventInput,
} from "@pubg-camp/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboxPublisher, type OutboxPublisherStore, type OutboxQueueAdd } from "./publisher.js";

const now = new Date("2026-08-24T10:00:00.000Z");
const eventId = "11111111-1111-4111-8111-111111111111";
const deliveryId = "22222222-2222-4222-8222-222222222222";
const cleanupId = "33333333-3333-4333-8333-333333333333";

function event(
  overrides: Partial<OutboxEventRow> & Pick<OutboxEventRow, "eventType" | "payload">,
): OutboxEventRow {
  return {
    id: eventId,
    eventType: overrides.eventType,
    eventVersion: 1,
    aggregateType: "notification-delivery",
    aggregateId: deliveryId,
    payload: overrides.payload,
    correlationId: null,
    causationId: null,
    status: "publishing",
    attempts: 1,
    availableAt: now,
    occurredAt: now,
    publishedAt: null,
    claimToken: "claim-token",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    lastError: null,
    createdAt: now,
    ...overrides,
  };
}

function setup(claims: readonly OutboxEventRow[][]) {
  const pendingClaims = [...claims];
  const store: OutboxPublisherStore = {
    claimBatch: vi.fn(async (_input: ClaimOutboxBatchInput) => pendingClaims.shift() ?? []),
    markPublished: vi.fn(async (_input: MarkOutboxPublishedInput) => true),
    retry: vi.fn(async (_input: RetryOutboxEventInput) => true),
  };
  const notificationAdd = vi.fn<OutboxQueueAdd<{ deliveryId: string }>>(async () => ({}));
  const cleanupAdd = vi.fn<OutboxQueueAdd<{ cleanupId: string }>>(async () => ({}));
  const logger = { info: vi.fn(), warn: vi.fn() };
  const publisher = new OutboxPublisher({
    store,
    notificationAdd,
    cleanupAdd,
    clock: { now: () => now },
    claimToken: () => "claim-token",
    logger,
    pollIntervalMs: 1,
  });
  return { publisher, store, notificationAdd, cleanupAdd, logger };
}

describe("outbox publisher", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("maps supported events to UUID-only jobs and marks them with the current claim", async () => {
    const notification = event({
      eventType: "notification.delivery.requested",
      payload: { deliveryId },
    });
    const cleanup = event({
      id: "44444444-4444-4444-8444-444444444444",
      eventType: "storage.logo.cleanup",
      aggregateType: "storage-cleanup",
      aggregateId: cleanupId,
      payload: { cleanupId },
    });
    const { publisher, store, notificationAdd, cleanupAdd } = setup([[notification, cleanup]]);

    await expect(publisher.runOnce()).resolves.toEqual({ claimed: 2, published: 2, retried: 0 });

    expect(notificationAdd).toHaveBeenCalledWith({ deliveryId }, { jobId: notification.id });
    expect(cleanupAdd).toHaveBeenCalledWith({ cleanupId }, { jobId: cleanup.id });
    expect(store.markPublished).toHaveBeenNthCalledWith(1, {
      eventId: notification.id,
      claimToken: "claim-token",
      publishedAt: now,
    });
    expect(store.markPublished).toHaveBeenNthCalledWith(2, {
      eventId: cleanup.id,
      claimToken: "claim-token",
      publishedAt: now,
    });
  });

  it.each([
    ["unknown type", { eventType: "invitation.created", payload: { deliveryId } }],
    [
      "unknown version",
      { eventType: "notification.delivery.requested", eventVersion: 2, payload: { deliveryId } },
    ],
    [
      "extra payload field",
      {
        eventType: "notification.delivery.requested",
        payload: { deliveryId, recipient: "secret@example.com" },
      },
    ],
    [
      "invalid UUID",
      { eventType: "storage.logo.cleanup", payload: { cleanupId: "branding/private/logo.png" } },
    ],
  ])("rejects %s before queue access with a stable retry code", async (_name, overrides) => {
    const invalid = event(
      overrides as Partial<OutboxEventRow> & Pick<OutboxEventRow, "eventType" | "payload">,
    );
    const { publisher, store, notificationAdd, cleanupAdd, logger } = setup([[invalid]]);

    await expect(publisher.runOnce()).resolves.toEqual({ claimed: 1, published: 0, retried: 1 });

    expect(notificationAdd).not.toHaveBeenCalled();
    expect(cleanupAdd).not.toHaveBeenCalled();
    expect(store.markPublished).not.toHaveBeenCalled();
    expect(store.retry).toHaveBeenCalledWith({
      eventId: invalid.id,
      claimToken: "claim-token",
      now,
      errorCode: "outbox_event_invalid",
      baseRetryMs: 1_000,
      maxRetryMs: 60_000,
      maxAttempts: 5,
    });
    const recorded = JSON.stringify([vi.mocked(store.retry).mock.calls, logger.warn.mock.calls]);
    expect(recorded).not.toContain("secret@example.com");
    expect(recorded).not.toContain("branding/private/logo.png");
  });

  it("treats a duplicate BullMQ job response as idempotent publication", async () => {
    const notification = event({
      eventType: "notification.delivery.requested",
      payload: { deliveryId },
    });
    const { publisher, store, notificationAdd } = setup([[notification], [notification]]);
    notificationAdd.mockResolvedValue({ id: notification.id });

    await publisher.runOnce();
    await publisher.runOnce();

    expect(notificationAdd).toHaveBeenCalledTimes(2);
    expect(notificationAdd.mock.calls[1]).toEqual(notificationAdd.mock.calls[0]);
    expect(store.markPublished).toHaveBeenCalledTimes(2);
    expect(store.retry).not.toHaveBeenCalled();
  });

  it("redacts enqueue failures, records retry, and continues the claimed batch", async () => {
    const first = event({
      eventType: "notification.delivery.requested",
      payload: { deliveryId },
    });
    const second = event({
      id: "44444444-4444-4444-8444-444444444444",
      eventType: "storage.logo.cleanup",
      payload: { cleanupId },
    });
    const { publisher, store, notificationAdd, cleanupAdd, logger } = setup([[first, second]]);
    notificationAdd.mockRejectedValueOnce(
      new Error("provider rejected secret@example.com token=12345678 ciphertext=private"),
    );

    await expect(publisher.runOnce()).resolves.toEqual({ claimed: 2, published: 1, retried: 1 });

    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: first.id, errorCode: "outbox_enqueue_failed" }),
    );
    expect(cleanupAdd).toHaveBeenCalledWith({ cleanupId }, { jobId: second.id });
    expect(store.markPublished).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: second.id }),
    );
    const recorded = JSON.stringify([vi.mocked(store.retry).mock.calls, logger.warn.mock.calls]);
    expect(recorded).not.toMatch(/secret@example\.com|12345678|ciphertext=private/);
  });

  it("attempts a stable retry when publication loses its lease", async () => {
    const notification = event({
      eventType: "notification.delivery.requested",
      payload: { deliveryId },
    });
    const { publisher, store } = setup([[notification]]);
    vi.mocked(store.markPublished).mockResolvedValueOnce(false);
    vi.mocked(store.retry).mockResolvedValueOnce(false);

    await expect(publisher.runOnce()).resolves.toEqual({ claimed: 1, published: 0, retried: 0 });

    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: notification.id, errorCode: "outbox_lease_lost" }),
    );
  });

  it("stops before another claim while draining the current bounded batch", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstQueued = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const notification = event({
      eventType: "notification.delivery.requested",
      payload: { deliveryId },
    });
    const cleanup = event({
      id: "44444444-4444-4444-8444-444444444444",
      eventType: "storage.logo.cleanup",
      payload: { cleanupId },
    });
    const { publisher, store, notificationAdd, cleanupAdd } = setup([[notification, cleanup]]);
    notificationAdd.mockImplementationOnce(async () => {
      await firstQueued;
      return {};
    });

    publisher.start();
    await vi.waitFor(() => expect(notificationAdd).toHaveBeenCalledTimes(1));
    const stopped = publisher.stop();
    releaseFirst?.();
    await stopped;

    expect(cleanupAdd).toHaveBeenCalledTimes(1);
    expect(store.markPublished).toHaveBeenCalledTimes(2);
    expect(store.claimBatch).toHaveBeenCalledTimes(1);
  });
});
