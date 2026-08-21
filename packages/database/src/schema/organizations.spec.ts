import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  invitations,
  organizationLogoAssets,
  organizationMemberships,
  organizations,
  orphanStorageCleanupLedger,
} from "../schema.js";

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
        ["organization_id", "superseded_by_invitation_id"],
      ]),
    );
  });

  it("stores tenant-aware logo metadata without bytes or signed URLs", () => {
    expect(columnsOf(organizationLogoAssets)).toEqual(
      expect.arrayContaining([
        "id",
        "organization_id",
        "object_key",
        "detected_mime",
        "byte_size",
        "sha256",
        "created_by_membership_id",
        "status",
        "activated_at",
      ]),
    );
    expect(columnsOf(organizationLogoAssets)).not.toEqual(
      expect.arrayContaining(["bytes", "signed_url", "url"]),
    );
    expect(uniqueColumnSets(organizationLogoAssets)).toContainEqual(["organization_id", "id"]);
    expect(compositeForeignKeysOf(organizationLogoAssets)).toEqual(
      expect.arrayContaining([["organization_id", "created_by_membership_id"]]),
    );
  });

  it("keeps orphan cleanup independent from organization lifetime", () => {
    expect(columnsOf(orphanStorageCleanupLedger)).toEqual(
      expect.arrayContaining([
        "cleanup_id",
        "provider",
        "object_key",
        "object_key_digest",
        "status",
        "attempts",
        "next_attempt_at",
        "claimed_at",
        "completed_at",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columnsOf(orphanStorageCleanupLedger)).not.toContain("organization_id");
    expect(getTableConfig(orphanStorageCleanupLedger).foreignKeys).toHaveLength(0);
  });
});
