export type PlatformRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type PlatformIdentityPurpose =
  | "sign-in"
  | "link-identity"
  | "step-up"
  | "link-email"
  | "change-email"
  | "verify-provisional-email";

export interface PlatformRouteTenantExtractor {
  organizationParam: string;
  scopeParam?: string;
}

export interface PlatformRouteInventoryEntry {
  method: PlatformRouteMethod;
  path: string;
  samplePath: string;
  upstreamPath: string;
  upstreamSamplePath: string;
  bodyLimit: number;
  csrfRotation: "none" | "reacquire" | "clear";
  referrerPolicy: "default" | "no-referrer";
  tenant?: PlatformRouteTenantExtractor;
  identityPurpose?: PlatformIdentityPurpose;
}

export const PLATFORM_JSON_BODY_LIMIT = 64 * 1024;
export const PLATFORM_MULTIPART_BODY_LIMIT = 2 * 1024 * 1024 + 64 * 1024;

const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CANONICAL_UUID = new RegExp(`^${UUID_SOURCE}$`, "i");
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const IDENTITY_ID = "55555555-5555-4555-8555-555555555555";
const ORGANIZATION_TENANT = Object.freeze({ organizationParam: "organizationId" });

type RouteOptions = {
  samplePath?: string;
  bodyLimit?: number;
  csrfRotation?: PlatformRouteInventoryEntry["csrfRotation"];
  referrerPolicy?: PlatformRouteInventoryEntry["referrerPolicy"];
  tenant?: PlatformRouteTenantExtractor;
  identityPurpose?: PlatformIdentityPurpose;
};

function route(
  upstreamPrefix: "" | "/platform",
  method: PlatformRouteMethod,
  path: string,
  options: RouteOptions = {},
): PlatformRouteInventoryEntry {
  const samplePath = options.samplePath ?? path;
  return Object.freeze({
    method,
    path,
    samplePath,
    upstreamPath: `${upstreamPrefix}/${path}`,
    upstreamSamplePath: `${upstreamPrefix}/${samplePath}`,
    bodyLimit: options.bodyLimit ?? PLATFORM_JSON_BODY_LIMIT,
    csrfRotation: options.csrfRotation ?? "none",
    referrerPolicy: options.referrerPolicy ?? "default",
    ...(options.tenant ? { tenant: options.tenant } : {}),
    ...(options.identityPurpose ? { identityPurpose: options.identityPurpose } : {}),
  });
}

const rootRoute = (
  method: PlatformRouteMethod,
  path: string,
  options?: RouteOptions,
): PlatformRouteInventoryEntry => route("", method, path, options);

const platformRoute = (
  method: PlatformRouteMethod,
  path: string,
  options?: RouteOptions,
): PlatformRouteInventoryEntry => route("/platform", method, path, options);

const oauthPurposes = ["sign-in", "link-identity", "step-up"] as const;
const otpPurposes = [
  "sign-in",
  "link-email",
  "change-email",
  "step-up",
  "verify-provisional-email",
] as const;

export const PlatformRouteInventory: readonly PlatformRouteInventoryEntry[] = Object.freeze([
  rootRoute("GET", "security/csrf"),
  ...oauthPurposes.map((identityPurpose) =>
    rootRoute("POST", `identity/oauth/discord/${identityPurpose}/start`, {
      referrerPolicy: "no-referrer",
      identityPurpose,
    }),
  ),
  rootRoute("POST", "identity/oauth/discord/callback", {
    csrfRotation: "reacquire",
    referrerPolicy: "no-referrer",
  }),
  ...otpPurposes.flatMap((identityPurpose) => [
    rootRoute("POST", `identity/email/otp/${identityPurpose}/request`, {
      referrerPolicy: "no-referrer",
      identityPurpose,
    }),
    rootRoute("POST", `identity/email/otp/${identityPurpose}/verify`, {
      csrfRotation: "reacquire",
      referrerPolicy: "no-referrer",
      identityPurpose,
    }),
  ]),
  rootRoute("GET", "identity/session-alerts/resolve", { referrerPolicy: "no-referrer" }),
  rootRoute("GET", "identity/sessions"),
  rootRoute("POST", "identity/sessions/logout", { csrfRotation: "clear" }),
  rootRoute("POST", "identity/sessions/revoke-others"),
  rootRoute("POST", "identity/sessions/:sessionId/revoke", {
    samplePath: `identity/sessions/${SESSION_ID}/revoke`,
  }),
  rootRoute("GET", "identity/identities"),
  rootRoute("POST", "identity/identities/link/confirm", { csrfRotation: "reacquire" }),
  rootRoute("POST", "identity/identities/:identityId/remove", {
    samplePath: `identity/identities/${IDENTITY_ID}/remove`,
    csrfRotation: "reacquire",
  }),
  platformRoute("GET", "organizations"),
  platformRoute("POST", "organizations", { bodyLimit: PLATFORM_MULTIPART_BODY_LIMIT }),
  platformRoute("GET", "organizations/:organizationId/members", {
    samplePath: `organizations/${ORGANIZATION_ID}/members`,
    tenant: ORGANIZATION_TENANT,
  }),
  platformRoute("PATCH", "organizations/:organizationId/members/:membershipId", {
    samplePath: `organizations/${ORGANIZATION_ID}/members/${MEMBERSHIP_ID}`,
    tenant: ORGANIZATION_TENANT,
  }),
  platformRoute("POST", "organizations/:organizationId/members/:membershipId/revoke", {
    samplePath: `organizations/${ORGANIZATION_ID}/members/${MEMBERSHIP_ID}/revoke`,
    tenant: ORGANIZATION_TENANT,
  }),
  platformRoute("POST", "organizations/:organizationId/ownership/transfer", {
    samplePath: `organizations/${ORGANIZATION_ID}/ownership/transfer`,
    tenant: ORGANIZATION_TENANT,
    csrfRotation: "reacquire",
  }),
  platformRoute("GET", "organizations/:organizationId/invitations", {
    samplePath: `organizations/${ORGANIZATION_ID}/invitations`,
    tenant: ORGANIZATION_TENANT,
    referrerPolicy: "no-referrer",
  }),
  platformRoute("POST", "organizations/:organizationId/invitations", {
    samplePath: `organizations/${ORGANIZATION_ID}/invitations`,
    tenant: ORGANIZATION_TENANT,
    referrerPolicy: "no-referrer",
  }),
  platformRoute("POST", "organizations/:organizationId/invitations/:invitationId/revoke", {
    samplePath: `organizations/${ORGANIZATION_ID}/invitations/${INVITATION_ID}/revoke`,
    tenant: ORGANIZATION_TENANT,
    referrerPolicy: "no-referrer",
  }),
  platformRoute("POST", "organizations/:organizationId/invitations/:invitationId/resend", {
    samplePath: `organizations/${ORGANIZATION_ID}/invitations/${INVITATION_ID}/resend`,
    tenant: ORGANIZATION_TENANT,
    referrerPolicy: "no-referrer",
  }),
  platformRoute("GET", "organizations/:organizationId/audit", {
    samplePath: `organizations/${ORGANIZATION_ID}/audit`,
    tenant: ORGANIZATION_TENANT,
  }),
  platformRoute("PUT", "organizations/:organizationId/logo", {
    samplePath: `organizations/${ORGANIZATION_ID}/logo`,
    bodyLimit: PLATFORM_MULTIPART_BODY_LIMIT,
    tenant: ORGANIZATION_TENANT,
  }),
  platformRoute("POST", "invitations/preview", { referrerPolicy: "no-referrer" }),
  platformRoute("POST", "invitations/accept", { referrerPolicy: "no-referrer" }),
]);

export function compilePlatformRouteMatcher(pathTemplate: string): RegExp {
  if (!pathTemplate || pathTemplate.startsWith("/") || pathTemplate.endsWith("/")) {
    throw new Error("platform route path template must be relative and canonical");
  }

  const source = pathTemplate
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const name = segment.slice(1);
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
          throw new Error("platform route parameter name is invalid");
        }
        return `(?<${name}>${UUID_SOURCE})`;
      }
      if (!/^[a-z0-9-]+$/.test(segment)) {
        throw new Error("platform route literal segment is invalid");
      }
      return segment;
    })
    .join("/");

  return new RegExp(`^${source}$`, "i");
}

export function materializePlatformRoutePath(
  pathTemplate: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  const leadingSlash = pathTemplate.startsWith("/");
  const segments = pathTemplate.split("/").filter(Boolean);
  const path = segments
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const value = params[segment.slice(1)];
      if (!value || !CANONICAL_UUID.test(value)) {
        throw new Error("platform route parameter must be a canonical UUID");
      }
      return value.toLowerCase();
    })
    .join("/");
  return leadingSlash ? `/${path}` : path;
}
