import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { notificationDeliveries } from "../schema.js";

describe("notification delivery persistence schema", () => {
  it("stores an expiring versioned AES-GCM envelope without plaintext recipient or payload", () => {
    const columns = getTableConfig(notificationDeliveries).columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "recipient_digest",
        "encryption_key_version",
        "payload_iv",
        "payload_ciphertext",
        "payload_auth_tag",
        "payload_expires_at",
        "payload_cleared_at",
      ]),
    );
    expect(columns).not.toEqual(expect.arrayContaining(["recipient", "payload", "token", "code"]));
  });
});
