import { describe, expect, it } from "vitest";
import {
  compilePlatformRouteMatcher,
  materializePlatformRoutePath,
  PlatformRouteInventory,
} from "./platform-route-inventory.js";

const EXPECTED_METHOD_PATHS = [
  "GET identity/identities",
  "GET identity/session-alerts/resolve",
  "GET identity/sessions",
  "GET organizations",
  "GET organizations/:organizationId/audit",
  "GET organizations/:organizationId/invitations",
  "GET organizations/:organizationId/members",
  "GET security/csrf",
  "PATCH organizations/:organizationId/members/:membershipId",
  "POST identity/email/otp/change-email/request",
  "POST identity/email/otp/change-email/verify",
  "POST identity/email/otp/link-email/request",
  "POST identity/email/otp/link-email/verify",
  "POST identity/email/otp/sign-in/request",
  "POST identity/email/otp/sign-in/verify",
  "POST identity/email/otp/step-up/request",
  "POST identity/email/otp/step-up/verify",
  "POST identity/email/otp/verify-provisional-email/request",
  "POST identity/email/otp/verify-provisional-email/verify",
  "POST identity/identities/:identityId/remove",
  "POST identity/identities/link/confirm",
  "POST identity/oauth/discord/link-identity/callback",
  "POST identity/oauth/discord/link-identity/start",
  "POST identity/oauth/discord/sign-in/callback",
  "POST identity/oauth/discord/sign-in/start",
  "POST identity/oauth/discord/step-up/callback",
  "POST identity/oauth/discord/step-up/start",
  "POST identity/sessions/:sessionId/revoke",
  "POST identity/sessions/logout",
  "POST identity/sessions/revoke-others",
  "POST invitations/accept",
  "POST invitations/preview",
  "POST organizations",
  "POST organizations/:organizationId/invitations",
  "POST organizations/:organizationId/invitations/:invitationId/resend",
  "POST organizations/:organizationId/invitations/:invitationId/revoke",
  "POST organizations/:organizationId/members/:membershipId/revoke",
  "POST organizations/:organizationId/ownership/transfer",
  "PUT organizations/:organizationId/logo",
] as const;

describe("PlatformRouteInventory", () => {
  it("enumerates every exact production BFF method/path combination without duplicates", () => {
    const actual = PlatformRouteInventory.map(({ method, path }) => `${method} ${path}`).sort();

    expect(actual).toEqual([...EXPECTED_METHOD_PATHS].sort());
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual.some((route) => route.includes("__e2e"))).toBe(false);
  });

  it("provides a concrete matching sample and canonical upstream path for every route", () => {
    for (const route of PlatformRouteInventory) {
      const match = compilePlatformRouteMatcher(route.path).exec(route.samplePath);

      expect(match, `${route.method} ${route.path}`).not.toBeNull();
      expect(route.bodyLimit).toBeGreaterThan(0);
      expect(route.upstreamPath.startsWith("/")).toBe(true);
      expect(materializePlatformRoutePath(route.upstreamPath, match?.groups ?? {})).toBe(
        route.upstreamSamplePath,
      );
      expect(route.upstreamSamplePath.includes(":"), route.upstreamSamplePath).toBe(false);
    }
  });

  it("requires every tenant path to declare its server-side UUID extractor", () => {
    for (const route of PlatformRouteInventory) {
      if (route.path.includes(":organizationId")) {
        expect(route.tenant, `${route.method} ${route.path}`).toEqual(
          expect.objectContaining({ organizationParam: "organizationId" }),
        );
      } else {
        expect(route.tenant, `${route.method} ${route.path}`).toBeUndefined();
      }
    }
  });
});
