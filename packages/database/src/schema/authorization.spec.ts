import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { authorizationScopes, roleAssignments } from "../schema.js";

function localForeignKeyColumns(table: PgTable): string[][] {
  return getTableConfig(table).foreignKeys.map((foreignKey) =>
    foreignKey.reference().columns.map((column) => column.name),
  );
}

function uniqueColumnSets(table: PgTable): string[][] {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );
}

describe("tenant-scoped authorization persistence", () => {
  it("gives minimal tournament scopes a stable tenant-owned identity", () => {
    expect(uniqueColumnSets(authorizationScopes)).toContainEqual(["organization_id", "id"]);
    expect(authorizationScopes.kind.enumValues).toEqual(["tournament"]);
  });

  it("proves membership, scope and assigning actor share the assignment tenant", () => {
    expect(localForeignKeyColumns(roleAssignments)).toEqual(
      expect.arrayContaining([
        ["organization_id", "membership_id"],
        ["organization_id", "authorization_scope_id"],
        ["organization_id", "assigned_by_membership_id"],
      ]),
    );
  });
});
