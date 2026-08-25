"use client";

import type { MembershipSummary } from "@pubg-camp/contracts";
import { useEffect, useRef, useState } from "react";
import { ConfirmSensitiveActionDialog } from "../authorization/confirm-sensitive-action-dialog";
import {
  type AuthorizationScopeOption,
  type RoleDraft,
  ScopeRoleEditor,
  updateMembership,
} from "../authorization/scope-role-editor";
import {
  consumeSensitiveActionContinuation,
  type SensitiveActionContinuation,
} from "../authorization/sensitive-action-continuation";
import { Button } from "../ui/button";
import { EmptyState, InlineAlert, RoleBadge, StatusBadge } from "../ui/feedback";

interface MemberListProps {
  organizationId: string;
  organizationName: string;
  members: readonly MembershipSummary[];
  capabilities: readonly string[];
  scopes: readonly AuthorizationScopeOption[];
  onAuthoritativeRefresh?: () => void | Promise<void>;
}

export function MemberList({
  organizationId,
  organizationName,
  members,
  capabilities,
  scopes,
  onAuthoritativeRefresh,
}: MemberListProps) {
  const [editing, setEditing] = useState<MembershipSummary>();
  const [draft, setDraft] = useState<RoleDraft>();
  const [revoking, setRevoking] = useState<MembershipSummary>();
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferName, setTransferName] = useState("");
  const [transferReady, setTransferReady] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [restoredContinuation, setRestoredContinuation] = useState<SensitiveActionContinuation>();
  const continuationChecked = useRef(false);
  const canManage =
    capabilities.includes("members:manage") || capabilities.includes("organization:roles:manage");
  const canInvite =
    capabilities.includes("invitations:manage") ||
    capabilities.includes("members:manage") ||
    capabilities.includes("organization:members:manage");
  const canTransfer =
    capabilities.includes("ownership:transfer") ||
    capabilities.includes("organization:ownership:transfer");
  const ownerCount = members.filter(
    (member) => member.status === "active" && member.organizationRole === "owner",
  ).length;

  useEffect(() => {
    if (continuationChecked.current) return;
    continuationChecked.current = true;
    const restored = consumeSensitiveActionContinuation(sessionStorage, organizationId);
    if (!restored) return;
    if (restored.kind === "membership-role-change") {
      const member = members.find((candidate) => candidate.id === restored.membershipId);
      if (!member) return;
      setEditing(member);
      setDraft(restored.draft);
    } else if (restored.kind === "membership-revocation") {
      const member = members.find((candidate) => candidate.id === restored.membershipId);
      if (!member) return;
      setRevoking(member);
    } else {
      const member = members.find((candidate) => candidate.id === restored.targetMembershipId);
      if (!member || restored.organizationNameConfirmation !== organizationName) return;
      setTransferTargetId(restored.targetMembershipId);
      setTransferName(restored.organizationNameConfirmation);
      setTransferOpen(true);
      setTransferReady(true);
    }
    setRestoredContinuation(restored);
  }, [members, organizationId, organizationName]);

  if (members.length === 0) {
    return (
      <EmptyState
        title="Nenhum membro encontrado"
        description="Convide alguém para dividir a operação da organização."
        action={
          canInvite ? <a href={`/o/${organizationId}/convites`}>Convidar membro</a> : undefined
        }
      />
    );
  }

  async function commitPermissions(reason: string) {
    if (!editing || !draft) return;
    const response = await updateMembership({
      organizationId,
      membershipId: editing.id,
      draft,
      reason,
    });
    if (!response.ok) throw new Error("mutation rejected");
    await refreshAuthoritative();
    setNotice("Permissões atualizadas");
    setDraft(undefined);
    setEditing(undefined);
    setRestoredContinuation(undefined);
  }

  async function commitRevocation(reason: string) {
    if (!revoking) return;
    const response = await sensitiveFetch(
      `/api/platform/organizations/${organizationId}/members/${revoking.id}/revoke`,
      { reason },
    );
    if (!response.ok) throw new Error("mutation rejected");
    await refreshAuthoritative();
    setNotice("Acesso revogado");
    setRevoking(undefined);
    setRestoredContinuation(undefined);
  }

  async function commitTransfer(reason: string) {
    if (!transferTargetId || transferName !== organizationName) return;
    const response = await sensitiveFetch(
      `/api/platform/organizations/${organizationId}/ownership/transfer`,
      {
        targetMembershipId: transferTargetId,
        organizationNameConfirmation: transferName,
        reason,
      },
    );
    if (!response.ok) throw new Error("mutation rejected");
    await refreshAuthoritative();
    setNotice("Propriedade transferida. Encerramos suas outras sessões por segurança.");
    setTransferReady(false);
    setTransferOpen(false);
    setTransferTargetId("");
    setTransferName("");
    setRestoredContinuation(undefined);
  }

  async function refreshAuthoritative() {
    if (onAuthoritativeRefresh) await onAuthoritativeRefresh();
    else window.location.reload();
  }

  return (
    <section className="member-management" aria-label="Membros da organização">
      <header className="management-summary">
        <p>{members.length === 1 ? "1 membro" : `${members.length} membros`}</p>
        {canInvite ? (
          <a className="ui-button ui-button--primary" href={`/o/${organizationId}/convites`}>
            Convidar membro
          </a>
        ) : null}
        {canTransfer ? (
          <Button variant="destructive" onClick={() => setTransferOpen(true)}>
            Transferir propriedade
          </Button>
        ) : null}
      </header>
      {notice ? <InlineAlert>{notice}</InlineAlert> : null}
      <div className="management-table">
        <div className="management-table__header" aria-hidden="true">
          <span>Pessoa</span>
          <span>Papel na organização</span>
          <span>Cargos por campeonato</span>
          <span>Status</span>
          <span>Ações</span>
        </div>
        {members.map((member) => {
          const protectedOwner = member.organizationRole === "owner" && ownerCount === 1;
          return (
            <article
              className="management-table__row"
              aria-label={`${member.user.displayName} — ${roleLabel(member.organizationRole)}`}
              key={member.id}
            >
              <div className="management-person" data-label="Pessoa">
                <strong>{member.user.displayName}</strong>
                {member.user.maskedEmail ? <span>{member.user.maskedEmail}</span> : null}
              </div>
              <div data-label="Papel na organização">
                <RoleBadge tone={member.organizationRole === "owner" ? "accent" : "neutral"}>
                  {roleLabel(member.organizationRole)}
                </RoleBadge>
              </div>
              <div className="management-badges" data-label="Cargos por campeonato">
                {member.assignments.length === 0 ? (
                  <span>Nenhum cargo operacional</span>
                ) : (
                  member.assignments.map((assignment) => (
                    <RoleBadge key={`${assignment.authorizationScopeId}:${assignment.role}`}>
                      {operationalRoleLabel(assignment.role)} — {assignment.scopeName}
                    </RoleBadge>
                  ))
                )}
              </div>
              <div data-label="Status">
                <StatusBadge tone={member.status === "active" ? "accent" : "destructive"}>
                  {member.status === "active" ? "Ativo" : "Revogado"}
                </StatusBadge>
              </div>
              <div className="management-actions" data-label="Ações">
                {canManage ? (
                  <>
                    <Button
                      disabled={protectedOwner}
                      aria-label={`Editar permissões de ${member.user.displayName}`}
                      onClick={() => setEditing(member)}
                    >
                      Editar permissões
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={protectedOwner}
                      aria-label={`Revogar acesso de ${member.user.displayName}`}
                      onClick={() => setRevoking(member)}
                    >
                      Revogar acesso
                    </Button>
                    {protectedOwner ? (
                      <span className="management-rule" role="note">
                        Transfira a propriedade antes de alterar este membro.
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {editing && !draft ? (
        <div className="ui-dialog-overlay">
          <section
            className="ui-dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-editor-title"
          >
            <h2 id="role-editor-title">Editar permissões</h2>
            <p>{editing.user.displayName}</p>
            <ScopeRoleEditor
              member={editing}
              scopes={scopes}
              capabilities={capabilities}
              protectedOwner={editing.organizationRole === "owner" && ownerCount === 1}
              onRequestCommit={setDraft}
            />
            <div className="ui-dialog-actions">
              <Button onClick={() => setEditing(undefined)}>Cancelar</Button>
            </div>
          </section>
        </div>
      ) : null}

      {editing && draft ? (
        <ConfirmSensitiveActionDialog
          impact="As permissões desta pessoa serão alteradas somente depois da confirmação do servidor."
          confirmLabel="Salvar permissões"
          continuation={{
            kind: "membership-role-change",
            organizationId,
            membershipId: editing.id,
            draft,
          }}
          initialReason={
            restoredContinuation?.kind === "membership-role-change" &&
            restoredContinuation.membershipId === editing.id
              ? restoredContinuation.reason
              : undefined
          }
          reauthenticated={
            restoredContinuation?.kind === "membership-role-change" &&
            restoredContinuation.membershipId === editing.id
          }
          onCancel={() => {
            setDraft(undefined);
            setRestoredContinuation(undefined);
          }}
          onCommit={commitPermissions}
        />
      ) : null}
      {revoking ? (
        <ConfirmSensitiveActionDialog
          impact="Esta pessoa perderá o acesso a esta organização, mas continuará conectada às demais."
          confirmLabel="Revogar acesso"
          destructive
          continuation={{
            kind: "membership-revocation",
            organizationId,
            membershipId: revoking.id,
          }}
          initialReason={
            restoredContinuation?.kind === "membership-revocation" &&
            restoredContinuation.membershipId === revoking.id
              ? restoredContinuation.reason
              : undefined
          }
          reauthenticated={
            restoredContinuation?.kind === "membership-revocation" &&
            restoredContinuation.membershipId === revoking.id
          }
          onCancel={() => {
            setRevoking(undefined);
            setRestoredContinuation(undefined);
          }}
          onCommit={commitRevocation}
        />
      ) : null}
      {transferOpen && !transferReady ? (
        <div className="ui-dialog-overlay">
          <section
            className="ui-dialog-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ownership-transfer-title"
          >
            <h2 id="ownership-transfer-title">Transferir propriedade</h2>
            <p>
              Você deixará de ser proprietário. Todas as suas outras sessões serão encerradas;
              somente esta sessão, que você acabou de confirmar, permanecerá conectada.
            </p>
            <label className="ui-field">
              <span className="ui-label">Novo proprietário</span>
              <select
                className="ui-input"
                value={transferTargetId}
                onChange={(event) => setTransferTargetId(event.target.value)}
              >
                <option value="">Selecione um membro elegível</option>
                {members
                  .filter(
                    (member) => member.status === "active" && member.organizationRole !== "owner",
                  )
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.user.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">Digite o nome da organização</span>
              <input
                className="ui-input"
                value={transferName}
                autoComplete="off"
                onChange={(event) => setTransferName(event.target.value)}
              />
            </label>
            <div className="ui-dialog-actions">
              <Button onClick={() => setTransferOpen(false)}>Cancelar</Button>
              <Button
                variant="destructive"
                disabled={!transferTargetId || transferName !== organizationName}
                onClick={() => setTransferReady(true)}
              >
                Revisar transferência
              </Button>
            </div>
          </section>
        </div>
      ) : null}
      {transferOpen && transferReady ? (
        <ConfirmSensitiveActionDialog
          impact="Você deixará de ser proprietário. Todas as suas outras sessões serão encerradas; somente esta sessão reautenticada permanecerá conectada."
          confirmLabel="Transferir propriedade"
          destructive
          continuation={{
            kind: "ownership-transfer",
            organizationId,
            targetMembershipId: transferTargetId,
            organizationNameConfirmation: transferName,
          }}
          initialReason={
            restoredContinuation?.kind === "ownership-transfer"
              ? restoredContinuation.reason
              : undefined
          }
          reauthenticated={restoredContinuation?.kind === "ownership-transfer"}
          onCancel={() => {
            setTransferReady(false);
            setRestoredContinuation(undefined);
          }}
          onCommit={commitTransfer}
        />
      ) : null}
      {scopes.length === 0 ? (
        <p className="management-note">
          Nenhum campeonato disponível para atribuir cargos operacionais.
        </p>
      ) : null}
      <span className="sr-only">Organização atual: {organizationName}</span>
    </section>
  );
}

async function sensitiveFetch(path: string, body: Record<string, unknown>): Promise<Response> {
  const csrfResponse = await fetch("/api/platform/security/csrf", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const csrf = csrfResponse.headers.get("x-csrf-token");
  if (!csrfResponse.ok || !csrf) throw new Error("csrf unavailable");
  return fetch(path, {
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
}

function roleLabel(role: MembershipSummary["organizationRole"]): string {
  if (role === "owner") return "Proprietário";
  if (role === "admin") return "Administrador";
  return "Membro";
}

function operationalRoleLabel(role: MembershipSummary["assignments"][number]["role"]): string {
  if (role === "referee") return "Árbitro";
  if (role === "registrations") return "Inscrições";
  if (role === "broadcast") return "Transmissão";
  return "Analista";
}
