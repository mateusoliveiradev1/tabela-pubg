"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  clearSensitiveActionContinuation,
  promoteSensitiveActionContinuation,
} from "../authorization/sensitive-action-continuation";
import { InlineAlert } from "../ui/feedback";
import {
  clearIdentityActionContinuation,
  promoteIdentityActionContinuation,
} from "./identity-action-continuation";
import { consumeOAuthStepUpFlow } from "./oauth-step-up-flow";

type CallbackStatus =
  | { state: "processing" }
  | { state: "success"; nextPath: string }
  | { state: "error" };

export function OAuthCallbackForm() {
  const started = useRef(false);
  const [status, setStatus] = useState<CallbackStatus>({ state: "processing" });

  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const purpose = safePurpose(url.searchParams.get("purpose"));
    window.history.replaceState({}, "", url.pathname);

    if (!code || code.length > 2048 || !state || state.length < 16 || state.length > 1024) {
      if (purpose === "step-up") clearStepUpContinuations();
      setStatus({ state: "error" });
      return;
    }

    void completeCallback(code, state, purpose).then(setStatus);
  }, []);

  if (status.state === "error") {
    return (
      <InlineAlert tone="danger">
        Não foi possível entrar com Discord. Tente novamente ou use seu e-mail.
      </InlineAlert>
    );
  }

  if (status.state === "success") {
    return (
      <div className="auth-result" role="status">
        <h2>Acesso confirmado</h2>
        <p>Sua identidade foi confirmada com segurança.</p>
        <a className="ui-button ui-button--primary ui-button--auth" href={status.nextPath}>
          Continuar
        </a>
      </div>
    );
  }

  return (
    <div className="auth-result" role="status" aria-live="polite">
      <h2>Confirmando seu acesso</h2>
      <p>Aguarde enquanto concluímos a entrada com Discord.</p>
    </div>
  );
}

async function completeCallback(
  code: string,
  state: string,
  purpose: "sign-in" | "link-identity" | "step-up",
): Promise<CallbackStatus> {
  try {
    const csrf = await acquireCsrf();
    const response = await fetch(`/api/platform/identity/oauth/discord/${purpose}/callback`, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ code, state, purpose }),
    });
    if (!response.ok) {
      if (purpose === "step-up") clearStepUpContinuations();
      return { state: "error" };
    }
    const payload = (await response.json()) as { nextPath?: unknown };
    if (purpose === "step-up") {
      const flow =
        typeof payload.nextPath === "string" ? consumeOAuthStepUpFlow(payload.nextPath) : null;
      if (!flow) {
        clearStepUpContinuations();
        return { state: "error" };
      }
      const promoted =
        flow.namespace === "identity"
          ? promoteIdentityActionContinuation(sessionStorage, flow.nonce)
          : promoteSensitiveActionContinuation(sessionStorage, flow.nonce);
      if (flow.namespace === "identity") clearSensitiveActionContinuation(sessionStorage);
      else clearIdentityActionContinuation(sessionStorage);
      if (!promoted) {
        clearStepUpContinuations();
        return { state: "error" };
      }
      return { state: "success", nextPath: flow.nextPath };
    }
    return {
      state: "success",
      nextPath:
        typeof payload.nextPath === "string" && isSafeReturnPath(payload.nextPath)
          ? payload.nextPath
          : "/",
    };
  } catch {
    if (purpose === "step-up") clearStepUpContinuations();
    return { state: "error" };
  }
}

function clearStepUpContinuations(): void {
  clearSensitiveActionContinuation(sessionStorage);
  clearIdentityActionContinuation(sessionStorage);
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

function safePurpose(value: string | null): "sign-in" | "link-identity" | "step-up" {
  return value === "link-identity" || value === "step-up" ? value : "sign-in";
}

function isSafeReturnPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
