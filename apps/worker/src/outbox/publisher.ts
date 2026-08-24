import { randomUUID } from "node:crypto";
import type {
  ClaimOutboxBatchInput,
  MarkOutboxPublishedInput,
  OutboxEventRow,
  RetryOutboxEventInput,
} from "@pubg-camp/database";
import { z } from "zod";

const NotificationEventPayloadSchema = z.object({ deliveryId: z.uuid() }).strict();
const CleanupEventPayloadSchema = z.object({ cleanupId: z.uuid() }).strict();
const EventIdSchema = z.uuid();

export interface OutboxPublisherStore {
  claimBatch(input: ClaimOutboxBatchInput): Promise<readonly OutboxEventRow[]>;
  markPublished(input: MarkOutboxPublishedInput): Promise<boolean>;
  retry(input: RetryOutboxEventInput): Promise<boolean>;
}

export type OutboxQueueAdd<TData> = (data: TData, options: { jobId: string }) => Promise<unknown>;

export interface OutboxPublisherLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface OutboxPublisherOptions {
  store: OutboxPublisherStore;
  notificationAdd: OutboxQueueAdd<{ deliveryId: string }>;
  cleanupAdd: OutboxQueueAdd<{ cleanupId: string }>;
  clock?: { now(): Date };
  claimToken?: () => string;
  logger?: OutboxPublisherLogger;
  leaseMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  pollIntervalMs?: number;
}

export interface OutboxPublishRunResult {
  claimed: number;
  published: number;
  retried: number;
}

type MappedEvent =
  | { queue: "notification"; data: { deliveryId: string } }
  | { queue: "cleanup"; data: { cleanupId: string } };

const silentLogger: OutboxPublisherLogger = {
  info: () => undefined,
  warn: () => undefined,
};

function mapEvent(event: OutboxEventRow, expectedClaimToken: string): MappedEvent {
  EventIdSchema.parse(event.id);
  if (
    event.status !== "publishing" ||
    event.claimToken !== expectedClaimToken ||
    event.eventVersion !== 1
  ) {
    throw new Error("invalid outbox event");
  }

  switch (event.eventType) {
    case "notification.delivery.requested":
      return { queue: "notification", data: NotificationEventPayloadSchema.parse(event.payload) };
    case "storage.logo.cleanup":
      return { queue: "cleanup", data: CleanupEventPayloadSchema.parse(event.payload) };
    default:
      throw new Error("unsupported outbox event");
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class OutboxPublisher {
  private readonly store: OutboxPublisherStore;
  private readonly notificationAdd: OutboxQueueAdd<{ deliveryId: string }>;
  private readonly cleanupAdd: OutboxQueueAdd<{ cleanupId: string }>;
  private readonly clock: { now(): Date };
  private readonly claimToken: () => string;
  private readonly logger: OutboxPublisherLogger;
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly pollIntervalMs: number;
  private controller: AbortController | undefined;
  private polling: Promise<void> | undefined;

  constructor(options: OutboxPublisherOptions) {
    this.store = options.store;
    this.notificationAdd = options.notificationAdd;
    this.cleanupAdd = options.cleanupAdd;
    this.clock = options.clock ?? { now: () => new Date() };
    this.claimToken = options.claimToken ?? randomUUID;
    this.logger = options.logger ?? silentLogger;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.batchSize = options.batchSize ?? 25;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.retryMaxMs = options.retryMaxMs ?? 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  async runOnce(signal?: AbortSignal): Promise<OutboxPublishRunResult> {
    if (signal?.aborted) return { claimed: 0, published: 0, retried: 0 };

    const claimToken = this.claimToken();
    const events = await this.store.claimBatch({
      now: this.clock.now(),
      claimToken,
      leaseMs: this.leaseMs,
      batchSize: this.batchSize,
      maxAttempts: this.maxAttempts,
    });
    let published = 0;
    let retried = 0;

    // Once claimed, the bounded batch is drained even when shutdown is requested.
    for (const event of events) {
      const outcome = await this.publishClaimedEvent(event, claimToken);
      published += outcome === "published" ? 1 : 0;
      retried += outcome === "retried" ? 1 : 0;
    }

    return { claimed: events.length, published, retried };
  }

  start(): void {
    if (this.polling) return;
    this.controller = new AbortController();
    this.polling = this.poll(this.controller.signal);
  }

  async stop(): Promise<void> {
    const polling = this.polling;
    if (!polling) return;
    this.controller?.abort();
    await polling;
    this.polling = undefined;
    this.controller = undefined;
  }

  private async poll(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.runOnce(signal);
      } catch {
        this.logger.warn(
          { event: "outbox_publisher_claim_failed", errorCode: "outbox_claim_failed" },
          "outbox publisher claim failed",
        );
      }
      if (!signal.aborted) await abortableDelay(this.pollIntervalMs, signal);
    }
  }

  private async publishClaimedEvent(
    event: OutboxEventRow,
    claimToken: string,
  ): Promise<"published" | "retried" | "lease-lost"> {
    let mapped: MappedEvent;
    try {
      mapped = mapEvent(event, claimToken);
    } catch {
      return this.retryEvent(event.id, claimToken, "outbox_event_invalid");
    }

    try {
      if (mapped.queue === "notification") {
        await this.notificationAdd(mapped.data, { jobId: event.id });
      } else {
        await this.cleanupAdd(mapped.data, { jobId: event.id });
      }
    } catch {
      return this.retryEvent(event.id, claimToken, "outbox_enqueue_failed");
    }

    try {
      const marked = await this.store.markPublished({
        eventId: event.id,
        claimToken,
        publishedAt: this.clock.now(),
      });
      if (marked) return "published";
      return this.retryEvent(event.id, claimToken, "outbox_lease_lost");
    } catch {
      return this.retryEvent(event.id, claimToken, "outbox_publish_transition_failed");
    }
  }

  private async retryEvent(
    eventId: string,
    claimToken: string,
    errorCode: string,
  ): Promise<"retried" | "lease-lost"> {
    try {
      const retried = await this.store.retry({
        eventId,
        claimToken,
        now: this.clock.now(),
        errorCode,
        baseRetryMs: this.retryBaseMs,
        maxRetryMs: this.retryMaxMs,
        maxAttempts: this.maxAttempts,
      });
      if (retried) {
        this.logger.warn(
          { event: "outbox_publisher_event_retried", errorCode },
          "outbox publisher event scheduled for retry",
        );
        return "retried";
      }
    } catch {
      // A database failure leaves the publishing lease recoverable for a later claim.
    }
    this.logger.warn(
      { event: "outbox_publisher_lease_lost", errorCode: "outbox_lease_lost" },
      "outbox publisher event lease was not updated",
    );
    return "lease-lost";
  }
}
