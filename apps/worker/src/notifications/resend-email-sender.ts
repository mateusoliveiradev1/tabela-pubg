import type { EmailSender, EmailSendRequest, EmailSendResult } from "./email-sender.js";

export interface ResendEmailSenderOptions {
  apiKey: string;
  from: string;
}

export class ResendEmailSender implements EmailSender {
  constructor(_options: ResendEmailSenderOptions) {}

  async send(_request: EmailSendRequest): Promise<EmailSendResult> {
    throw new Error("Resend adapter is not implemented");
  }
}
