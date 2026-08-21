import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { NotificationDeliveryRow } from "@pubg-camp/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailSender } from "./email-sender.js";
import { createNotificationProcessor, type NotificationDeliveryStore } from "./processor.js";

const now = new Date("2026-08-21T15:45:12.000Z");
const encryptionKey = randomBytes(32);
const deliveryId = "0d44f8d3-27cf-45ab-a659-34c415c5ac9b";

function encryptedDelivery(input: {
  id?: string;
  template: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  payloadExpiresAt?: Date;
  status?: NotificationDeliveryRow["status"];
  cleared?: boolean;
}): NotificationDeliveryRow {
  const id = input.id ?? deliveryId;
  const recipient = String(input.payload.recipient);
  const recipientDigest = createHash("sha256")
    .update(recipient.trim().toLowerCase(), "utf8")
    .digest("hex");
  const payloadExpiresAt = input.payloadExpiresAt ?? new Date("2026-08-21T16:00:00.000Z");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(
    Buffer.from(
      JSON.stringify([id, input.template, recipientDigest, "v1", payloadExpiresAt.toISOString()]),
      "utf8",
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(input.payload), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const cleared = input.cleared ?? false;

  return {
    id,
    template: input.template,
    recipientDigest,
    idempotencyKey: input.idempotencyKey ?? `notification/${id}`,
    encryptionKeyVersion: cleared ? null : "v1",
    payloadIv: cleared ? null : iv.toString("base64url"),
    payloadCiphertext: cleared ? null : ciphertext.toString("base64url"),
    payloadAuthTag: cleared ? null : authTag.toString("base64url"),
    payloadExpiresAt,
    payloadClearedAt: cleared ? now : null,
    status: input.status ?? "pending",
    attempts: 0,
    availableAt: new Date("2026-08-21T15:44:00.000Z"),
    deliveredAt: input.status === "delivered" ? now : null,
    failedAt: input.status === "expired" ? now : null,
    providerMessageId: input.status === "delivered" ? "email_already" : null,
    lastErrorCode: null,
    createdAt: new Date("2026-08-21T15:45:00.000Z"),
    updatedAt: now,
  };
}

function setup(delivery: NotificationDeliveryRow) {
  const store: NotificationDeliveryStore = {
    findById: vi.fn(async () => delivery),
    clear: vi.fn(async () => true),
  };
  const sender: EmailSender = {
    send: vi.fn(async () => ({ providerMessageId: "email_01" })),
  };
  const processor = createNotificationProcessor({
    store,
    sender,
    encryptionKeys: { v1: encryptionKey },
    clock: { now: () => now },
    appBaseUrl: "https://camp.example.com",
  });
  return { processor, store, sender };
}

describe("notification processor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("accepts a deliveryId-only job, decrypts OTP at send time, and clears it after success", async () => {
    const delivery = encryptedDelivery({
      template: "otp",
      payload: {
        recipient: "Player.One@example.com",
        code: "12345678",
        expiresAt: "2026-08-21T15:55:00.000Z",
      },
    });
    const { processor, store, sender } = setup(delivery);

    await expect(processor({ deliveryId })).resolves.toEqual({ status: "delivered" });
    expect(sender.send).toHaveBeenCalledWith({
      idempotencyKey: `notification/${deliveryId}`,
      message: expect.objectContaining({
        to: "player.one@example.com",
        subject: "Seu código temporário",
        text: expect.stringContaining("12345678"),
      }),
    });
    expect(store.clear).toHaveBeenCalledWith(deliveryId, {
      status: "delivered",
      at: now,
      providerMessageId: "email_01",
    });
    expect(JSON.stringify(await processor({ deliveryId }))).not.toContain("12345678");
  });

  it("rejects jobs with data beyond deliveryId before touching persistence", async () => {
    const { processor, store, sender } = setup(
      encryptedDelivery({
        template: "otp",
        payload: {
          recipient: "player@example.com",
          code: "12345678",
          expiresAt: "2026-08-21T15:55:00.000Z",
        },
      }),
    );

    await expect(processor({ deliveryId, recipient: "leak@example.com" })).rejects.toThrow(
      "invalid notification delivery job",
    );
    expect(store.findById).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it.each([
    ["delivered", true],
    ["expired", true],
  ] as const)("does not resend a %s delivery", async (status, cleared) => {
    const { processor, sender, store } = setup(
      encryptedDelivery({
        template: "otp",
        payload: {
          recipient: "player@example.com",
          code: "12345678",
          expiresAt: "2026-08-21T15:55:00.000Z",
        },
        status,
        cleared,
      }),
    );

    await expect(processor({ deliveryId })).resolves.toEqual({ status: "ignored" });
    expect(sender.send).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it("expires and clears ciphertext without decrypting or sending", async () => {
    const { processor, sender, store } = setup(
      encryptedDelivery({
        template: "otp",
        payload: {
          recipient: "player@example.com",
          code: "12345678",
          expiresAt: "2026-08-21T15:40:00.000Z",
        },
        payloadExpiresAt: new Date("2026-08-21T15:44:59.000Z"),
      }),
    );

    await expect(processor({ deliveryId })).resolves.toEqual({ status: "expired" });
    expect(sender.send).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledWith(deliveryId, { status: "expired", at: now });
  });

  it("preserves the encrypted envelope when the provider fails transiently", async () => {
    const delivery = encryptedDelivery({
      template: "otp",
      payload: {
        recipient: "player@example.com",
        code: "12345678",
        expiresAt: "2026-08-21T15:55:00.000Z",
      },
    });
    const { processor, sender, store } = setup(delivery);
    vi.mocked(sender.send).mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(processor({ deliveryId })).rejects.toThrow("provider unavailable");
    expect(store.clear).not.toHaveBeenCalled();
    expect(delivery.payloadCiphertext).not.toBeNull();
  });

  it("renders the read-only new-device alert without session token or full IP", async () => {
    const { processor, sender } = setup(
      encryptedDelivery({
        template: "new-device",
        payload: {
          recipient: "player@example.com",
          alertToken: "opaque-alert-context",
          sessionId: "internal-session-id",
          device: {
            label: "Notebook",
            browser: "Firefox",
            operatingSystem: "Linux",
            approximateLocation: null,
            summarizedUserAgent: "Firefox on Linux 203.0.113.42",
          },
        },
      }),
    );

    await processor({ deliveryId });
    const request = vi.mocked(sender.send).mock.calls[0]?.[0];
    expect(request?.message.subject).toBe("Novo acesso à sua conta");
    expect(request?.message.text).toContain("Dispositivo: Firefox em Linux");
    expect(request?.message.text).toContain("Localização aproximada: indisponível");
    expect(request?.message.text).toContain("Se não reconhece este acesso");
    expect(request?.message.text).toContain("/conta/sessoes?alert=opaque-alert-context");
    expect(request?.message.text).not.toContain("internal-session-id");
    expect(request?.message.text).not.toContain("203.0.113.42");
  });

  it("keeps invitation token/key stable on retry and uses a new pair for resend", async () => {
    const first = encryptedDelivery({
      template: "invitation",
      idempotencyKey: "invitation/delivery-one",
      payload: {
        recipient: "captain@example.com",
        invitationToken: "token-create",
        organizationName: "Arena Sul",
        expiresAt: "2026-08-28T15:45:00.000Z",
      },
    });
    const firstSetup = setup(first);
    await firstSetup.processor({ deliveryId });
    await firstSetup.processor({ deliveryId });

    const resentId = "769d2478-4a6b-43f4-9a0a-e8edfb20334d";
    const resent = encryptedDelivery({
      id: resentId,
      template: "invitation",
      idempotencyKey: "invitation/delivery-two",
      payload: {
        recipient: "captain@example.com",
        invitationToken: "token-resend",
        organizationName: "Arena Sul",
        expiresAt: "2026-08-29T15:45:00.000Z",
      },
    });
    const resentSetup = setup(resent);
    await resentSetup.processor({ deliveryId: resentId });

    const firstCalls = vi.mocked(firstSetup.sender.send).mock.calls;
    expect(firstCalls).toHaveLength(2);
    expect(firstCalls[0]?.[0].idempotencyKey).toBe("invitation/delivery-one");
    expect(firstCalls[1]?.[0]).toEqual(firstCalls[0]?.[0]);
    expect(firstCalls[0]?.[0].message.text).toContain("token=token-create");
    const resentRequest = vi.mocked(resentSetup.sender.send).mock.calls[0]?.[0];
    expect(resentRequest?.idempotencyKey).toBe("invitation/delivery-two");
    expect(resentRequest?.message.text).toContain("token=token-resend");
    expect(resentRequest).not.toEqual(firstCalls[0]?.[0]);
  });
});
