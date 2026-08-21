import { type InvitationListItem, InvitationListResponseSchema } from "@pubg-camp/contracts";
import { cookies } from "next/headers";
import { InvitationList } from "../../../../../components/organizations/invitation-list";
import { FeedbackState } from "../../../../../components/ui/feedback";
import { loadPlatformOrganizations } from "../../../layout";

export const dynamic = "force-dynamic";

type PageResult =
  | { state: "ready"; invitations: InvitationListItem[] }
  | { state: "permission" | "error" | "offline" | "session-expired" };

export default async function InvitationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organizations = await loadPlatformOrganizations();
  if (organizations.state !== "ready") return <PageState state={organizations.state} />;
  const organization = organizations.organizations.find((candidate) => candidate.slug === slug);
  if (!organization) return <PageState state="permission" />;
  const result = await loadInvitations(organization.id);
  if (result.state !== "ready") return <PageState state={result.state} />;

  return (
    <section className="platform-page" aria-labelledby="invitations-title">
      <header className="platform-page-header">
        <span className="eyebrow">COLABORAÇÃO</span>
        <h1 id="invitations-title">Convites</h1>
        <p>
          Convide pessoas por e-mail e acompanhe cada acesso sem compartilhar links persistentes.
        </p>
      </header>
      <InvitationList
        organizationId={organization.id}
        invitations={result.invitations}
        capabilities={["organization:members:manage"]}
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

async function loadInvitations(organizationId: string): Promise<PageResult> {
  const origin = resolveApiOrigin();
  if (!origin) return { state: "error" };
  try {
    const cookieHeader = (await cookies()).toString();
    const response = await fetch(
      new URL(`/platform/organizations/${organizationId}/invitations`, origin),
      {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 401) return { state: "session-expired" };
    if (response.status === 403 || response.status === 404) return { state: "permission" };
    if (!response.ok) return { state: "error" };
    const parsed = InvitationListResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { state: "ready", invitations: parsed.data.invitations }
      : { state: "error" };
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
