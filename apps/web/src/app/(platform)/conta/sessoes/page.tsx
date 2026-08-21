import {
  SessionAlertContextResponseSchema,
  SessionListResponseSchema,
  type SessionSummary,
} from "@pubg-camp/contracts";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  type SessionAlertStatus,
  SessionsPanel,
} from "../../../../components/identity/device-session-card";
import { FeedbackState } from "../../../../components/ui/feedback";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer" };

const BFF_ALERT_RESOLVE_PATH = "/api/platform/identity/session-alerts/resolve";

type SessionPageState =
  | { state: "ready"; sessions: SessionSummary[] }
  | { state: "error" | "offline" | "session-expired" };

type ResolvedAlert = {
  status: SessionAlertStatus;
  highlightedSessionId: string | null;
};

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const context = typeof query.context === "string" ? query.context : null;
  const cookieHeader = (await cookies()).toString();
  const [sessions, alert] = await Promise.all([
    loadSessions(cookieHeader),
    context ? resolveSessionAlert(cookieHeader, context) : Promise.resolve(emptyAlert()),
  ]);

  if (sessions.state !== "ready") {
    return (
      <section className="platform-page">
        <FeedbackState state={sessions.state} />
      </section>
    );
  }
  return (
    <section className="platform-page" aria-labelledby="sessions-title">
      <header className="platform-page-header">
        <span className="eyebrow">CONTA E SEGURANÇA</span>
        <h1 id="sessions-title">Sessões e dispositivos</h1>
        <p>Revise acessos recentes e encerre somente os dispositivos que você não reconhece.</p>
      </header>
      <SessionsPanel
        sessions={sessions.sessions}
        alertStatus={alert.status}
        highlightedSessionId={alert.highlightedSessionId}
      />
    </section>
  );
}

async function loadSessions(cookieHeader: string): Promise<SessionPageState> {
  const apiOrigin = resolveApiOrigin();
  if (!apiOrigin) return { state: "error" };
  try {
    const response = await fetch(new URL("/identity/sessions", apiOrigin), {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return { state: "session-expired" };
    if (!response.ok) return { state: "error" };
    const payload = (await response.json()) as Record<string, unknown>;
    if (Array.isArray(payload.sessions) && payload.sessions.length === 0) {
      return { state: "ready", sessions: [] };
    }
    const parsed = SessionListResponseSchema.safeParse(payload);
    return parsed.success ? { state: "ready", sessions: parsed.data.sessions } : { state: "error" };
  } catch {
    return { state: "offline" };
  }
}

async function resolveSessionAlert(cookieHeader: string, context: string): Promise<ResolvedAlert> {
  if (context.length < 16 || context.length > 1024)
    return { status: "not-found", highlightedSessionId: null };
  const apiOrigin = resolveApiOrigin();
  if (!apiOrigin) return emptyAlert();
  try {
    const upstreamPath = BFF_ALERT_RESOLVE_PATH.replace("/api/platform", "");
    const url = new URL(upstreamPath, apiOrigin);
    url.searchParams.set("context", context);
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: "not-found", highlightedSessionId: null };
    const payload = (await response.json()) as Record<string, unknown>;
    const parsed = SessionAlertContextResponseSchema.safeParse(payload);
    if (!parsed.success) return { status: "not-found", highlightedSessionId: null };
    const target = payload.sessionId;
    return {
      status: parsed.data.status,
      highlightedSessionId:
        parsed.data.status === "active" && typeof target === "string" && isUuid(target)
          ? target
          : null,
    };
  } catch {
    return { status: "not-found", highlightedSessionId: null };
  }
}

function emptyAlert(): ResolvedAlert {
  return { status: null, highlightedSessionId: null };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
