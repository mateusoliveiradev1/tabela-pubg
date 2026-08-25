import { describe, expect, it } from "vitest";
import { trustedOrganizationContext } from "./trusted-organization-context";

const organization = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "arena-alpha",
};

describe("trusted SSR organization context", () => {
  it("rejects missing route context instead of fabricating a tenant", () => {
    expect(() => trustedOrganizationContext("", organization)).toThrow(
      "trusted organization context unavailable",
    );
  });

  it("rejects cross-tenant route and resolved organization context", () => {
    expect(() => trustedOrganizationContext("arena-bravo", organization)).toThrow(
      "trusted organization context unavailable",
    );
  });

  it("attaches only the canonical server-resolved organization identifier", () => {
    expect(
      trustedOrganizationContext("arena-alpha", {
        id: "22222222-2222-4222-8222-222222222222".toUpperCase(),
        slug: "arena-alpha",
      }),
    ).toEqual({ "x-organization-id": organization.id });
  });
});
