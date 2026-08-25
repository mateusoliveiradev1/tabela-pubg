"use client";

import type { IdentityProvider, IdentitySummary, PendingIdentityLink } from "@pubg-camp/contracts";
import { Link2, Mail, MessageCircle, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { InlineAlert, StatusBadge } from "../ui/feedback";
import { Input } from "../ui/input";
import { submitDiscordNavigation } from "./discord-navigation";
import {
  clearIdentityActionContinuation,
  consumeIdentityActionContinuation,
  type IdentityActionDescriptor,
  storeIdentityActionContinuation,
} from "./identity-action-continuation";
import { attachOAuthStepUpFlow } from "./oauth-step-up-flow";
import { OtpInput } from "./otp-input";

interface IdentityCardsProps {
  identities: readonly IdentitySummary[];
  pendingLink?: PendingIdentityLink | null;
  onRefresh?: () => void;
}

type LinkMessage = { tone: "info" | "danger"; text: string } | undefined;

export function IdentityCards({ identities, pendingLink, onRefresh }: IdentityCardsProps) {
  const [linking, setLinking] = useState(false);
  const [removingId, setRemovingId] = useState<string>();
  const [message, setMessage] = useState<LinkMessage>();
  const [reauthAction, setReauthAction] = useState<IdentityActionDescriptor>();
  const [emailLinkAuthorized, setEmailLinkAuthorized] = useState(false);
  const refresh = onRefresh ?? (() => window.location.reload());
  const verifiedIdentities = identities.filter((identity) => identity.status === "verified");

  // biome-ignore lint/correctness/useExhaustiveDependencies: the one-shot continuation must only be consumed on mount.
  useEffect(() => {
    const continuation = consumeIdentityActionContinuation(sessionStorage);
    if (continuation) void executeAuthorizedAction(continuation);
  }, []);

  function requireReauthentication(action: IdentityActionDescriptor) {
    setMessage(undefined);
    setReauthAction(action);
  }

  async function executeAuthorizedAction(action: IdentityActionDescriptor) {
    setReauthAction(undefined);
    if (action.kind === "link-email") {
      setEmailLinkAuthorized(true);
      return;
    }
    if (action.kind === "link-discord") {
      await startDiscordIdentityLink(action);
      return;
    }
    if (action.kind === "confirm-link") {
      await confirmPendingLink(action.candidateIdentityId);
      return;
    }
    await removeIdentity(action.identityId);
  }

  async function confirmPendingLink(candidateIdentityId: string) {
    if (linking) return;
    setLinking(true);
    setMessage(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/identity/identities/link/confirm", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ candidateIdentityId, confirmation: true }),
      });
      if (response.status === 428) {
        requireReauthentication({ kind: "confirm-link", candidateIdentityId });
        return;
      }
      if (response.status === 409) {
        setMessage({
          tone: "danger",
          text: "Esta forma de acesso já está vinculada a outra conta. Nenhuma conta foi unida.",
        });
        return;
      }
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { otherSessionsRevoked?: unknown };
      const revoked =
        typeof payload.otherSessionsRevoked === "number" ? payload.otherSessionsRevoked : 0;
      setMessage({
        tone: "info",
        text: `Vínculo concluído. Encerramos ${revoked} outras sessões por segurança.`,
      });
      window.setTimeout(refresh, 800);
    } catch {
      setMessage({ tone: "danger", text: "Não foi possível vincular esta forma de acesso." });
    } finally {
      setLinking(false);
    }
  }

  async function removeIdentity(identityId: string) {
    if (verifiedIdentities.length <= 1 || removingId) return;
    setRemovingId(identityId);
    setMessage(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch(
        `/api/platform/identity/identities/${encodeURIComponent(identityId)}/remove`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({ identityId }),
        },
      );
      if (response.status === 428) {
        requireReauthentication({ kind: "remove-identity", identityId });
        return;
      }
      if (!response.ok) throw new Error();
      setMessage({ tone: "info", text: "Forma de acesso removida após confirmação do servidor." });
      window.setTimeout(refresh, 500);
    } catch {
      setMessage({ tone: "danger", text: "Não foi possível remover esta forma de acesso." });
    } finally {
      setRemovingId(undefined);
    }
  }

  async function startDiscordIdentityLink(action: IdentityActionDescriptor) {
    try {
      const csrf = await acquireCsrf();
      submitDiscordNavigation({
        csrfToken: csrf,
        purpose: "link-identity",
        returnPath: "/conta/identidades",
      });
    } catch {
      setMessage({ tone: "danger", text: "NÃ£o foi possÃ­vel abrir o Discord." });
      setReauthAction(action);
    }
  }

  return (
    <div className="identity-access-list">
      {message ? (
        <InlineAlert tone={message.tone}>
          <span aria-live="polite">{message.text}</span>
        </InlineAlert>
      ) : null}
      {(["discord", "email"] as const).map((provider) => {
        const identity = identities.find(
          (candidate) => candidate.provider === provider && candidate.status === "verified",
        );
        const candidate = pendingLink?.provider === provider ? pendingLink : null;
        const ProviderIcon = provider === "discord" ? MessageCircle : Mail;
        return (
          <article className="identity-card" key={provider}>
            <header>
              <ProviderIcon aria-hidden="true" size={24} />
              <div>
                <h2>{providerLabel(provider)}</h2>
                <StatusBadge tone={identity ? "accent" : "neutral"}>
                  {identity ? "Vinculado" : "Não vinculado"}
                </StatusBadge>
              </div>
            </header>
            {identity ? (
              <>
                <dl>
                  <div>
                    <dt>Identidade</dt>
                    <dd>{identity.displayIdentifier}</dd>
                  </div>
                  <div>
                    <dt>Vinculada em</dt>
                    <dd>{formatDate(identity.linkedAt)}</dd>
                  </div>
                </dl>
                {verifiedIdentities.length <= 1 ? (
                  <Button
                    variant="ghost"
                    disabled
                    title="Vincule outra forma de acesso antes de remover esta."
                    aria-label={`Desvincular ${providerLabel(provider)}`}
                  >
                    <Unlink aria-hidden="true" size={18} />
                    Última forma de acesso
                  </Button>
                ) : (
                  <Dialog
                    trigger={`Desvincular ${providerLabel(provider)}`}
                    title="Remover forma de acesso"
                    description="Você não poderá mais entrar usando esta identidade."
                  >
                    <Button
                      variant="destructive"
                      loading={removingId === identity.id}
                      loadingLabel="Removendo…"
                      onClick={() =>
                        requireReauthentication({
                          kind: "remove-identity",
                          identityId: identity.id,
                        })
                      }
                    >
                      Remover forma de acesso
                    </Button>
                  </Dialog>
                )}
              </>
            ) : candidate ? (
              <Dialog
                trigger={`Confirmar vínculo de ${provider === "email" ? "e-mail" : "Discord"}`}
                title="Confirme a vinculação"
                description="Você poderá entrar por qualquer um dos dois métodos. Contas nunca são unidas apenas porque os e-mails coincidem."
              >
                <p>Forma de acesso: {candidate.displayIdentifier}</p>
                <InlineAlert>
                  Ao concluir, as outras sessões serão encerradas por segurança.
                </InlineAlert>
                {message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}
                <Button
                  variant="primary"
                  loading={linking}
                  loadingLabel="Vinculando…"
                  onClick={() =>
                    requireReauthentication({
                      kind: "confirm-link",
                      candidateIdentityId: candidate.id,
                    })
                  }
                >
                  <Link2 aria-hidden="true" size={18} />
                  Vincular identidade
                </Button>
              </Dialog>
            ) : provider === "discord" ? (
              <Button onClick={() => requireReauthentication({ kind: "link-discord" })}>
                Vincular Discord
              </Button>
            ) : (
              <EmailIdentityLink
                authorized={emailLinkAuthorized}
                onRequireReauthentication={() => requireReauthentication({ kind: "link-email" })}
                onReauthenticationRequired={() => {
                  setEmailLinkAuthorized(false);
                  requireReauthentication({ kind: "link-email" });
                }}
                onVerified={refresh}
              />
            )}
          </article>
        );
      })}
      <InlineAlert title="Proteção da conta">
        Vincular ou trocar uma identidade encerra as outras sessões. Somente esta sessão confirmada
        permanece ativa.
      </InlineAlert>
      {reauthAction ? (
        <IdentityReauthenticationDialog
          identities={verifiedIdentities}
          action={reauthAction}
          onCancel={() => setReauthAction(undefined)}
          onConfirmed={() => executeAuthorizedAction(reauthAction)}
        />
      ) : null}
    </div>
  );
}

function IdentityReauthenticationDialog({
  identities,
  action,
  onCancel,
  onConfirmed,
}: {
  identities: readonly IdentitySummary[];
  action: IdentityActionDescriptor;
  onCancel: () => void;
  onConfirmed: () => void | Promise<void>;
}) {
  const hasDiscord = identities.some((identity) => identity.provider === "discord");
  const hasEmail = identities.some((identity) => identity.provider === "email");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function startDiscordStepUp() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    let nonce: string | undefined;
    try {
      const csrf = await acquireCsrf();
      nonce = storeIdentityActionContinuation(sessionStorage, action);
      submitDiscordNavigation({
        csrfToken: csrf,
        purpose: "step-up",
        returnPath: attachOAuthStepUpFlow("/conta/identidades", "identity", nonce),
      });
    } catch {
      if (nonce) clearIdentityActionContinuation(sessionStorage, nonce);
      setError("Não foi possível abrir o Discord.");
      setBusy(false);
    }
  }

  async function requestEmailStepUp() {
    if (busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Informe o e-mail já vinculado à conta.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/identity/email/otp/step-up/request", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: jsonHeaders(csrf),
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const challenge = response.headers.get("x-otp-challenge-id");
      if (!response.ok || !challenge) throw new Error();
      setChallengeId(challenge);
    } catch {
      setError("Não foi possível enviar o código de confirmação.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailStepUp() {
    if (busy || code.length !== 8) {
      setError("Informe os 8 dígitos do código.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/identity/email/otp/step-up/verify", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: jsonHeaders(csrf),
        body: JSON.stringify({
          challengeId,
          email: email.trim().toLowerCase(),
          code,
        }),
      });
      const payload = response.ok ? ((await response.json()) as { status?: unknown }) : null;
      if (payload?.status !== "step-up-confirmed") throw new Error();
      await onConfirmed();
    } catch {
      setError("Código inválido ou expirado. Solicite um novo código.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      trigger={<span hidden />}
      title="Confirme que é você"
      description="Use uma forma de acesso já vinculada antes de alterar sua conta."
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      {hasDiscord ? (
        <Button variant="discord" loading={busy} onClick={startDiscordStepUp}>
          Confirmar com Discord
        </Button>
      ) : null}
      {hasEmail ? (
        <div className="identity-link-form">
          {!challengeId ? (
            <>
              <Input
                label="E-mail já vinculado"
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
              <Button loading={busy} onClick={requestEmailStepUp}>
                Receber código de confirmação
              </Button>
            </>
          ) : (
            <>
              <OtpInput value={code} onChange={setCode} />
              <Button loading={busy} onClick={verifyEmailStepUp}>
                Confirmar código
              </Button>
            </>
          )}
        </div>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className="ui-dialog-actions">
        <Button disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </Dialog>
  );
}

function EmailIdentityLink({
  authorized,
  onRequireReauthentication,
  onReauthenticationRequired,
  onVerified,
}: {
  authorized: boolean;
  onRequireReauthentication: () => void;
  onReauthenticationRequired: () => void;
  onVerified: () => void;
}) {
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (authorized) setOpen(true);
  }, [authorized]);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    if (loading || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Informe um e-mail válido.");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/identity/email/otp/link-email/request", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const challenge = response.headers.get("x-otp-challenge-id");
      if (response.status === 428) {
        setOpen(false);
        onReauthenticationRequired();
        return;
      }
      if (!response.ok || !challenge) throw new Error();
      setChallengeId(challenge);
    } catch {
      setError("Não foi possível enviar o código. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (loading || code.length !== 8) {
      setError("Informe os 8 dígitos do código.");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/identity/email/otp/link-email/verify", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({
          challengeId,
          email: email.trim().toLowerCase(),
          code,
        }),
      });
      if (response.status === 428) {
        setCode("");
        setChallengeId("");
        setOpen(false);
        onReauthenticationRequired();
        return;
      }
      if (!response.ok) throw new Error();
      setCode("");
      setChallengeId("");
      onVerified();
    } catch {
      setError("Código inválido ou expirado. Solicite um novo código.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      trigger="Vincular e-mail"
      title="Vincular e-mail"
      description="O vínculo só será concluído após o código e uma confirmação explícita nesta sessão."
      open={open}
      onOpenChange={setOpen}
    >
      {authorized ? (
        <form className="identity-link-form" onSubmit={challengeId ? verifyCode : requestCode}>
          {challengeId ? (
            <OtpInput value={code} onChange={setCode} {...(error ? { error } : {})} />
          ) : (
            <Input
              label="E-mail a vincular"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              {...(error ? { error } : {})}
            />
          )}
          <Button type="submit" variant="primary" loading={loading}>
            {challengeId ? "Verificar e continuar" : "Enviar código de vínculo"}
          </Button>
        </form>
      ) : (
        <div className="identity-link-form">
          <InlineAlert>Confirme primeiro uma forma de acesso já vinculada.</InlineAlert>
          <Button
            variant="primary"
            onClick={() => {
              setOpen(false);
              onRequireReauthentication();
            }}
          >
            Confirmar identidade
          </Button>
        </div>
      )}
    </Dialog>
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

function jsonHeaders(csrf: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-csrf-token": csrf,
  };
}

function providerLabel(provider: IdentityProvider): string {
  return provider === "discord" ? "Discord" : "E-mail";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}
