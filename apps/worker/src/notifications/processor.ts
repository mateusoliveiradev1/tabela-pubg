import type { NotificationDeliveryRow } from "@pubg-camp/database";
import type { EmailSender } from "./email-sender.js";

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

export function createNotificationProcessor(_dependencies: NotificationProcessorDependencies) {
  return async (_job: unknown): Promise<{ status: string }> => {
    throw new Error("notification processor is not implemented");
  };
}
