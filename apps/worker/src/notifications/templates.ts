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
  const title = "Seu código temporário";
  const text = [
    "Use este código temporário para continuar:",
    payload.code,
    `Validade: ${expiry}.`,
    "Nunca compartilhe este código. Nossa equipe não pedirá o código por mensagem ou Discord.",
  ].join("\n\n");
  return {
    to: payload.recipient,
    subject: title,
    text,
    html: emailHtml({
      title,
      preheader: "Código de acesso temporário solicitado. Use-o somente na tela que você abriu.",
      transmission: "CREDENCIAL DE ACESSO",
      status: "VALIDAÇÃO PENDENTE",
      timestamp: expiry,
      tone: "operation",
      content: `<p style="Margin:0 0 24px;color:#0b0d0f;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:26px;">Use este código somente na tela de acesso que você já abriu.</p>
        <div class="code-block" aria-label="Código temporário: ${payload.code.split("").join(" ")}" style="Margin:0 0 24px;padding:24px 16px;background:#0b0d0f;border:1px solid #79828c;color:#f4a21d;font-family:'Courier New',Courier,monospace;font-size:40px;font-weight:700;line-height:48px;letter-spacing:8px;text-align:center;user-select:all;">${payload.code}</div>
        ${dataRow("VALIDADE", expiry)}
        ${notice("Nunca compartilhe este código. Nossa equipe não pedirá o código por mensagem ou Discord.")}`,
    }),
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
    html: emailHtml({
      title: "Você foi convocado",
      preheader: `Convite operacional para ${payload.organizationName}. Revise antes de aceitar.`,
      transmission: "CONVITE DE ORGANIZAÇÃO",
      status: "CREDENCIAL PENDENTE",
      timestamp: expiry,
      tone: "operation",
      content: `<p style="Margin:0 0 10px;color:#5c646d;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:18px;text-transform:uppercase;">Organização</p>
        <p style="Margin:0 0 28px;color:#0b0d0f;font-family:'Arial Narrow','Aptos Narrow',Arial,sans-serif;font-size:32px;font-weight:800;line-height:36px;text-transform:uppercase;">${escapeHtml(payload.organizationName)}</p>
        ${dataRow("DESTINATÁRIO", maskedRecipient)}
        ${dataRow("VALIDADE", expiry)}
        ${cta("Revisar convite", invitationUrl, "operation")}
        ${notice("Se você não esperava este convite, ignore esta mensagem. Nenhuma permissão será concedida sem sua confirmação.")}`,
    }),
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
    html: emailHtml({
      title: "Novo acesso detectado",
      preheader: `Revise o acesso de ${device} registrado em ${timestamp}.`,
      transmission: "ALERTA DE SEGURANÇA",
      status: "AÇÃO RECOMENDADA",
      timestamp,
      tone: "security",
      content: `<p style="Margin:0 0 24px;color:#0b0d0f;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:26px;">Um novo dispositivo iniciou uma sessão na sua conta. Confira o manifesto abaixo antes de decidir.</p>
        ${dataRow("DISPOSITIVO", device)}
        ${dataRow("HORÁRIO", timestamp)}
        ${dataRow("LOCAL APROXIMADO", location)}
        <p style="Margin:24px 0 0;color:#0b0d0f;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;">Se foi você, nenhuma ação é necessária. Se não reconhece este acesso, revise a sessão e encerre-a imediatamente.</p>
        ${cta("Revisar e encerrar sessão", reviewUrl, "security")}
        ${notice("Este e-mail nunca pedirá seu código temporário ou credenciais do Discord.")}`,
    }),
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

function dataRow(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid #a9b0b7;">
    <tr>
      <td class="data-label" width="34%" valign="top" style="width:34%;padding:13px 12px 13px 0;color:#5c646d;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;line-height:16px;letter-spacing:1.2px;text-transform:uppercase;">${escapeHtml(label)}</td>
      <td class="data-value" valign="top" style="padding:13px 0;color:#0b0d0f;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:21px;">${escapeHtml(value)}</td>
    </tr>
  </table>`;
}

function notice(copy: string): string {
  return `<p style="Margin:24px 0 0;padding-top:18px;border-top:1px solid #a9b0b7;color:#5c646d;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${escapeHtml(copy)}</p>`;
}

function cta(label: string, href: string, tone: "operation" | "security"): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  const background = tone === "security" ? "#0b0d0f" : "#f4a21d";
  const foreground = tone === "security" ? "#f2eee3" : "#0b0d0f";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:28px 0 0;">
      <!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:52px;v-text-anchor:middle;width:310px;" fillcolor="${background}" strokecolor="${background}"><w:anchorlock/><center style="color:${foreground};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${safeLabel}</center></v:rect><![endif]-->
      <!--[if !mso]><!--><a class="manifest-cta" href="${safeHref}" style="display:inline-block;min-width:246px;padding:16px 24px;background:${background};border:1px solid ${background};color:${foreground};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;line-height:18px;text-align:center;text-decoration:none;text-transform:uppercase;">${safeLabel}</a><!--<![endif]-->
    </td></tr>
    <tr><td style="padding:18px 0 0;color:#5c646d;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;word-break:break-all;"><strong style="color:#0b0d0f;">Ver endereço completo:</strong><br><a href="${safeHref}" style="color:#35404a;text-decoration:underline;text-underline-offset:3px;">${safeHref}</a></td></tr>
  </table>`;
}

interface EmailHtmlInput {
  title: string;
  preheader: string;
  transmission: string;
  status: string;
  timestamp: string;
  tone: "operation" | "security";
  content: string;
}

function emailHtml(input: EmailHtmlInput): string {
  const accent = input.tone === "security" ? "#c64242" : "#f4a21d";
  return `<!doctype html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(input.title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    :root{color-scheme:light dark;supported-color-schemes:light dark}
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0;mso-table-rspace:0}
    table{border-collapse:collapse!important}
    a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
    .preheader{display:none!important;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all}
    @media only screen and (max-width:680px){.manifest{width:100%!important}.edge{padding-left:20px!important;padding-right:20px!important}.title{font-size:38px!important;line-height:40px!important}.data-label,.data-value{display:block!important;width:100%!important;padding-left:0!important}.data-label{padding-bottom:2px!important}.data-value{padding-top:0!important}.manifest-cta{display:block!important;min-width:0!important}.code-block{font-size:32px!important;letter-spacing:5px!important}}
    @media (prefers-color-scheme:dark){.manifest-shell{background:#0b0d0f!important}.manifest-paper{background:#f2eee3!important;color:#0b0d0f!important}.manifest-steel{background:#181c20!important;color:#f2eee3!important}}
  </style>
</head>
<body style="Margin:0;padding:0;background:#0b0d0f;color:#f2eee3;">
<!-- impeccable:design-contract
THESIS: Cada e-mail é um manifesto operacional de campeonato; recusa o card SaaS genérico.
OWN-WORLD: carbono #0b0d0f, marfim #f2eee3, laranja sinal #f4a21d, aço e vermelho apenas para segurança; linhas de medição e retângulos industriais.
STORY: identificar a transmissão, compreender o dado principal e agir com segurança.
FIRST VIEWPORT: faixa PUBG CAMP, título condensado, status e timestamp, dado dominante em alto contraste e ação robusta quando necessária.
FORM: manifesto de suprimentos e credencial de operação; grounded candidate 4; seed ca30eaa3.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
  <div class="preheader" style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(input.preheader)}&#847;&zwnj;&nbsp;&#8199;&#65279;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0d0f" class="manifest-shell" style="width:100%;background:#0b0d0f;border-collapse:collapse;">
    <tr><td align="center" style="padding:28px 12px 40px;">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" class="manifest" style="width:640px;max-width:640px;background:#f2eee3;border-collapse:collapse;">
        <tr>
          <td class="edge" bgcolor="#0b0d0f" style="padding:18px 28px;background:#0b0d0f;border-top:6px solid ${accent};color:#f2eee3;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td valign="middle" style="color:#f2eee3;font-family:'Arial Narrow','Aptos Narrow',Arial,sans-serif;font-size:19px;font-weight:900;line-height:22px;letter-spacing:1.4px;">PUBG CAMP</td>
                <td align="right" valign="middle" style="color:#a9b0b7;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;line-height:15px;letter-spacing:1.1px;text-transform:uppercase;">${escapeHtml(input.transmission)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="edge manifest-steel" bgcolor="#181c20" style="padding:34px 28px 30px;background:#181c20;color:#f2eee3;border-bottom:1px solid #79828c;">
            <h1 class="title" style="Margin:0;color:#f2eee3;font-family:'Arial Narrow','Aptos Narrow','Helvetica Neue Condensed',Arial,sans-serif;font-size:50px;font-weight:900;line-height:51px;letter-spacing:-1px;text-transform:uppercase;">${escapeHtml(input.title)}</h1>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:24px;border-collapse:collapse;">
              <tr><td width="22" style="width:22px;border-top:4px solid ${accent};font-size:0;line-height:0;">&nbsp;</td><td style="border-top:1px solid #79828c;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:14px;border-collapse:collapse;">
              <tr>
                <td valign="top" style="color:${accent};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:800;line-height:18px;letter-spacing:1px;text-transform:uppercase;">${escapeHtml(input.status)}</td>
                <td align="right" valign="top" style="color:#a9b0b7;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;">${escapeHtml(input.timestamp)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="edge manifest-paper" bgcolor="#f2eee3" style="padding:34px 28px 38px;background:#f2eee3;color:#0b0d0f;">
            <div role="article" aria-label="${escapeHtml(input.title)}">${input.content}</div>
          </td>
        </tr>
        <tr>
          <td class="edge" bgcolor="#0b0d0f" style="padding:18px 28px;background:#0b0d0f;color:#a9b0b7;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;">
            Mensagem operacional automática · Não responda com códigos ou credenciais.<br>
            <span style="color:#f2eee3;">PUBG CAMP</span> · operação comunitária de campeonatos
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );
}
