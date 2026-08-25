import {
  IdentityListResponseSchema,
  type IdentitySummary,
  type PendingIdentityLink,
} from "@pubg-camp/contracts";
import { cookies } from "next/headers";
import { IdentityCards } from "../../../../components/identity/identity-cards";
import { FeedbackState } from "../../../../components/ui/feedback";

export const dynamic = "force-dynamic";

type IdentityPageState =
  | { state: "ready"; identities: IdentitySummary[]; pendingLink: PendingIdentityLink | null }
  | { state: "error" | "offline" | "session-expired" };

export default async function IdentitiesPage() {
  const result = await loadIdentities();
  if (result.state !== "ready") {
    return (
      <section className="platform-page">
        <FeedbackState state={result.state} />
      </section>
    );
  }
  return (
    <section className="platform-page" aria-labelledby="identities-title">
      <header className="platform-page-header">
        <span className="eyebrow">CONTA E SEGURANÇA</span>
        <h1 id="identities-title">Formas de acesso</h1>
        <p>Revise como você entra na plataforma e confirme cada novo vínculo explicitamente.</p>
      </header>
      <IdentityCards identities={result.identities} pendingLink={result.pendingLink} />
    </section>
  );
}

async function loadIdentities(): Promise<IdentityPageState> {
  const apiOrigin = resolveApiOrigin();
  if (!apiOrigin) return { state: "error" };
  try {
    const cookieHeader = (await cookies()).toString();
    const response = await fetch(new URL("/identity/identities", apiOrigin), {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return { state: "session-expired" };
    if (!response.ok) return { state: "error" };
    const payload = (await response.json()) as Record<string, unknown>;
    const parsed = IdentityListResponseSchema.safeParse(payload);
    if (!parsed.success) return { state: "error" };
    return {
      state: "ready",
      identities: parsed.data.identities,
      pendingLink: parsed.data.pendingLink ?? null,
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
