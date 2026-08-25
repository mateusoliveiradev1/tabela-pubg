const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface ResolvedOrganizationContext {
  id: string;
  slug: string;
}

export function trustedOrganizationContext(
  routeSlug: string,
  organization: ResolvedOrganizationContext,
): { "x-organization-id": string } {
  if (!SLUG.test(routeSlug) || organization.slug !== routeSlug || !UUID.test(organization.id)) {
    throw new Error("trusted organization context unavailable");
  }
  return { "x-organization-id": organization.id.toLowerCase() };
}
