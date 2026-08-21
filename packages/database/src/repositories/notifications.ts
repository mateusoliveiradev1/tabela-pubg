import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { EventEnvelope } from "@pubg-camp/contracts";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { appendOutboxEvent } from "../outbox.js";
import type * as databaseSchema from "../schema.js";
import { type NotificationDeliveryRow, notificationDeliveries } from "../schema.js";

export type NotificationRepositoryExecutor = Pick<
  PostgresJsDatabase<typeof databaseSchema>,
  "insert" | "select" | "update"
>;

export interface EncryptionKey {
  version: string;
  key: Uint8Array;
}

function digestRecipient(recipient: string): string {
  return createHash("sha256").update(recipient.trim().toLowerCase(), "utf8").digest("hex");
}

function assertEncryptionKey(key: Uint8Array): void {
  if (key.byteLength !== 32) {
    throw new Error("notification encryption key must be exactly 32 bytes");
  }
}

function deliveryAad(input: {
  id: string;
  template: string;
  recipientDigest: string;
  keyVersion: string;
  payloadExpiresAt: Date;
}): Buffer {
  return Buffer.from(
    JSON.stringify([
      input.id,
      input.template,
      input.recipientDigest,
      input.keyVersion,
      input.payloadExpiresAt.toISOString(),
    ]),
    "utf8",
  );
}

export interface CreateEncryptedNotificationDeliveryInput {
  id: string;
  template: string;
  recipient: string;
  idempotencyKey: string;
  encryptionKey: EncryptionKey;
  payload: Record<string, unknown>;
  payloadExpiresAt: Date;
  availableAt: Date;
  outboxEventId: string;
  occurredAt: Date;
  correlationId?: string;
  causationId?: string;
}

export async function createEncryptedNotificationDelivery(
  executor: NotificationRepositoryExecutor,
  input: CreateEncryptedNotificationDeliveryInput,
): Promise<void> {
  assertEncryptionKey(input.encryptionKey.key);
  const recipientDigest = digestRecipient(input.recipient);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.encryptionKey.key, iv);
  cipher.setAAD(
    deliveryAad({
      id: input.id,
      template: input.template,
      recipientDigest,
      keyVersion: input.encryptionKey.version,
      payloadExpiresAt: input.payloadExpiresAt,
    }),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(input.payload), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  await executor.insert(notificationDeliveries).values({
    id: input.id,
    template: input.template,
    recipientDigest,
    idempotencyKey: input.idempotencyKey,
    encryptionKeyVersion: input.encryptionKey.version,
    payloadIv: iv.toString("base64url"),
    payloadCiphertext: ciphertext.toString("base64url"),
    payloadAuthTag: authTag.toString("base64url"),
    payloadExpiresAt: input.payloadExpiresAt,
    status: "pending",
    attempts: 0,
    availableAt: input.availableAt,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  });

  const event: EventEnvelope = {
    id: input.outboxEventId,
    type: "notification.delivery.requested",
    version: 1,
    occurredAt: input.occurredAt.toISOString(),
    aggregate: { type: "notification-delivery", id: input.id },
    payload: { deliveryId: input.id },
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
  };
  await appendOutboxEvent(executor, event);
}

export async function decryptNotificationPayload<T extends Record<string, unknown>>(
  delivery: NotificationDeliveryRow,
  keys: Record<string, Uint8Array>,
): Promise<T> {
  if (
    delivery.payloadClearedAt ||
    !delivery.encryptionKeyVersion ||
    !delivery.payloadIv ||
    !delivery.payloadCiphertext ||
    !delivery.payloadAuthTag
  ) {
    throw new Error("notification payload is unavailable");
  }

  const key = keys[delivery.encryptionKeyVersion];
  if (!key) {
    throw new Error("notification encryption key version is unavailable");
  }
  assertEncryptionKey(key);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(delivery.payloadIv, "base64url"),
  );
  decipher.setAAD(
    deliveryAad({
      id: delivery.id,
      template: delivery.template,
      recipientDigest: delivery.recipientDigest,
      keyVersion: delivery.encryptionKeyVersion,
      payloadExpiresAt: delivery.payloadExpiresAt,
    }),
  );
  decipher.setAuthTag(Buffer.from(delivery.payloadAuthTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(delivery.payloadCiphertext, "base64url")),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}

export async function clearNotificationPayload(
  executor: NotificationRepositoryExecutor,
  deliveryId: string,
  outcome:
    | { status: "delivered"; at: Date; providerMessageId: string }
    | { status: "expired"; at: Date },
): Promise<boolean> {
  const [cleared] = await executor
    .update(notificationDeliveries)
    .set({
      encryptionKeyVersion: null,
      payloadIv: null,
      payloadCiphertext: null,
      payloadAuthTag: null,
      payloadClearedAt: outcome.at,
      status: outcome.status,
      updatedAt: outcome.at,
      ...(outcome.status === "delivered"
        ? { deliveredAt: outcome.at, providerMessageId: outcome.providerMessageId }
        : { failedAt: outcome.at }),
    })
    .where(
      and(
        eq(notificationDeliveries.id, deliveryId),
        isNull(notificationDeliveries.payloadClearedAt),
      ),
    )
    .returning({ id: notificationDeliveries.id });

  return Boolean(cleared);
}

export async function expireNotificationPayloads(
  executor: NotificationRepositoryExecutor,
  now: Date,
): Promise<number> {
  const expired = await executor
    .update(notificationDeliveries)
    .set({
      encryptionKeyVersion: null,
      payloadIv: null,
      payloadCiphertext: null,
      payloadAuthTag: null,
      payloadClearedAt: now,
      status: "expired",
      failedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        isNull(notificationDeliveries.payloadClearedAt),
        lte(notificationDeliveries.payloadExpiresAt, now),
      ),
    )
    .returning({ id: notificationDeliveries.id });

  return expired.length;
}
