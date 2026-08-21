import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const notificationDeliveryStatus = pgEnum("notification_delivery_status", [
  "pending",
  "sending",
  "delivered",
  "failed",
  "expired",
]);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey(),
    template: text("template").notNull(),
    recipientDigest: text("recipient_digest").notNull(),
    idempotencyKey: text("idempotency_key")
      .notNull()
      .unique("notification_deliveries_idempotency_key_unique"),
    encryptionKeyVersion: text("encryption_key_version"),
    payloadIv: text("payload_iv"),
    payloadCiphertext: text("payload_ciphertext"),
    payloadAuthTag: text("payload_auth_tag"),
    payloadExpiresAt: timestamptz("payload_expires_at").notNull(),
    payloadClearedAt: timestamptz("payload_cleared_at"),
    status: notificationDeliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamptz("available_at").notNull(),
    deliveredAt: timestamptz("delivered_at"),
    failedAt: timestamptz("failed_at"),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("notification_deliveries_status_available_idx").on(table.status, table.availableAt),
    index("notification_deliveries_payload_expiry_idx").on(table.payloadExpiresAt),
    index("notification_deliveries_recipient_idx").on(table.recipientDigest, table.createdAt),
    check("notification_deliveries_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "notification_deliveries_envelope_state_check",
      sql`(${table.payloadClearedAt} is null and num_nonnulls(${table.encryptionKeyVersion}, ${table.payloadIv}, ${table.payloadCiphertext}, ${table.payloadAuthTag}) = 4) or (${table.payloadClearedAt} is not null and num_nonnulls(${table.encryptionKeyVersion}, ${table.payloadIv}, ${table.payloadCiphertext}, ${table.payloadAuthTag}) = 0)`,
    ),
  ],
);

export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDeliveryRow = typeof notificationDeliveries.$inferInsert;
