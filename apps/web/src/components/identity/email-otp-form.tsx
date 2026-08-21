"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { InlineAlert } from "../ui/feedback";
import { Input } from "../ui/input";
import { OtpInput } from "./otp-input";

const OTP_REQUEST_PATH = "/api/platform/identity/email/otp/request";
const OTP_VERIFY_PATH = "/api/platform/identity/email/otp/verify";
const UNIFORM_REQUEST_COPY =
  "Se este e-mail puder receber mensagens, enviaremos um código em instantes.";

type FormStage = "request" | "verify";
type OtpFailure = "invalid" | "expired" | "limited" | "offline" | undefined;

export function EmailOtpForm() {
  const [stage, setStage] = useState<FormStage>("request");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [otpFailure, setOtpFailure] = useState<OtpFailure>();
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (submitting) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      setEmailError("Informe um e-mail válido.");
      return;
    }

    setSubmitting(true);
    setEmailError(undefined);
    setOtpFailure(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch(OTP_REQUEST_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ email: normalizedEmail, purpose: "sign-in" }),
      });
      const opaqueChallenge = response.headers.get("x-otp-challenge-id");
      if (!response.ok || !opaqueChallenge) throw new Error();
      const payload = (await response.json()) as { retryAfterSeconds?: unknown };
      setEmail(normalizedEmail);
      setChallengeId(opaqueChallenge);
      setCode("");
      setCooldown(normalizeCooldown(payload.retryAfterSeconds));
      setNotice(stage === "verify" ? "Novo código enviado" : UNIFORM_REQUEST_COPY);
      setStage("verify");
      window.setTimeout(() => otpRef.current?.focus(), 0);
    } catch {
      setNotice(UNIFORM_REQUEST_COPY);
      setOtpFailure("offline");
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (code.length !== 8) {
      setOtpFailure("invalid");
      otpRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setOtpFailure(undefined);
    try {
      const csrf = await acquireCsrf();
      const response = await fetch(OTP_VERIFY_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ challengeId, email, code, purpose: "sign-in" }),
      });
      if (!response.ok) {
        setOtpFailure(
          response.status === 410 ? "expired" : response.status === 429 ? "limited" : "invalid",
        );
        otpRef.current?.focus();
        return;
      }
      const payload = (await response.json()) as { nextPath?: unknown };
      setCode("");
      setChallengeId("");
      const nextPath =
        typeof payload.nextPath === "string" && isSafeReturnPath(payload.nextPath)
          ? payload.nextPath
          : "/";
      window.location.assign(nextPath);
    } catch {
      setOtpFailure("offline");
      otpRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === "verify") {
    const failureCopy = otpFailureCopy(otpFailure);
    return (
      <form className="auth-form" onSubmit={verifyCode} noValidate>
        <div>
          <h2>Digite o código</h2>
          <p className="auth-description">
            Enviamos um código para {maskEmail(email)}. Ele expira em 10 minutos.
          </p>
        </div>
        {notice ? (
          <div className="auth-live-region" aria-live="polite">
            {notice}
          </div>
        ) : null}
        <OtpInput
          ref={otpRef}
          value={code}
          onChange={setCode}
          {...(failureCopy ? { error: failureCopy } : {})}
        />
        {otpFailure === "offline" ? (
          <InlineAlert tone="danger">Sem conexão. Nenhuma alteração foi enviada.</InlineAlert>
        ) : null}
        <Button
          className="auth-full-width"
          variant="primary"
          size="auth"
          type="submit"
          loading={submitting}
          loadingLabel="Confirmando…"
        >
          Confirmar código
        </Button>
        <Button
          className="auth-full-width"
          variant="ghost"
          size="auth"
          disabled={cooldown > 0}
          loading={submitting}
          onClick={() => requestCode()}
        >
          {cooldown > 0 ? `Reenviar em 00:${String(cooldown).padStart(2, "0")}` : "Reenviar código"}
        </Button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={requestCode} noValidate>
      <Input
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
        onBlur={() => email && !isValidEmail(email) && setEmailError("Informe um e-mail válido.")}
        helperText="Enviaremos um código temporário. Você não precisa de senha."
        {...(emailError ? { error: emailError } : {})}
        required
      />
      {notice ? (
        <div className="auth-live-region" aria-live="polite">
          {notice}
        </div>
      ) : null}
      <Button
        className="auth-full-width"
        variant="secondary"
        size="auth"
        type="submit"
        loading={submitting}
        loadingLabel="Solicitando…"
      >
        Receber código
      </Button>
    </form>
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@", 2);
  return `${local.slice(0, 1) || "m"}•••@${domain || "dominio.com"}`;
}

function normalizeCooldown(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 3600)
    : 60;
}

function otpFailureCopy(failure: OtpFailure): string | undefined {
  if (failure === "invalid") return "Código inválido. Confira os 8 dígitos e tente novamente.";
  if (failure === "expired") return "Este código expirou. Solicite um novo para continuar.";
  if (failure === "limited") return "Muitas tentativas. Solicite um novo código mais tarde.";
  return undefined;
}

function isSafeReturnPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
