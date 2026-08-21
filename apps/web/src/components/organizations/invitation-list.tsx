"use client";

import type { InvitationListItem } from "@pubg-camp/contracts";
import { useState } from "react";
import { Button } from "../ui/button";
import { EmptyState, FeedbackState, InlineAlert, RoleBadge, StatusBadge } from "../ui/feedback";
import { Input } from "../ui/input";

interface InvitationListProps {
  organizationId: string;
  invitations: readonly InvitationListItem[];
  capabilities: readonly string[];
  state?: "ready" | "loading" | "error" | "offline" | "permission";
  onAuthoritativeRefresh?: () => void | Promise<void>;
}

type InvitationAction =
  | { kind: "create" }
  | { kind: "revoke" | "resend"; invitation: InvitationListItem };

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function InvitationList({
  organizationId,
  invitations,
  capabilities,
  state = "ready",
  onAuthoritativeRefresh,
}: InvitationListProps) {
  const [tab, setTab] = useState<"active" | "history">("active");
  const [action, setAction] = useState<InvitationAction>();
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const canManage =
    capabilities.includes("invitations:manage") ||
    capabilities.includes("organization:members:manage");

  if (state !== "ready") {
    return <FeedbackState state={state} />;
  }

  const active = invitations.filter((invitation) => invitation.status === "active");
  const history = invitations.filter((invitation) => invitation.status !== "active");
  const visible = tab === "active" ? active : history;

  async function submitAction() {
    if (!action || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const csrf = await acquireCsrf();
      const path =
        action.kind === "create"
          ? `/api/platform/organizations/${organizationId}/invitations`
          : `/api/platform/organizations/${organizationId}/invitations/${action.invitation.id}/${action.kind}`;
      const body =
        action.kind === "create"
          ? { email: email.trim().toLowerCase(), organizationRole: role, assignments: [] }
          : { reason: reason.trim() };
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      await onAuthoritativeRefresh?.();
      setNotice(
        action.kind === "create"
          ? "Convite enviado"
          : action.kind === "resend"
            ? "Novo convite enviado; o anterior foi invalidado"
            : "Convite revogado",
      );
      setAction(undefined);
      setReason("");
      setEmail("");
    } catch {
      setError("Não foi possível concluir esta ação. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="invitation-management" aria-label="Convites da organização">
      <header className="management-summary">
        <p>Uso único · expira em 7 dias · válido apenas para este e-mail</p>
        {canManage && active.length > 0 ? (
          <Button variant="primary" onClick={() => setAction({ kind: "create" })}>
            Convidar membro
          </Button>
        ) : null}
      </header>
      {notice ? <InlineAlert>{notice}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className="ui-tabs-list" role="tablist" aria-label="Estado dos convites">
        <button
          className="ui-tab-trigger"
          type="button"
          role="tab"
          aria-selected={tab === "active"}
          onClick={() => setTab("active")}
        >
          Ativos
        </button>
        <button
          className="ui-tab-trigger"
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
        >
          Histórico
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={tab === "active" ? "Nenhum convite ativo" : "Nenhum convite no histórico"}
          description={
            tab === "active"
              ? "Convide alguém para dividir a operação da organização."
              : "Convites utilizados, expirados e revogados aparecerão aqui."
          }
          action={
            tab === "active" && canManage ? (
              <Button variant="primary" onClick={() => setAction({ kind: "create" })}>
                Convidar membro
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          className="invitation-list"
          role="tabpanel"
          aria-label={tab === "active" ? "Ativos" : "Histórico"}
        >
          {visible.map((invitation) => (
            <article
              className="invitation-card"
              key={invitation.id}
              aria-label={invitation.maskedEmail}
            >
              <header>
                <div>
                  <h2>{invitation.maskedEmail}</h2>
                  <span>Enviado por {invitation.invitedBy}</span>
                </div>
                <StatusBadge tone={invitation.status === "active" ? "accent" : "neutral"}>
                  {statusLabel(invitation.status)}
                </StatusBadge>
              </header>
              <dl>
                <div>
                  <dt>Papel inicial</dt>
                  <dd>
                    <RoleBadge>
                      {invitation.organizationRole === "admin" ? "Administrador" : "Membro"}
                    </RoleBadge>
                  </dd>
                </div>
                <div>
                  <dt>Validade</dt>
                  <dd>{expiryLabel(invitation.expiresAt)}</dd>
                </div>
              </dl>
              {canManage && invitation.status === "active" ? (
                <div className="management-actions">
                  <Button onClick={() => setAction({ kind: "resend", invitation })}>
                    Reenviar convite
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setAction({ kind: "revoke", invitation })}
                  >
                    Revogar convite
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {action ? (
        <div className="ui-dialog-overlay">
          <section
            className="ui-dialog-content invitation-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invitation-action-title"
          >
            <h2 id="invitation-action-title">{actionTitle(action.kind)}</h2>
            <p>{actionDescription(action.kind)}</p>
            {action.kind === "create" ? (
              <>
                <Input
                  label="E-mail do convidado"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <label className="ui-field">
                  <span className="ui-label">Papel inicial</span>
                  <select
                    className="ui-input"
                    value={role}
                    onChange={(event) => setRole(event.target.value as "admin" | "member")}
                  >
                    <option value="member">Membro</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
                <InlineAlert>
                  Uso único · expira em 7 dias · válido apenas para este e-mail
                </InlineAlert>
              </>
            ) : (
              <label className="ui-field">
                <span className="ui-label">Motivo da alteração</span>
                <textarea
                  className="ui-input management-textarea"
                  value={reason}
                  placeholder="Ex.: mudança na equipe de organização"
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            )}
            <div className="ui-dialog-actions">
              <Button disabled={busy} onClick={() => setAction(undefined)}>
                Cancelar
              </Button>
              <Button
                variant={action.kind === "revoke" ? "destructive" : "primary"}
                loading={busy}
                disabled={
                  action.kind === "create"
                    ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                    : reason.trim().length < 8
                }
                onClick={submitAction}
              >
                {action.kind === "create"
                  ? "Enviar convite"
                  : action.kind === "resend"
                    ? "Enviar novo convite"
                    : "Revogar convite"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
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

function statusLabel(status: InvitationListItem["status"]): string {
  if (status === "active") return "Ativo";
  if (status === "accepted") return "Aceito";
  if (status === "expired") return "Expirado";
  return "Revogado";
}

function expiryLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Prazo informado pelo organizador";
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const relative = days > 0 ? `em ${days} dia${days === 1 ? "" : "s"}` : "prazo encerrado";
  return `Expira ${relative} · ${DATE_FORMATTER.format(date)}`;
}

function actionTitle(kind: InvitationAction["kind"]): string {
  if (kind === "create") return "Convidar membro";
  if (kind === "resend") return "Reenviar convite";
  return "Revogar convite";
}

function actionDescription(kind: InvitationAction["kind"]): string {
  if (kind === "create") return "Defina o acesso inicial sem compartilhar links manualmente.";
  if (kind === "resend") return "O novo convite invalida o anterior antes de ser enviado.";
  return "O link atual deixará de funcionar e não poderá ser reutilizado.";
}
