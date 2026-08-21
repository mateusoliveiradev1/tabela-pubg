import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { auditEvents } from "../schema.js";

describe("append-only audit persistence", () => {
  it("captures actor, reason, change set, correlation and optional tenant-owned scope", () => {
    const config = getTableConfig(auditEvents);
    const columns = config.columns.map((column) => column.name);
    const compositeForeignKeys = config.foreignKeys.map((foreignKey) =>
      foreignKey.reference().columns.map((column) => column.name),
    );

    expect(columns).toEqual(
      expect.arrayContaining([
        "organization_id",
        "authorization_scope_id",
        "actor_membership_id",
        "action",
        "target_type",
        "target_id",
        "reason",
        "before",
        "after",
        "correlation_id",
        "occurred_at",
      ]),
    );
    expect(compositeForeignKeys).toEqual(
      expect.arrayContaining([
        ["organization_id", "actor_membership_id"],
        ["organization_id", "authorization_scope_id"],
      ]),
    );
  });
});
