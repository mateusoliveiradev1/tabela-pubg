"use client";

import { useEffect, useRef, useState } from "react";
import { submitDiscordNavigation } from "../identity/discord-navigation";
import { Button } from "../ui/button";
import { InlineAlert } from "../ui/feedback";
import { Input } from "../ui/input";

interface ConfirmSensitiveActionDialogProps {
  impact: string;
  confirmLabel: string;
  onCancel: () => void;
  onCommit: (reason: string) => Promise<void>;
  destructive?: boolean;
}

type Step = "reason" | "step-up" | "commit";

export function ConfirmSensitiveActionDialog({
  impact,
  confirmLabel,
  onCancel,
  onCommit,
  destructive = false,
}: ConfirmSensitiveActionDialogProps) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const reasonInput = useRef<HTMLTextAreaElement | null>(null);
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    reasonInput.current?.focus();
    return () => returnFocus.current?.focus();
  }, []);

  async function requestEmailCode() {
    if (busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Informe um e-mail válido.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/identity/email/otp/request", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: jsonHeaders(csrf),
        body: JSON.stringify({ email: email.trim().toLowerCase(), purpose: "step-up" }),
      });
      const challenge = response.headers.get("x-otp-challenge-id");
      if (!response.ok || !challenge) throw new Error();
      setChallengeId(challenge);
    } catch {
      setError("Não foi possível enviar o código. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailCode() {
    if (busy || code.length !== 8) {
      setError("Informe os 8 dígitos do código.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch("/api/platform/identity/email/otp/verify", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: jsonHeaders(csrf),
        body: JSON.stringify({
          challengeId,
          email: email.trim().toLowerCase(),
          code,
          purpose: "step-up",
        }),
      });
      const payload = response.ok ? ((await response.json()) as { status?: unknown }) : null;
      if (payload?.status !== "step-up-confirmed") throw new Error();
      setStep("commit");
    } catch {
      setError("Código inválido ou expirado. Solicite um novo código.");
    } finally {
      setBusy(false);
    }
  }

  async function startDiscordStepUp() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const csrf = await acquireCsrf();
      sessionStorage.setItem("pubg-camp:sensitive-action-reason", reason);
      submitDiscordNavigation({
        csrfToken: csrf,
        purpose: "step-up",
        returnPath: window.location.pathname,
      });
    } catch {
      setError("Não foi possível abrir o Discord. Use o código por e-mail.");
      setBusy(false);
    }
  }

  async function commit() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onCommit(reason.trim());
    } catch {
      setError("Não foi possível concluir esta ação. Tente novamente.");
      setBusy(false);
    }
  }

  return (
    <div className="ui-dialog-overlay">
      <section
        className="ui-dialog-content sensitive-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensitive-action-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <h2 id="sensitive-action-title">
          {step === "reason"
            ? "Revise o impacto"
            : step === "step-up"
              ? "Confirme que é você"
              : "Confirmar alteração"}
        </h2>
        <p>{impact}</p>

        <label className="ui-field">
          <span className="ui-label">Motivo da alteração</span>
          <textarea
            ref={reasonInput}
            className="ui-input management-textarea"
            value={reason}
            required
            disabled={busy}
            placeholder="Ex.: mudança na equipe de organização"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        {step === "step-up" ? (
          <div className="sensitive-action-dialog__step-up">
            <Button variant="discord" loading={busy} onClick={startDiscordStepUp}>
              Confirmar com Discord
            </Button>
            {!challengeId ? (
              <>
                <Input
                  label="E-mail da conta"
                  type="email"
                  autoComplete="email"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <Button loading={busy} onClick={requestEmailCode}>
                  Confirmar por e-mail
                </Button>
              </>
            ) : (
              <>
                <Input
                  label="Código de 8 dígitos"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  disabled={busy}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                />
                <Button loading={busy} onClick={verifyEmailCode}>
                  Validar código
                </Button>
              </>
            )}
          </div>
        ) : null}

        {step === "commit" ? (
          <InlineAlert>Identidade confirmada há menos de 10 minutos</InlineAlert>
        ) : null}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

        <div className="ui-dialog-actions">
          <Button disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          {step === "reason" ? (
            <Button
              variant="primary"
              disabled={reason.trim().length < 8}
              onClick={() => setStep("step-up")}
            >
              Continuar
            </Button>
          ) : null}
          {step === "commit" ? (
            <Button
              variant={destructive ? "destructive" : "primary"}
              loading={busy}
              loadingLabel={confirmLabel === "Salvar permissões" ? "Salvando…" : "Confirmando…"}
              onClick={commit}
            >
              {confirmLabel}
            </Button>
          ) : null}
        </div>
      </section>
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

function jsonHeaders(csrf: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-csrf-token": csrf,
  };
}
