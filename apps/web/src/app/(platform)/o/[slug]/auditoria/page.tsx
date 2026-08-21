import { AuditActionSchema, type AuditEventPage, AuditEventPageSchema } from "@pubg-camp/contracts";
import { cookies } from "next/headers";
import { type AuditFilters, AuditTimeline } from "../../../../../components/audit/audit-event";
import { FeedbackState } from "../../../../../components/ui/feedback";
import { loadPlatformOrganizations } from "../../../layout";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type PageResult =
  | { state: "ready"; page: AuditEventPage }
  | { state: "permission" | "error" | "offline" | "session-expired" };

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ slug }, rawSearch] = await Promise.all([params, searchParams]);
  const organizations = await loadPlatformOrganizations();
  if (organizations.state !== "ready") return <PageState state={organizations.state} />;
  const organization = organizations.organizations.find((candidate) => candidate.slug === slug);
  if (!organization) return <PageState state="permission" />;
  const filters = parseFilters(rawSearch);
  const result = await loadAudit(organization.id, filters, positivePage(rawSearch.page));
  if (result.state !== "ready") return <PageState state={result.state} />;

  return (
    <section className="platform-page" aria-labelledby="audit-title">
      <header className="platform-page-header">
        <span className="eyebrow">SEGURANÇA E OPERAÇÃO</span>
        <h1 id="audit-title">Auditoria</h1>
        <p>Revise alterações protegidas em ordem cronológica e com detalhes redigidos.</p>
      </header>
      <AuditTimeline
        organizationSlug={slug}
        visibility={result.page.visibility}
        events={result.page.events}
        page={result.page.page}
        totalPages={result.page.totalPages}
        filters={filters}
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

async function loadAudit(
  organizationId: string,
  filters: AuditFilters,
  page: number,
): Promise<PageResult> {
  const origin = resolveApiOrigin();
  if (!origin) return { state: "error" };
  const query = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (filters.from) query.set("from", `${filters.from.slice(0, 10)}T00:00:00.000Z`);
  if (filters.to) query.set("to", `${filters.to.slice(0, 10)}T23:59:59.999Z`);
  if (filters.actorId && isUuid(filters.actorId)) query.set("actorId", filters.actorId);
  if (filters.action) query.set("action", filters.action);
  if (filters.authorizationScopeId && isUuid(filters.authorizationScopeId)) {
    query.set("authorizationScopeId", filters.authorizationScopeId);
  }
  try {
    const cookieHeader = (await cookies()).toString();
    const response = await fetch(
      new URL(`/platform/organizations/${organizationId}/audit?${query}`, origin),
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
    const parsed = AuditEventPageSchema.safeParse(await response.json());
    return parsed.success ? { state: "ready", page: parsed.data } : { state: "error" };
  } catch {
    return { state: "offline" };
  }
}

function parseFilters(search: SearchParams): AuditFilters {
  const action = AuditActionSchema.safeParse(first(search.action));
  const from = safeDate(first(search.from));
  const to = safeDate(first(search.to));
  const actorId = first(search.actorId);
  const authorizationScopeId = first(search.authorizationScopeId);
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(actorId && actorId.length <= 64 ? { actorId } : {}),
    ...(action.success ? { action: action.data } : {}),
    ...(authorizationScopeId && authorizationScopeId.length <= 64 ? { authorizationScopeId } : {}),
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeDate(value?: string): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function positivePage(value: string | string[] | undefined): number {
  const parsed = Number(first(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
