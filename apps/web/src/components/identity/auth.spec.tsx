import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordButton } from "./discord-button";
import { EmailOtpForm } from "./email-otp-form";
import { InvitationAcceptForm } from "./invitation-accept-form";
import { OAuthCallbackForm } from "./oauth-callback-form";
import { OtpInput } from "./otp-input";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function csrfResponse(token = "csrf-token-with-safe-length") {
  return new Response(null, { status: 200, headers: { "x-csrf-token": token } });
}

describe("login Discord-first", () => {
  it("blocks duplicate Discord starts and keeps the provider URL out of the DOM", async () => {
    const user = userEvent.setup();
    const redirect = vi.fn();
    let finishStart: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finishStart = resolve;
            }),
        ),
    );

    render(<DiscordButton onRedirect={redirect} />);
    const button = screen.getByRole("button", { name: "Continuar com Discord" });
    await user.dblClick(button);

    expect(
      (screen.getByRole("button", { name: "Abrindo Discord…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("state=");

    finishStart?.(
      new Response(null, {
        status: 302,
        headers: { location: "https://discord.com/oauth2/authorize?state=secret" },
      }),
    );
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
  });

  it("requests email OTP through the same-origin BFF with CSRF and uniform copy", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "accepted", retryAfterSeconds: 60 }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-otp-challenge-id": "66323e38-bb3e-4c19-b23a-821b355c06e3",
            },
          }),
        ),
    );

    render(<EmailOtpForm />);
    await user.type(screen.getByRole("textbox", { name: "E-mail" }), "jogador@example.com");
    await user.click(screen.getByRole("button", { name: "Receber código" }));

    expect(
      await screen.findByText(
        "Se este e-mail puder receber mensagens, enviaremos um código em instantes.",
      ),
    ).toBeTruthy();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/platform/identity/email/otp/request",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token-with-safe-length" }),
      }),
    );
    expect(document.body.textContent).not.toContain("jogador@example.com");
    expect(screen.getByRole("textbox", { name: "Código de 8 dígitos" })).toBeTruthy();
  });
});

describe("OTP acessível", () => {
  it("uses one semantic input, filters paste and never submits automatically", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const Wrapper = () => (
      <form onSubmit={onSubmit}>
        <OtpInput value="" onChange={onChange} />
        <button type="submit">Confirmar código</button>
      </form>
    );

    render(<Wrapper />);
    const input = screen.getByRole("textbox", { name: "Código de 8 dígitos" });
    await user.click(input);
    await user.paste("a12-34 56789");

    expect(onChange).toHaveBeenLastCalledWith("12345678");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("keeps invalid OTP editable, focuses it, and reports failures without enumeration", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "accepted", retryAfterSeconds: 60 }), {
            status: 200,
            headers: { "x-otp-challenge-id": "66323e38-bb3e-4c19-b23a-821b355c06e3" },
          }),
        )
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(new Response(null, { status: 400 })),
    );

    render(<EmailOtpForm />);
    await user.type(screen.getByRole("textbox", { name: "E-mail" }), "jogador@example.com");
    await user.click(screen.getByRole("button", { name: "Receber código" }));
    const otp = await screen.findByRole("textbox", { name: "Código de 8 dígitos" });
    await user.type(otp, "12345678");
    expect(fetch).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Confirmar código" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Código inválido. Confira os 8 dígitos e tente novamente.",
    );
    expect(document.activeElement).toBe(otp);
    expect((otp as HTMLInputElement).value).toBe("12345678");
  });
});

describe("callback OAuth seguro", () => {
  it("removes code and state before posting through BFF with CSRF", async () => {
    window.history.replaceState(
      {},
      "",
      "/entrar/discord/retorno?code=provider-secret&state=opaque-state-with-safe-length&purpose=sign-in",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "authenticated", nextPath: "/primeiro-acesso" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    );

    render(<OAuthCallbackForm />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(window.location.pathname).toBe("/entrar/discord/retorno");
    expect(window.location.search).toBe("");
    expect(document.documentElement.textContent).not.toContain("provider-secret");
    expect(document.documentElement.textContent).not.toContain("opaque-state");
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/platform/identity/oauth/discord/callback",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token-with-safe-length" }),
      }),
    );
    expect(await screen.findByRole("link", { name: "Continuar" })).toHaveAttribute(
      "href",
      "/primeiro-acesso",
    );
  });
});

describe("convite seguro", () => {
  it("removes the token before preview and accepts only after an explicit POST", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/convites/aceitar?token=invite-secret-token-value");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "valid",
              organization: { id: "org-1", name: "Liga da Comunidade", logoUrl: null },
              invitedBy: "Organizador",
              maskedEmail: "j•••@example.com",
              organizationRole: "member",
              assignments: [],
              expiresAt: "2026-08-28T12:00:00.000Z",
              emailMatches: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "accepted",
              organization: { id: "org-1", name: "Liga da Comunidade", slug: "liga" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    );

    render(<InvitationAcceptForm />);
    expect(await screen.findByRole("heading", { name: "Liga da Comunidade" })).toBeTruthy();
    expect(window.location.pathname).toBe("/convites/aceitar");
    expect(window.location.search).toBe("");
    expect(document.documentElement.textContent).not.toContain("invite-secret-token-value");
    expect(fetch).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Aceitar convite" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    const acceptInit = vi.mocked(fetch).mock.calls[3]?.[1];
    expect(acceptInit?.method).toBe("POST");
    expect(String(acceptInit?.body)).toBe(JSON.stringify({ confirmation: true }));
    expect(String(acceptInit?.body)).not.toContain("invite-secret");
    expect(await screen.findByRole("status")).toHaveTextContent("Convite aceito");
  });

  it.each([
    ["expired", "Este convite expirou"],
    ["revoked", "Este convite foi revogado"],
    ["used", "Este convite já foi utilizado"],
    ["invalid", "Não foi possível validar este convite"],
  ] as const)("shows the %s state without exposing provider detail", async (status, copy) => {
    window.history.replaceState({}, "", `/convites/aceitar?token=${status}-secret-token-value`);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status, ...(status === "used" ? { organizationSlug: "liga" } : {}) }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    );

    render(<InvitationAcceptForm />);
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(document.documentElement.textContent).not.toContain(`${status}-secret-token-value`);
  });
});
