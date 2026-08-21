import { OrganizationListResponseSchema } from "@pubg-camp/contracts";
import { cookies } from "next/headers";
import { cache, type ReactNode } from "react";
import {
  AppShell,
  type ShellCapability,
  type ShellOrganization,
} from "../../components/layout/app-shell";

export const dynamic = "force-dynamic";

type PlatformLoadResult = {
  state: "ready" | "error" | "offline" | "session-expired";
  organizations: ShellOrganization[];
};

export const loadPlatformOrganizations = cache(async (): Promise<PlatformLoadResult> => {
  const apiOrigin = resolveApiOrigin();
  if (!apiOrigin) return { state: "error", organizations: [] };

  try {
    const cookieHeader = (await cookies()).toString();
    const response = await fetch(new URL("/platform/organizations", apiOrigin), {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return { state: "session-expired", organizations: [] };
    if (!response.ok) return { state: "error", organizations: [] };
    const parsed = OrganizationListResponseSchema.safeParse(await response.json());
    if (!parsed.success) return { state: "error", organizations: [] };
    return {
      state: "ready",
      organizations: parsed.data.organizations.map((organization) => ({
        ...organization,
        capabilities: capabilitiesForRole(organization.membershipRole),
      })),
    };
  } catch {
    return { state: "offline", organizations: [] };
  }
});

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const result = await loadPlatformOrganizations();
  return (
    <AppShell organizations={result.organizations} loadState={result.state}>
      {children}
    </AppShell>
  );
}

function capabilitiesForRole(role: ShellOrganization["membershipRole"]): ShellCapability[] {
  if (role === "owner" || role === "admin") {
    return ["members:view", "members:manage", "audit:view", "organization:settings:manage"];
  }
  return ["members:view", "audit:view:self"];
}

function resolveApiOrigin(): URL | undefined {
  const configured = process.env.API_INTERNAL_ORIGIN;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}
