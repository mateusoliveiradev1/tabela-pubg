export type OrganizationLogoOriginEnvironment = "development" | "production";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseOrganizationLogoOrigins(
  value: string | undefined,
  environment: OrganizationLogoOriginEnvironment,
): string[] {
  if (!value?.trim()) return [];

  const origins: string[] = [];
  const seen = new Set<string>();
  for (const untrimmedEntry of value.split(",")) {
    const entry = untrimmedEntry.trim();
    const origin = parseOrganizationLogoOrigin(entry, environment);
    if (!seen.has(origin)) {
      seen.add(origin);
      origins.push(origin);
    }
  }
  return origins;
}

export function organizationLogoImageSourceDirective(
  value: string | undefined,
  environment: OrganizationLogoOriginEnvironment,
): string {
  return [
    "img-src",
    "'self'",
    "data:",
    "blob:",
    ...parseOrganizationLogoOrigins(value, environment),
  ].join(" ");
}

function parseOrganizationLogoOrigin(
  entry: string,
  environment: OrganizationLogoOriginEnvironment,
): string {
  if (!entry) throw invalidOrigin();

  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw invalidOrigin();
  }

  const schemeEnd = entry.indexOf("://");
  const authoritySuffix =
    schemeEnd < 0 ? entry : entry.slice(firstAuthoritySuffix(entry, schemeEnd + 3));
  const isExactOrigin = authoritySuffix === "" || authoritySuffix === "/";
  const isHttps = url.protocol === "https:";
  const isDevelopmentLoopbackHttp =
    environment === "development" && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

  if (
    !isExactOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    entry.includes("*") ||
    (!isHttps && !isDevelopmentLoopbackHttp)
  ) {
    throw invalidOrigin();
  }

  return url.origin;
}

function firstAuthoritySuffix(value: string, authorityStart: number): number {
  const suffixIndex = value.slice(authorityStart).search(/[/?#]/);
  return suffixIndex < 0 ? value.length : authorityStart + suffixIndex;
}

function invalidOrigin(): Error {
  return new Error("Invalid organization logo origin. Expected an exact HTTPS origin.");
}
