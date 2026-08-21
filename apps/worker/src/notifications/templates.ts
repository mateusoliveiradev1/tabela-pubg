import { z } from "zod";
import type { TransactionalEmail } from "./email-sender.js";

export interface RenderNotificationInput {
  template: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  appBaseUrl: string;
}

const RecipientSchema = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
const OtpPayloadSchema = z
  .object({
    recipient: RecipientSchema,
    code: z.string().regex(/^\d{8}$/),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const InvitationPayloadSchema = z
  .object({
    recipient: RecipientSchema,
    invitationToken: z.string().min(1).max(512),
    organizationName: z.string().trim().min(1).max(120),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const NewDevicePayloadSchema = z
  .object({
    recipient: RecipientSchema,
    alertToken: z.string().min(16).max(512),
    sessionId: z.string().min(1).max(128),
    device: z
      .object({
        label: z.string().trim().min(1).max(120),
        browser: z.string().trim().min(1).max(120),
        operatingSystem: z.string().trim().min(1).max(120),
        approximateLocation: z.string().trim().min(1).max(160).nullable(),
        summarizedUserAgent: z.string().max(256).nullable(),
      })
      .strict(),
  })
  .strict();

export function renderNotificationTemplate(input: RenderNotificationInput): TransactionalEmail {
  const appBaseUrl = normalizedBaseUrl(input.appBaseUrl);
  switch (input.template) {
    case "otp":
      return renderOtp(OtpPayloadSchema.parse(input.payload));
    case "invitation":
      return renderInvitation(InvitationPayloadSchema.parse(input.payload), appBaseUrl);
    case "new-device":
      return renderNewDevice(
        NewDevicePayloadSchema.parse(input.payload),
        input.createdAt,
        appBaseUrl,
      );
    default:
      throw new Error("unsupported notification template");
  }
}

function renderOtp(payload: z.infer<typeof OtpPayloadSchema>): TransactionalEmail {
  const expiry = formatTimestamp(new Date(payload.expiresAt));
  const text = [
    "Use este código temporário para continuar:",
    payload.code,
    `Validade: ${expiry}.`,
    "Nunca compartilhe este código. Nossa equipe não pedirá o código por mensagem ou Discord.",
  ].join("\n\n");
  return {
    to: payload.recipient,
    subject: "Seu código temporário",
    text,
    html: emailHtml(
      "Seu código temporário",
      `<p>Use este código temporário para continuar:</p><p class="code">${payload.code}</p><p>Validade: ${escapeHtml(expiry)}.</p><p>Nunca compartilhe este código. Nossa equipe não pedirá o código por mensagem ou Discord.</p>`,
    ),
  };
}

function renderInvitation(
  payload: z.infer<typeof InvitationPayloadSchema>,
  appBaseUrl: string,
): TransactionalEmail {
  const expiry = formatTimestamp(new Date(payload.expiresAt));
  const invitationUrl = `${appBaseUrl}/convites/aceitar#token=${encodeURIComponent(payload.invitationToken)}`;
  const maskedRecipient = maskEmail(payload.recipient);
  const text = [
    `Você recebeu um convite para colaborar em ${payload.organizationName}.`,
    `Este convite só pode ser usado por ${maskedRecipient}.`,
    `Validade: ${expiry}.`,
    `Revisar convite: ${invitationUrl}`,
    "Se você não esperava este convite, ignore este e-mail.",
  ].join("\n\n");
  return {
    to: payload.recipient,
    subject: `Convite para ${payload.organizationName}`,
    text,
    html: emailHtml(
      "Convite para colaborar",
      `<p>Você recebeu um convite para colaborar em <strong>${escapeHtml(payload.organizationName)}</strong>.</p><p>Este convite só pode ser usado por ${escapeHtml(maskedRecipient)}.</p><p>Validade: ${escapeHtml(expiry)}.</p>${cta("Revisar convite", invitationUrl)}<p>Se você não esperava este convite, ignore este e-mail.</p>`,
    ),
  };
}

function renderNewDevice(
  payload: z.infer<typeof NewDevicePayloadSchema>,
  createdAt: Date,
  appBaseUrl: string,
): TransactionalEmail {
  const location = payload.device.approximateLocation ?? "indisponível";
  const device = `${payload.device.browser} em ${payload.device.operatingSystem}`;
  const timestamp = formatTimestamp(createdAt);
  const reviewUrl = `${appBaseUrl}/conta/sessoes?alert=${encodeURIComponent(payload.alertToken)}`;
  const text = [
    "Detectamos um novo acesso à sua conta.",
    `Dispositivo: ${device}`,
    `Horário: ${timestamp}`,
    `Localização aproximada: ${location}`,
    "Se foi você, nenhuma ação é necessária. Se não reconhece este acesso, revise a sessão e encerre-a imediatamente.",
    `Revisar e encerrar sessão: ${reviewUrl}`,
    "Este e-mail nunca pedirá seu código temporário ou credenciais do Discord.",
  ].join("\n\n");
  return {
    to: payload.recipient,
    subject: "Novo acesso à sua conta",
    text,
    html: emailHtml(
      "Detectamos um novo acesso à sua conta",
      `<p>Detectamos um novo acesso à sua conta.</p><div class="details"><p><strong>Dispositivo:</strong> ${escapeHtml(device)}</p><p><strong>Horário:</strong> ${escapeHtml(timestamp)}</p><p><strong>Localização aproximada:</strong> ${escapeHtml(location)}</p></div><p>Se foi você, nenhuma ação é necessária. Se não reconhece este acesso, revise a sessão e encerre-a imediatamente.</p>${cta("Revisar e encerrar sessão", reviewUrl)}<p>Este e-mail nunca pedirá seu código temporário ou credenciais do Discord.</p>`,
    ),
  };
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("APP_ORIGIN must not contain credentials, query, or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

function formatTimestamp(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error("notification timestamp is invalid");
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "long",
    timeZone: "UTC",
  }).format(value);
}

function maskEmail(value: string): string {
  const [local = "", domain = ""] = value.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function cta(label: string, href: string): string {
  return `<p><a class="cta" href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;
}

function emailHtml(title: string, content: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#111827;color:#e5e7eb;font-family:Arial,sans-serif}.card{max-width:600px;margin:24px auto;padding:32px;background:#1f2937;border:1px solid #374151;border-radius:12px}.details{padding:12px 16px;background:#111827;border-left:3px solid #14b8a6}.code{font-size:30px;letter-spacing:6px;font-weight:700}.cta{display:inline-block;padding:12px 18px;border-radius:8px;background:#14b8a6;color:#062c2a;text-decoration:none;font-weight:700}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );
}
