"use client";

import type { AuditEvent as AuditEventData, AuditVisibility } from "@pubg-camp/contracts";
import { useState } from "react";
import { Button } from "../ui/button";
import { EmptyState, FeedbackState, InlineAlert } from "../ui/feedback";

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const ACTION_LABELS: Record<AuditEventData["action"], string> = {
  "identity.linked": "Forma de acesso vinculada",
  "identity.email.changed": "E-mail da conta alterado",
  "session.revoked": "Sessão encerrada",
  "organization.created": "Organização criada",
  "organization.updated": "Organização atualizada",
  "invitation.created": "Convite criado",
  "invitation.revoked": "Convite revogado",
  "invitation.accepted": "Convite aceito",
  "membership.roles.updated": "Permissões do membro atualizadas",
  "membership.revoked": "Acesso do membro revogado",
  "ownership.transferred": "Propriedade transferida",
};

const FIELD_LABELS: Record<AuditEventData["changes"][number]["field"], string> = {
  organizationName: "Nome da organização",
  organizationLogo: "Logo da organização",
  membershipStatus: "Status do membro",
  organizationRole: "Papel na organização",
  operationalRoles: "Cargos operacionais",
  ownership: "Propriedade",
  identityProvider: "Forma de acesso",
  emailAddress: "E-mail",
  sessionStatus: "Status da sessão",
  invitationStatus: "Status do convite",
};

export function AuditEvent({ event }: { event: AuditEventData }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article
      className="audit-event"
      aria-label={`${ACTION_LABELS[event.action]} — ${event.targetLabel}`}
    >
      <header>
        <div>
          <h2>{ACTION_LABELS[event.action]}</h2>
          <p>
            {event.actor.displayName} · {safeDate(event.occurredAt)}
          </p>
        </div>
        <span>{event.scopeLabel}</span>
      </header>
      <dl>
        <div>
          <dt>Alvo</dt>
          <dd>{sanitize(event.targetLabel)}</dd>
        </div>
        <div>
          <dt>Motivo</dt>
          <dd>{sanitize(event.reason)}</dd>
        </div>
        {event.actor.maskedEmail ? (
          <div>
            <dt>Ator</dt>
            <dd>{sanitize(event.actor.maskedEmail)}</dd>
          </div>
        ) : null}
      </dl>
      {event.changes.length > 0 ? (
        <>
          <Button aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
            {expanded ? "Ocultar alterações" : "Ver alterações"}
          </Button>
          {expanded ? (
            <ul className="audit-event__changes" aria-label="Alterações do evento">
              {event.changes.map((change) => (
                <li key={`${change.field}:${change.before ?? "empty"}:${change.after ?? "empty"}`}>
                  <strong>{FIELD_LABELS[change.field]}</strong>
                  <dl>
                    <div>
                      <dt>Antes</dt>
                      <dd>{sanitize(change.before) || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Depois</dt>
                      <dd>{sanitize(change.after) || "Não informado"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

export interface AuditFilters {
  from?: string;
  to?: string;
  actorId?: string;
  action?: AuditEventData["action"];
  authorizationScopeId?: string;
}

interface AuditTimelineProps {
  organizationSlug: string;
  visibility: AuditVisibility;
  events: readonly AuditEventData[];
  page: number;
  totalPages: number;
  filters: AuditFilters;
  state?: "ready" | "loading" | "error" | "offline" | "permission";
}

export function AuditTimeline({
  organizationSlug,
  visibility,
  events,
  page,
  totalPages,
  filters,
  state = "ready",
}: AuditTimelineProps) {
  if (state !== "ready") {
    if (state === "error") {
      return (
        <InlineAlert tone="danger">
          Não foi possível carregar a auditoria. Tente novamente sem alterar os filtros.
        </InlineAlert>
      );
    }
    return <FeedbackState state={state} />;
  }
  const filtered = Object.values(filters).some(Boolean);
  const basePath = `/o/${organizationSlug}/auditoria`;

  return (
    <section className="audit-timeline" aria-labelledby="audit-view-title">
      <header>
        <h2 id="audit-view-title">
          {visibility === "all" ? "Auditoria da organização" : "Minhas ações"}
        </h2>
        {visibility === "self" ? (
          <InlineAlert>Você está vendo somente ações realizadas por você.</InlineAlert>
        ) : null}
      </header>
      <form className="audit-filters" method="get" action={basePath}>
        <label>
          <span>De</span>
          <input
            className="ui-input"
            type="date"
            name="from"
            defaultValue={datePart(filters.from)}
          />
        </label>
        <label>
          <span>Até</span>
          <input className="ui-input" type="date" name="to" defaultValue={datePart(filters.to)} />
        </label>
        {visibility === "all" ? (
          <label>
            <span>Ator</span>
            <input className="ui-input" name="actorId" defaultValue={filters.actorId} />
          </label>
        ) : null}
        <label>
          <span>Tipo de ação</span>
          <select className="ui-input" name="action" defaultValue={filters.action ?? ""}>
            <option value="">Todas</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Campeonato ou organização</span>
          <input
            className="ui-input"
            name="authorizationScopeId"
            defaultValue={filters.authorizationScopeId}
          />
        </label>
        <Button type="submit" variant="primary">
          Aplicar filtros
        </Button>
        <a href={basePath}>Limpar filtros</a>
      </form>

      {events.length === 0 ? (
        <EmptyState
          title={
            filtered ? "Nenhum evento corresponde aos filtros." : "Nenhuma ação auditada ainda."
          }
          description={
            filtered
              ? "Limpe os filtros para revisar toda a faixa permitida."
              : "As próximas ações protegidas aparecerão aqui."
          }
          action={filtered ? <a href={basePath}>Limpar filtros</a> : undefined}
        />
      ) : (
        <div className="audit-event-list">
          {events.map((event) => (
            <AuditEvent key={event.id} event={event} />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="audit-pagination" aria-label="Paginação da auditoria">
          {page > 1 ? (
            <a href={pageHref(basePath, filters, page - 1)}>Página anterior</a>
          ) : (
            <span />
          )}
          <span>
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <a href={pageHref(basePath, filters, page + 1)}>Próxima página</a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}

function pageHref(basePath: string, filters: AuditFilters, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  query.set("page", String(page));
  return `${basePath}?${query}`;
}

function sanitize(value: string | null): string {
  if (!value) return "";
  if (/(token|cookie|password|secret|cipher|payload)/i.test(value)) return "Informação protegida";
  return value.replace(/([\w.+-])[^\s@]*@([\w.-]+\.[a-z]{2,})/gi, "$1•••@$2").slice(0, 500);
}

function safeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data registrada pelo servidor"
    : DATE_FORMATTER.format(date);
}

function datePart(value?: string): string {
  return value?.slice(0, 10) ?? "";
}
