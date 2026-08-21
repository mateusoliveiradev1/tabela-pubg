export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendRequest {
  message: TransactionalEmail;
  idempotencyKey: string;
}

export interface EmailSendResult {
  providerMessageId: string;
}

export interface EmailSender {
  send(request: EmailSendRequest): Promise<EmailSendResult>;
}
