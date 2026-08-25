import { MembershipListResponseSchema } from "@pubg-camp/contracts";
import { cookies } from "next/headers";
import { MemberList } from "../../../../../components/organizations/member-list";
import { FeedbackState } from "../../../../../components/ui/feedback";
import { loadPlatformOrganizations } from "../../../layout";
import { trustedOrganizationContext } from "../../../trusted-organization-context";

export const dynamic = "force-dynamic";

type MembersPageState =
  | {
      state: "ready";
      members: ReturnType<typeof MembershipListResponseSchema.parse>["members"];
      capabilities: string[];
    }
  | { state: "permission" | "error" | "offline" | "session-expired" };

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organizations = await loadPlatformOrganizations();
  if (organizations.state !== "ready") {
    return <PageState state={organizations.state} />;
  }
  const organization = organizations.organizations.find((candidate) => candidate.slug === slug);
  if (!organization) return <PageState state="permission" />;

  const result = await loadMembers(slug, organization);
  if (result.state !== "ready") return <PageState state={result.state} />;
  return (
    <section className="platform-page" aria-labelledby="members-title">
      <header className="platform-page-header">
        <span className="eyebrow">EQUIPE</span>
        <h1 id="members-title">Membros e permissões</h1>
        <p>Gerencie papéis globais e responsabilidades por campeonato com confirmação segura.</p>
      </header>
      <MemberList
        organizationId={organization.id}
        organizationName={organization.name}
        members={result.members}
        capabilities={result.capabilities}
        scopes={[]}
      />
    </section>
  );
}

function PageState({ state }: { state: "permission" | "error" | "offline" | "session-expired" }) {
  return (
    <section className="platform-page">
      <FeedbackState state={state} />
    </section>
  );
}

async function loadMembers(
  routeSlug: string,
  organization: { id: string; slug: string },
): Promise<MembersPageState> {
  const origin = resolveApiOrigin();
  if (!origin) return { state: "error" };
  try {
    const organizationContext = trustedOrganizationContext(routeSlug, organization);
    const cookieHeader = (await cookies()).toString();
    const headers = {
      accept: "application/json",
      ...organizationContext,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    };
    const [membersResponse, managementProbe] = await Promise.all([
      fetch(new URL(`/platform/organizations/${organization.id}/members`, origin), {
        method: "GET",
        cache: "no-store",
        headers,
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(new URL(`/platform/organizations/${organization.id}/invitations`, origin), {
        method: "GET",
        cache: "no-store",
        headers,
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (membersResponse.status === 401) return { state: "session-expired" };
    if (membersResponse.status === 403 || membersResponse.status === 404)
      return { state: "permission" };
    if (!membersResponse.ok) return { state: "error" };
    const parsed = MembershipListResponseSchema.safeParse(await membersResponse.json());
    if (!parsed.success) return { state: "error" };
    return {
      state: "ready",
      members: parsed.data.members,
      capabilities: managementProbe.ok
        ? ["members:view", "members:manage", "invitations:manage"]
        : ["members:view"],
    };
  } catch {
    return { state: "offline" };
  }
}

function resolveApiOrigin(): URL | undefined {
  const configured = process.env.API_INTERNAL_ORIGIN;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
