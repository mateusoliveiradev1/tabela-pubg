import type { TransactionalEmail } from "./email-sender.js";

export interface RenderNotificationInput {
  template: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  appBaseUrl: string;
}

export function renderNotificationTemplate(_input: RenderNotificationInput): TransactionalEmail {
  throw new Error("notification templates are not implemented");
}
