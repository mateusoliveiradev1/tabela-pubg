"use client";

import type { MembershipSummary, OperationalRole } from "@pubg-camp/contracts";
import { useMemo, useState } from "react";
import { Button } from "../ui/button";
import { RoleBadge } from "../ui/feedback";

export interface AuthorizationScopeOption {
  id: string;
  name: string;
  roles: readonly OperationalRole[];
}

export interface RoleDraft {
  organizationRole: "admin" | "member";
  assignments: { authorizationScopeId: string; role: OperationalRole }[];
}

interface ScopeRoleEditorProps {
  member: MembershipSummary;
  scopes: readonly AuthorizationScopeOption[];
  capabilities: readonly string[];
  protectedOwner: boolean;
  onRequestCommit: (draft: RoleDraft) => void;
}

const ROLE_LABELS: Record<OperationalRole, string> = {
  referee: "Árbitro",
  registrations: "Inscrições",
  broadcast: "Transmissão",
  analyst: "Analista",
};

const CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  "organization:members:manage": "Gerenciar membros",
  "organization:roles:manage": "Gerenciar permissões",
  "organization:ownership:transfer": "Transferir propriedade",
  "organization:audit:read": "Consultar toda a auditoria",
  "organization:audit:self:read": "Consultar as próprias ações",
  "members:manage": "Gerenciar membros",
  "matches:score": "Registrar resultados",
  "broadcast:operate": "Operar transmissão",
  "tournament:broadcast:manage": "Operar transmissão",
};

export function ScopeRoleEditor({
  member,
  scopes,
  capabilities,
  protectedOwner,
  onRequestCommit,
}: ScopeRoleEditorProps) {
  const [organizationRole, setOrganizationRole] = useState<"admin" | "member">(
    member.organizationRole === "admin" ? "admin" : "member",
  );
  const [assignments, setAssignments] = useState(() =>
    member.assignments.map((assignment) => ({
      authorizationScopeId: assignment.authorizationScopeId,
      role: assignment.role,
    })),
  );
  const capabilityLabels = useMemo(
    () => capabilities.map((capability) => CAPABILITY_LABELS[capability] ?? readable(capability)),
    [capabilities],
  );

  function toggleAssignment(authorizationScopeId: string, role: OperationalRole) {
    setAssignments((current) => {
      const included = current.some(
        (assignment) =>
          assignment.authorizationScopeId === authorizationScopeId && assignment.role === role,
      );
      return included
        ? current.filter(
            (assignment) =>
              assignment.authorizationScopeId !== authorizationScopeId || assignment.role !== role,
          )
        : [...current, { authorizationScopeId, role }];
    });
  }

  return (
    <form
      className="scope-role-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!protectedOwner) onRequestCommit({ organizationRole, assignments });
      }}
    >
      <fieldset className="management-fieldset" disabled={protectedOwner}>
        <legend>Papel na organização</legend>
        <label>
          <input
            type="radio"
            name="organization-role"
            checked={organizationRole === "admin"}
            onChange={() => setOrganizationRole("admin")}
          />
          Administrador
        </label>
        <label>
          <input
            type="radio"
            name="organization-role"
            checked={organizationRole === "member"}
            onChange={() => setOrganizationRole("member")}
          />
          Membro
        </label>
      </fieldset>

      <fieldset className="management-fieldset" disabled={protectedOwner}>
        <legend>Cargos por campeonato</legend>
        {scopes.length === 0 ? (
          <p>Nenhum campeonato disponível para atribuir cargos operacionais.</p>
        ) : (
          scopes.map((scope) => (
            <section className="scope-role-editor__scope" key={scope.id} aria-label={scope.name}>
              <h3>{scope.name}</h3>
              <div className="scope-role-editor__checks">
                {scope.roles.map((role) => (
                  <label key={role}>
                    <input
                      type="checkbox"
                      checked={assignments.some(
                        (assignment) =>
                          assignment.authorizationScopeId === scope.id && assignment.role === role,
                      )}
                      aria-label={`${ROLE_LABELS[role]} — ${scope.name}`}
                      onChange={() => toggleAssignment(scope.id, role)}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </section>
          ))
        )}
      </fieldset>

      <section className="scope-role-editor__capabilities" aria-label="Permissões resultantes">
        <h3>Permissões resultantes</h3>
        <p>Capacidades atuais confirmadas pelo servidor.</p>
        {capabilityLabels.length > 0 ? (
          <ul>
            {capabilityLabels.map((label) => (
              <li key={label}>
                <RoleBadge>{label}</RoleBadge>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nenhuma capacidade operacional neste escopo.</p>
        )}
      </section>

      <Button type="submit" variant="primary" disabled={protectedOwner}>
        Revisar alteração
      </Button>
    </form>
  );
}

export async function updateMembership(input: {
  organizationId: string;
  membershipId: string;
  draft: RoleDraft;
  reason: string;
}): Promise<Response> {
  const csrf = await acquireCsrf();
  return fetch(
    `/api/platform/organizations/${input.organizationId}/members/${input.membershipId}`,
    {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        organizationRole: input.draft.organizationRole,
        assignments: input.draft.assignments,
        reason: input.reason,
      }),
    },
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
  if (!response.ok || !token) throw new Error("csrf unavailable");
  return token;
}

function readable(value: string): string {
  return (
    value
      .split(":")
      .at(-1)
      ?.replaceAll("-", " ")
      .replace(/^./, (character) => character.toUpperCase()) ?? value
  );
}
