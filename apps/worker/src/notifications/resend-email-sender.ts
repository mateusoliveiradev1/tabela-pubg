import { type ErrorResponse, Resend, type Response as ResendResponse } from "resend";
import type { EmailSender, EmailSendRequest, EmailSendResult } from "./email-sender.js";

export interface ResendEmailSenderOptions {
  apiKey: string;
  from: string;
}

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;
  private readonly from: string;

  constructor(options: ResendEmailSenderOptions) {
    if (!options.apiKey.trim() || !options.from.trim()) {
      throw new Error("Resend adapter requires API key and sender");
    }
    this.client = new RedactedResend(options.apiKey);
    this.from = options.from;
  }

  async send(request: EmailSendRequest): Promise<EmailSendResult> {
    const response = await this.client.emails.send(
      {
        from: this.from,
        to: [request.message.to],
        subject: request.message.subject,
        html: request.message.html,
        text: request.message.text,
      },
      { idempotencyKey: request.idempotencyKey },
    );
    if (response.error) {
      throw new Error(`Resend delivery failed (${response.error.name})`);
    }
    if (!response.data.id) {
      throw new Error("Resend delivery failed (missing_provider_id)");
    }
    return { providerMessageId: response.data.id };
  }
}

const RESEND_ERROR_NAMES = new Set<ErrorResponse["name"]>([
  "invalid_idempotency_key",
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "not_found",
  "method_not_allowed",
  "invalid_idempotent_request",
  "concurrent_idempotent_requests",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_required_field",
  "monthly_quota_exceeded",
  "daily_quota_exceeded",
  "rate_limit_exceeded",
  "security_error",
  "application_error",
  "internal_server_error",
]);

class RedactedResend extends Resend {
  override async fetchRequest<T>(path: string, options = {}): Promise<ResendResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, options as RequestInit);
      const headers = Object.fromEntries(response.headers.entries());
      if (!response.ok) {
        return {
          data: null,
          error: await redactedError(response),
          headers,
        };
      }
      return {
        data: (await response.json()) as T,
        error: null,
        headers,
      };
    } catch {
      return {
        data: null,
        error: {
          name: "application_error",
          statusCode: null,
          message: "Provider request failed",
        },
        headers: null,
      };
    }
  }
}

async function redactedError(response: globalThis.Response): Promise<ErrorResponse> {
  let name: ErrorResponse["name"] = "application_error";
  try {
    const body = (await response.json()) as { name?: unknown };
    if (
      typeof body.name === "string" &&
      RESEND_ERROR_NAMES.has(body.name as ErrorResponse["name"])
    ) {
      name = body.name as ErrorResponse["name"];
    }
  } catch {
    // Provider bodies are deliberately discarded and never logged.
  }
  return {
    name,
    statusCode: response.status,
    message: "Provider request failed",
  };
}
