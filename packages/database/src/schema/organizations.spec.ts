import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { invitations, organizationMemberships, organizations } from "../schema.js";

function columnsOf(table: PgTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function uniqueColumnSets(table: PgTable): string[][] {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );
}

function compositeForeignKeysOf(table: PgTable): string[][] {
  return getTableConfig(table).foreignKeys.map((foreignKey) =>
    foreignKey.reference().columns.map((column) => column.name),
  );
}

describe("organization persistence schema", () => {
  it("allows independent memberships per organization", () => {
    expect(uniqueColumnSets(organizationMemberships)).toContainEqual([
      "organization_id",
      "user_id",
    ]);
    expect(uniqueColumnSets(organizationMemberships)).toContainEqual(["organization_id", "id"]);
    expect(columnsOf(organizations)).toEqual(expect.arrayContaining(["id", "slug", "name"]));
  });

  it("stores one-use seven-day invitations with digest and terminal lifecycle", () => {
    expect(columnsOf(invitations)).toEqual(
      expect.arrayContaining([
        "organization_id",
        "invited_by_membership_id",
        "normalized_email",
        "token_digest",
        "organization_role",
        "role_payload",
        "issued_at",
        "expires_at",
        "accepted_at",
        "revoked_at",
        "superseded_at",
      ]),
    );
    expect(columnsOf(invitations)).not.toContain("token");
    expect(uniqueColumnSets(invitations)).toContainEqual(["token_digest"]);
  });

  it("binds invitation actors and accepted memberships to the invitation tenant", () => {
    expect(compositeForeignKeysOf(invitations)).toEqual(
      expect.arrayContaining([
        ["organization_id", "invited_by_membership_id"],
        ["organization_id", "accepted_by_membership_id"],
      ]),
    );
  });
});
