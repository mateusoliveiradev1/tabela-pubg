import { decryptNotificationPayload, type NotificationDeliveryRow } from "@pubg-camp/database";
import { z } from "zod";
import type { EmailSender } from "./email-sender.js";
import { renderNotificationTemplate } from "./templates.js";

export interface NotificationDeliveryStore {
  findById(deliveryId: string): Promise<NotificationDeliveryRow | undefined>;
  clear(
    deliveryId: string,
    outcome:
      | { status: "delivered"; at: Date; providerMessageId: string }
      | { status: "expired"; at: Date },
  ): Promise<boolean>;
}

export interface NotificationProcessorDependencies {
  store: NotificationDeliveryStore;
  sender: EmailSender;
  encryptionKeys: Readonly<Record<string, Uint8Array>>;
  clock: { now(): Date };
  appBaseUrl: string;
}

const DeliveryJobSchema = z.object({ deliveryId: z.uuid() }).strict();

export type NotificationProcessorResult =
  | { status: "delivered" }
  | { status: "expired" }
  | { status: "ignored" };

async function persistTerminalOutcome(
  store: NotificationDeliveryStore,
  deliveryId: string,
  outcome:
    | { status: "delivered"; at: Date; providerMessageId: string }
    | { status: "expired"; at: Date },
): Promise<"persisted" | "concurrent"> {
  if (await store.clear(deliveryId, outcome)) return "persisted";

  const current = await store.findById(deliveryId);
  if (
    current?.status === outcome.status &&
    current.payloadClearedAt !== null &&
    ((outcome.status === "delivered" && current.deliveredAt !== null) ||
      (outcome.status === "expired" && current.failedAt !== null))
  ) {
    return "concurrent";
  }
  throw new Error("notification terminal outcome was not persisted");
}

export function createNotificationProcessor(dependencies: NotificationProcessorDependencies) {
  return async (job: unknown): Promise<NotificationProcessorResult> => {
    const parsedJob = DeliveryJobSchema.safeParse(job);
    if (!parsedJob.success) {
      throw new Error("invalid notification delivery job");
    }

    const { deliveryId } = parsedJob.data;
    const delivery = await dependencies.store.findById(deliveryId);
    if (
      delivery === undefined ||
      delivery.payloadClearedAt !== null ||
      delivery.status === "delivered" ||
      delivery.status === "expired"
    ) {
      return { status: "ignored" };
    }

    const now = dependencies.clock.now();
    if (delivery.payloadExpiresAt.getTime() <= now.getTime()) {
      const outcome = await persistTerminalOutcome(dependencies.store, deliveryId, {
        status: "expired",
        at: now,
      });
      return outcome === "persisted" ? { status: "expired" } : { status: "ignored" };
    }
    if (delivery.availableAt.getTime() > now.getTime()) {
      return { status: "ignored" };
    }

    const payload = await decryptNotificationPayload<Record<string, unknown>>(
      delivery,
      dependencies.encryptionKeys,
    );
    const message = renderNotificationTemplate({
      template: delivery.template,
      payload,
      createdAt: delivery.createdAt,
      appBaseUrl: dependencies.appBaseUrl,
    });
    const result = await dependencies.sender.send({
      message,
      idempotencyKey: delivery.idempotencyKey,
    });
    const outcome = await persistTerminalOutcome(dependencies.store, deliveryId, {
      status: "delivered",
      at: now,
      providerMessageId: result.providerMessageId,
    });
    return outcome === "persisted" ? { status: "delivered" } : { status: "ignored" };
  };
}
