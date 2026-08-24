"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { parseOrganizationLogoOrigins } from "../../lib/organization-logo-origins";
import { Button } from "../ui/button";
import { InlineAlert } from "../ui/feedback";

type ValidInvitation = {
  status: "valid";
  organization: { name: string; logoUrl: string | null };
  invitedBy: string;
  maskedEmail: string;
  organizationRole: string;
  expiresAt: string;
  emailMatches: boolean;
};

type InvitationStatus =
  | { state: "loading" }
  | { state: "unauthenticated" }
  | { state: "valid"; invitation: ValidInvitation }
  | { state: "expired" | "revoked" | "used" | "invalid" | "race" }
  | { state: "accepted"; organizationName: string };

const INVITATION_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeStyle: "short",
});

export function InvitationAcceptForm() {
  const started = useRef(false);
  const [status, setStatus] = useState<InvitationStatus>({ state: "loading" });
  const [accepting, setAccepting] = useState(false);

  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    const context = url.searchParams.get("token") ?? readFragmentToken(url.hash);
    window.history.replaceState({}, "", url.pathname);
    if (!context || context.length < 16 || context.length > 1024) {
      setStatus({ state: "invalid" });
      return;
    }
    void loadPreview(context).then(setStatus);
  }, []);

  async function acceptInvitation() {
    if (accepting || status.state !== "valid" || !status.invitation.emailMatches) return;
    setAccepting(true);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/invitations/accept", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ confirmation: true }),
      });
      if (response.status === 401 || response.status === 403) {
        setStatus({ state: "unauthenticated" });
      } else if (response.status === 409 || response.status === 410) {
        setStatus({ state: "race" });
      } else if (!response.ok) {
        setStatus({ state: "invalid" });
      } else {
        setStatus({ state: "accepted", organizationName: status.invitation.organization.name });
      }
    } catch {
      setStatus({ state: "invalid" });
    } finally {
      setAccepting(false);
    }
  }

  if (status.state === "loading") {
    return <p role="status">Carregando convite…</p>;
  }

  if (status.state === "unauthenticated") {
    return (
      <div className="auth-result">
        <h2>Entre para revisar o convite</h2>
        <p>Confirme sua identidade antes de aceitar o acesso à organização.</p>
        <a
          className="ui-button ui-button--primary ui-button--auth"
          href="/entrar?retorno=%2Fconvites%2Faceitar"
        >
          Entrar para continuar
        </a>
      </div>
    );
  }

  if (status.state === "accepted") {
    return (
      <div className="auth-result" role="status">
        <h2>Convite aceito</h2>
        <p>Você agora faz parte de {status.organizationName}.</p>
        <a className="ui-button ui-button--primary ui-button--auth" href="/">
          Abrir plataforma
        </a>
      </div>
    );
  }

  if (status.state !== "valid") {
    return <InvitationTerminalState state={status.state} />;
  }

  const invitation = status.invitation;
  if (!invitation.emailMatches) {
    return (
      <div className="auth-result">
        <h2>Este convite usa outro e-mail</h2>
        <p>Entre ou vincule o endereço mascarado {invitation.maskedEmail} para continuar.</p>
        <a className="ui-button ui-button--secondary ui-button--auth" href="/conta/identidades">
          Revisar formas de acesso
        </a>
      </div>
    );
  }

  return (
    <div className="invitation-preview">
      <span className="eyebrow">CONVITE</span>
      <div className="invitation-preview__brand">
        <InvitationOrganizationLogo organization={invitation.organization} />
        <h2>{invitation.organization.name}</h2>
      </div>
      <p>
        Enviado por {invitation.invitedBy} para {invitation.maskedEmail}.
      </p>
      <dl>
        <div>
          <dt>Papel inicial</dt>
          <dd>{roleLabel(invitation.organizationRole)}</dd>
        </div>
        <div>
          <dt>Validade</dt>
          <dd>{formatExpiry(invitation.expiresAt)}</dd>
        </div>
      </dl>
      <InlineAlert>O convite é de uso único e só será consumido após sua confirmação.</InlineAlert>
      <Button
        className="auth-full-width"
        variant="primary"
        size="auth"
        loading={accepting}
        loadingLabel="Aceitando…"
        onClick={acceptInvitation}
      >
        Aceitar convite
      </Button>
    </div>
  );
}

function InvitationOrganizationLogo({
  organization,
}: {
  organization: ValidInvitation["organization"];
}) {
  const [failed, setFailed] = useState(false);
  const safeUrl = safeInvitationLogoUrl(organization.logoUrl);
  if (!safeUrl || failed) {
    return (
      <span className="invitation-preview__logo-fallback" aria-hidden="true">
        {organizationInitials(organization.name)}
      </span>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: signed runtime URLs cannot be modeled by next/image.
    <img
      className="invitation-preview__logo"
      src={safeUrl}
      alt={`Logo da organização ${organization.name}`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

async function loadPreview(context: string): Promise<InvitationStatus> {
  try {
    const csrf = await acquireCsrf();
    const response = await fetch("/api/platform/invitations/preview", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ context }),
    });
    if (response.status === 401 || response.status === 403) return { state: "unauthenticated" };
    if (!response.ok) return { state: "invalid" };
    const payload = (await response.json()) as Record<string, unknown>;
    if (payload.status === "valid" && isValidInvitation(payload)) {
      return { state: "valid", invitation: payload };
    }
    if (payload.status === "expired" || payload.status === "revoked" || payload.status === "used") {
      return { state: payload.status };
    }
    return { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

function InvitationTerminalState({
  state,
}: {
  state: "expired" | "revoked" | "used" | "invalid" | "race";
}) {
  const copy = {
    expired: ["Este convite expirou", "Peça ao organizador para enviar um novo convite."],
    revoked: ["Este convite foi revogado", "Peça ao organizador para confirmar seu acesso."],
    used: ["Este convite já foi utilizado", "Entre na plataforma para revisar suas organizações."],
    invalid: ["Não foi possível validar este convite", "Solicite um novo convite ao organizador."],
    race: ["Convite aceito em outra aba", "Atualize suas organizações para confirmar o acesso."],
  }[state];
  return (
    <div className="auth-result" role="alert">
      <h2>{copy[0]}</h2>
      <p>{copy[1]}</p>
      <a className="ui-button ui-button--secondary ui-button--auth" href="/entrar">
        Voltar para entrar
      </a>
    </div>
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

function readFragmentToken(hash: string): string | null {
  if (!hash) return null;
  return new URLSearchParams(hash.slice(1)).get("token");
}

function isValidInvitation(value: Record<string, unknown>): value is ValidInvitation {
  const organization = value.organization;
  const logoUrl =
    organization && typeof organization === "object"
      ? (organization as Record<string, unknown>).logoUrl
      : undefined;
  return Boolean(
    organization &&
      typeof organization === "object" &&
      typeof (organization as Record<string, unknown>).name === "string" &&
      (logoUrl === null || (typeof logoUrl === "string" && logoUrl.length <= 2048)) &&
      typeof value.invitedBy === "string" &&
      typeof value.maskedEmail === "string" &&
      typeof value.organizationRole === "string" &&
      typeof value.expiresAt === "string" &&
      typeof value.emailMatches === "boolean",
  );
}

function safeInvitationLogoUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value.startsWith("//") ? null : value;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !isLocalDevelopmentOrigin(url))
    ) {
      return null;
    }
    const configuredOrigins = parseOrganizationLogoOrigins(
      process.env.NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS,
      process.env.NODE_ENV === "development" ? "development" : "production",
    );
    return configuredOrigins.includes(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isLocalDevelopmentOrigin(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  );
}

function organizationInitials(name: string): string {
  const stopWords = new Set(["da", "das", "de", "do", "dos", "e"]);
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word && !stopWords.has(word.toLocaleLowerCase("pt-BR")));
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("");
  return initials || "ORG";
}

function roleLabel(role: string): string {
  return role === "admin" ? "Administrador" : role === "owner" ? "Proprietário" : "Membro";
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Prazo informado pelo organizador"
    : INVITATION_DATE_FORMATTER.format(date);
}
