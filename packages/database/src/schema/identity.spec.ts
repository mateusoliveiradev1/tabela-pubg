import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  authChallenges,
  devices,
  identities,
  oauthTransactions,
  sessionAlertContexts,
  sessions,
  users,
  verifiedEmails,
} from "../schema.js";

function columnsOf(table: PgTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function uniqueColumnSets(table: PgTable): string[][] {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );
}

describe("identity persistence schema", () => {
  it("keeps provider subjects and verified normalized emails unique", () => {
    expect(uniqueColumnSets(identities)).toContainEqual(["provider", "provider_subject"]);
    expect(uniqueColumnSets(verifiedEmails)).toContainEqual(["normalized_email"]);
  });

  it("persists only digests for reusable authentication material", () => {
    const credentialTables = [authChallenges, oauthTransactions, sessions, sessionAlertContexts];
    const allColumns = credentialTables.flatMap(columnsOf);

    expect(columnsOf(authChallenges)).toContain("code_digest");
    expect(columnsOf(oauthTransactions)).toEqual(
      expect.arrayContaining(["state_digest", "browser_binding_digest"]),
    );
    expect(columnsOf(sessions)).toContain("token_digest");
    expect(columnsOf(sessionAlertContexts)).toContain("token_digest");
    expect(allColumns).not.toEqual(
      expect.arrayContaining(["code", "token", "state", "browser_binding"]),
    );
  });

  it("models device signals separately from session authentication", () => {
    expect(columnsOf(devices)).toEqual(
      expect.arrayContaining([
        "device_digest",
        "label",
        "browser",
        "operating_system",
        "approximate_location",
        "first_seen_at",
        "last_seen_at",
      ]),
    );
    expect(columnsOf(devices)).not.toContain("token_digest");
    expect(columnsOf(sessions)).toEqual(
      expect.arrayContaining([
        "device_id",
        "issued_at",
        "last_seen_at",
        "idle_expires_at",
        "absolute_expires_at",
        "reauthenticated_at",
        "revoked_at",
        "revocation_reason",
      ]),
    );
  });

  it("binds read-only alert contexts to both user and session lifecycle", () => {
    expect(columnsOf(sessionAlertContexts)).toEqual(
      expect.arrayContaining([
        "user_id",
        "session_id",
        "token_digest",
        "expires_at",
        "resolved_at",
      ]),
    );
    expect(columnsOf(sessionAlertContexts)).not.toEqual(
      expect.arrayContaining(["revoked_at", "revocation_reason", "action"]),
    );
  });

  it("keeps users credential-free", () => {
    expect(columnsOf(users)).not.toEqual(
      expect.arrayContaining(["password", "password_hash", "token", "code"]),
    );
  });
});
