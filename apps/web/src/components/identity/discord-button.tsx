"use client";

import { MessageCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { InlineAlert } from "../ui/feedback";

interface DiscordButtonProps {
  returnPath?: string;
  onRedirect?: (url: string) => void;
}

const DISCORD_START_PATH = "/api/platform/identity/oauth/discord/start";

export function DiscordButton({ returnPath, onRedirect }: DiscordButtonProps) {
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function startDiscord() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(false);

    try {
      const csrf = await acquireCsrf();
      const response = await fetch(DISCORD_START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "manual",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({
          purpose: "sign-in",
          ...(isSafeReturnPath(returnPath) ? { returnPath } : {}),
        }),
      });
      const location = response.headers.get("location");
      if (!response.ok && response.status !== 302 && response.status !== 303) throw new Error();
      if (!location || !isDiscordAuthorizationUrl(location)) throw new Error();
      if (onRedirect) onRedirect(location);
      else window.location.assign(location);
    } catch {
      inFlight.current = false;
      setLoading(false);
      setFailed(true);
    }
  }

  return (
    <div className="auth-provider-stack">
      <Button
        className="auth-full-width"
        variant="discord"
        size="auth"
        loading={loading}
        loadingLabel="Abrindo Discord…"
        onClick={startDiscord}
      >
        <MessageCircle aria-hidden="true" size={20} />
        Continuar com Discord
      </Button>
      {failed ? (
        <InlineAlert tone="danger">
          Não foi possível entrar com Discord. Tente novamente ou use seu e-mail.
        </InlineAlert>
      ) : null}
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

function isSafeReturnPath(value: string | undefined): value is string {
  return Boolean(value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\"));
}

function isDiscordAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "discord.com" || url.hostname.endsWith(".discord.com"))
    );
  } catch {
    return false;
  }
}
