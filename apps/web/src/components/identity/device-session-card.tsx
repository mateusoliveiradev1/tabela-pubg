"use client";

import type { SessionSummary } from "@pubg-camp/contracts";
import { Clock3, Laptop, LogOut, MapPin, ShieldAlert, ShieldCheck } from "lucide-react";
import { useLayoutEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { InlineAlert, StatusBadge } from "../ui/feedback";

export type SessionAlertStatus = "active" | "revoked" | "expired" | "not-found" | null;

interface SessionsPanelProps {
  sessions: readonly SessionSummary[];
  alertStatus?: SessionAlertStatus;
  highlightedSessionId?: string | null;
  onAuthoritativeChange?: () => void;
}

export function SessionsPanel({
  sessions,
  alertStatus = null,
  highlightedSessionId = null,
  onAuthoritativeChange,
}: SessionsPanelProps) {
  const orderedSessions = useMemo(
    () => [...sessions].sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent)),
    [sessions],
  );
  const [notice, setNotice] = useState("");
  const [revokeOthersError, setRevokeOthersError] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const otherActiveCount = orderedSessions.filter(
    (session) => !session.isCurrent && session.status === "active",
  ).length;

  async function revokeOthers() {
    if (revokingOthers || otherActiveCount === 0) return;
    setRevokingOthers(true);
    setRevokeOthersError(false);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/identity/sessions/revoke-others", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { revokedCount?: unknown };
      const count = typeof payload.revokedCount === "number" ? payload.revokedCount : 0;
      setNotice(`${count} sessões foram encerradas após confirmação do servidor.`);
      onAuthoritativeChange?.();
    } catch {
      setRevokeOthersError(true);
    } finally {
      setRevokingOthers(false);
    }
  }

  if (orderedSessions.length === 0) {
    return (
      <section className="session-consistency-error" role="alert">
        <ShieldAlert aria-hidden="true" size={28} />
        <div>
          <h2>Não foi possível confirmar sua sessão</h2>
          <p>Entre novamente para reconstruir o acesso de forma segura.</p>
          <a className="ui-button ui-button--primary" href="/entrar?retorno=%2Fconta%2Fsessoes">
            Entrar novamente
          </a>
        </div>
      </section>
    );
  }

  return (
    <div className="session-management">
      <AlertUrlCleaner />
      <SessionAlertBanner status={alertStatus} />
      <div className="session-management__actions">
        <p>
          {orderedSessions.length} {orderedSessions.length === 1 ? "dispositivo" : "dispositivos"}
        </p>
        {otherActiveCount > 0 ? (
          <Dialog
            trigger={`Encerrar todas as outras (${otherActiveCount})`}
            title="Encerrar todas as outras sessões"
            description={`Esta ação encerrará ${otherActiveCount} ${otherActiveCount === 1 ? "sessão" : "sessões"} e manterá somente este dispositivo.`}
          >
            <Button
              variant="destructive"
              loading={revokingOthers}
              loadingLabel="Encerrando…"
              onClick={revokeOthers}
            >
              Encerrar todas as outras
            </Button>
            {revokeOthersError ? (
              <InlineAlert tone="danger">Não foi possível encerrar as outras sessões.</InlineAlert>
            ) : null}
          </Dialog>
        ) : null}
      </div>
      {notice ? (
        <div className="session-live-region" aria-live="polite" role="status">
          {notice}
        </div>
      ) : null}
      <div className="session-card-list">
        {orderedSessions.map((session) => (
          <DeviceSessionCard
            key={session.id}
            session={session}
            highlighted={session.id === highlightedSessionId && alertStatus === "active"}
            onAuthoritativeChange={() => {
              setNotice(
                session.isCurrent
                  ? "Você saiu deste dispositivo."
                  : `${session.device.label} foi encerrado após confirmação do servidor.`,
              );
              onAuthoritativeChange?.();
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface DeviceSessionCardProps {
  session: SessionSummary;
  highlighted?: boolean;
  onAuthoritativeChange?: () => void;
}

export function DeviceSessionCard({
  session,
  highlighted = false,
  onAuthoritativeChange,
}: DeviceSessionCardProps) {
  const [ending, setEnding] = useState(false);
  const [failed, setFailed] = useState(false);

  async function endSession() {
    if (ending || session.status !== "active") return;
    setEnding(true);
    setFailed(false);
    try {
      const csrf = await acquireCsrf();
      const path = session.isCurrent
        ? "/api/platform/identity/sessions/logout"
        : `/api/platform/identity/sessions/${encodeURIComponent(session.id)}/revoke`;
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify(session.isCurrent ? {} : { sessionId: session.id }),
      });
      if (!response.ok) throw new Error();
      onAuthoritativeChange?.();
      if (session.isCurrent) window.location.assign("/entrar");
    } catch {
      setFailed(true);
    } finally {
      setEnding(false);
    }
  }

  const title = session.device.label;
  return (
    <article
      className="device-session-card"
      data-session-alert-highlight={highlighted || undefined}
      aria-labelledby={`session-title-${safeDomSuffix(session.id)}`}
    >
      <header>
        <Laptop aria-hidden="true" size={24} />
        <div>
          <h2
            id={`session-title-${safeDomSuffix(session.id)}`}
            tabIndex={highlighted ? -1 : undefined}
          >
            {title}
          </h2>
          <div className="device-session-card__badges">
            {session.isCurrent ? <StatusBadge tone="accent">Este dispositivo</StatusBadge> : null}
            {highlighted ? <StatusBadge tone="accent">Novo acesso</StatusBadge> : null}
            {session.status !== "active" ? (
              <StatusBadge>{statusLabel(session.status)}</StatusBadge>
            ) : null}
          </div>
        </div>
      </header>
      <dl>
        <div>
          <dt>Navegador e sistema</dt>
          <dd>
            {session.device.browser} em {session.device.operatingSystem}
          </dd>
        </div>
        <div>
          <dt>
            <MapPin aria-hidden="true" size={16} /> Localização aproximada
          </dt>
          <dd>{session.approximateLocation ?? "Indisponível"}</dd>
        </div>
        <div>
          <dt>
            <Clock3 aria-hidden="true" size={16} /> Atividade
          </dt>
          <dd>{session.isCurrent ? "Ativo agora" : formatDateTime(session.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Início e expiração</dt>
          <dd>
            {formatDateTime(session.createdAt)} · expira em{" "}
            {formatDateTime(session.absoluteExpiresAt)}
          </dd>
        </div>
      </dl>
      {session.status === "active" ? (
        <Dialog
          trigger={session.isCurrent ? "Sair deste dispositivo" : "Encerrar sessão"}
          title={session.isCurrent ? "Sair deste dispositivo" : `Encerrar ${session.device.label}`}
          description="Este dispositivo perderá o acesso imediatamente após a confirmação do servidor."
        >
          <Button
            variant="destructive"
            loading={ending}
            loadingLabel="Encerrando…"
            onClick={endSession}
          >
            <LogOut aria-hidden="true" size={18} />
            {session.isCurrent ? "Sair agora" : "Encerrar sessão agora"}
          </Button>
          {failed ? (
            <InlineAlert tone="danger">
              Não foi possível encerrar esta sessão. Tente novamente.
            </InlineAlert>
          ) : null}
        </Dialog>
      ) : null}
    </article>
  );
}

function SessionAlertBanner({ status }: { status: SessionAlertStatus }) {
  if (!status) return null;
  if (status === "active") {
    return (
      <div className="session-alert-banner" role="alert">
        <ShieldCheck aria-hidden="true" size={22} />
        <div className="session-alert-banner__content">
          <strong>Revise este dispositivo</strong>
          <span>Nenhuma sessão foi encerrada ao abrir este alerta.</span>
        </div>
      </div>
    );
  }
  const message =
    status === "revoked"
      ? "Esta sessão já foi encerrada."
      : "Não encontramos esta sessão. Ela pode ter expirado ou já ter sido removida.";
  return (
    <div className="session-alert-banner" role="status">
      <ShieldAlert aria-hidden="true" size={22} />
      <span>{message}</span>
    </div>
  );
}

function AlertUrlCleaner() {
  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("context")) {
      url.searchParams.delete("context");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(
        '[data-session-alert-highlight="true"] h2',
      );
      heading?.focus();
    });
  }, []);
  return null;
}

async function acquireCsrf(): Promise<string> {
  const response = await fetch("/api/platform/security/csrf", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const token = response.headers.get("x-csrf-token");
  if (!response.ok || !token) throw new Error();
  return token;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : DATE_TIME_FORMATTER.format(date);
}

function statusLabel(status: SessionSummary["status"]): string {
  if (status === "revoked") return "Encerrada";
  if (status === "expired") return "Expirada";
  return "Ativa";
}

function safeDomSuffix(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "");
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});
