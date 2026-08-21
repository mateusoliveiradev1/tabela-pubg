import { describe, expect, it } from "vitest";
import type { MembershipId } from "./identity.js";
import {
  LastOwnerRemovalError,
  type OrganizationMembership,
  validateOwnerRemoval,
} from "./organizations.js";

const membershipId = (value: string) => value as MembershipId;

describe("last owner invariant", () => {
  const owner: OrganizationMembership = {
    id: membershipId("membership-owner"),
    role: "owner",
    status: "active",
  };

  it("returns a domain error when an operation would remove the last owner", () => {
    const result = validateOwnerRemoval(owner.id, [
      owner,
      {
        id: membershipId("membership-admin"),
        role: "admin",
        status: "active",
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(LastOwnerRemovalError);
      expect(result.error.code).toBe("LAST_OWNER_REMOVAL");
    }
  });

  it("allows removing an owner while another active owner remains", () => {
    const result = validateOwnerRemoval(owner.id, [
      owner,
      {
        id: membershipId("membership-second-owner"),
        role: "owner",
        status: "active",
      },
    ]);

    expect(result).toEqual({ ok: true });
  });

  it("does not treat revoked owners as eligible successors", () => {
    const result = validateOwnerRemoval(owner.id, [
      owner,
      {
        id: membershipId("membership-revoked-owner"),
        role: "owner",
        status: "revoked",
      },
    ]);

    expect(result.ok).toBe(false);
  });

  it("allows removing an active non-owner", () => {
    const admin: OrganizationMembership = {
      id: membershipId("membership-admin"),
      role: "admin",
      status: "active",
    };

    expect(validateOwnerRemoval(admin.id, [owner, admin])).toEqual({ ok: true });
  });
});
