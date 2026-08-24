import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  vi.unstubAllEnvs();
});

function csrfResponse(token = "csrf-token-with-safe-length") {
  return new Response(null, { status: 200, headers: { "x-csrf-token": token } });
}

describe("login Discord-first", () => {
  it("uses a native POST navigation so the browser can follow Discord without exposing its URL", async () => {
    const user = userEvent.setup();
    const submitted: Array<{ action: string; method: string; fields: Record<string, string> }> = [];
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function submit(
      this: HTMLFormElement,
    ) {
      submitted.push({
        action: this.action,
        method: this.method,
        fields: Object.fromEntries(new FormData(this).entries()) as Record<string, string>,
      });
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(csrfResponse()));

    render(<DiscordButton returnPath="/primeiro-acesso" />);
    await user.click(screen.getByRole("button", { name: "Continuar com Discord" }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(submitted[0]).toEqual({
      action: "http://localhost:3000/api/platform/identity/oauth/discord/sign-in/start",
      method: "post",
      fields: {
        csrfToken: "csrf-token-with-safe-length",
        purpose: "sign-in",
        returnPath: "/primeiro-acesso",
      },
    });
    expect(document.documentElement.innerHTML).not.toContain("discord.com/oauth2/authorize");
    expect(document.documentElement.innerHTML).not.toContain("state=");
    expect(document.documentElement.innerHTML).not.toContain("code_challenge");
  });

  it("blocks duplicate Discord starts and keeps the provider URL out of the DOM", async () => {
    const user = userEvent.setup();
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined);
    let finishCsrf: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishCsrf = resolve;
          }),
      ),
    );

    render(<DiscordButton />);
    const button = screen.getByRole("button", { name: "Continuar com Discord" });
    await user.dblClick(button);

    expect(
      (screen.getByRole("button", { name: "Abrindo Discord…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("state=");

    finishCsrf?.(csrfResponse());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
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
      "/api/platform/identity/email/otp/sign-in/request",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token-with-safe-length" }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toEqual({
      email: "jogador@example.com",
    });
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
    expect(vi.mocked(fetch).mock.calls[3]?.[0]).toBe(
      "/api/platform/identity/email/otp/sign-in/verify",
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
      "/api/platform/identity/oauth/discord/sign-in/callback",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token-with-safe-length" }),
      }),
    );
    expect((await screen.findByRole("link", { name: "Continuar" })).getAttribute("href")).toBe(
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
              organization: {
                id: "org-1",
                name: "Liga da Comunidade",
                logoUrl: "/branding/signed/liga?expires=300&signature=opaque",
              },
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
    const logo = screen.getByRole("img", { name: "Logo da organização Liga da Comunidade" });
    expect(logo.getAttribute("src")).toBe("/branding/signed/liga?expires=300&signature=opaque");
    expect(logo.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(fetch).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Aceitar convite" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    const acceptInit = vi.mocked(fetch).mock.calls[3]?.[1];
    expect(acceptInit?.method).toBe("POST");
    expect(String(acceptInit?.body)).toBe(JSON.stringify({ confirmation: true }));
    expect(String(acceptInit?.body)).not.toContain("invite-secret");
    expect((await screen.findByRole("status")).textContent).toContain("Convite aceito");
  });

  it("renders a signed logo from the normalized second approved origin without a referrer", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS",
      "https://primary.example.test, https://logos.example.test:443",
    );
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
              organization: {
                name: "Liga da Comunidade",
                logoUrl: "https://logos.example.test/liga.png?expires=300&signature=opaque",
              },
              invitedBy: "Organizador",
              maskedEmail: "j***@example.com",
              organizationRole: "member",
              expiresAt: "2026-08-28T12:00:00.000Z",
              emailMatches: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    );

    render(<InvitationAcceptForm />);

    const logo = await screen.findByRole("img", {
      name: "Logo da organiza\u00e7\u00e3o Liga da Comunidade",
    });
    expect(logo.getAttribute("src")).toBe(
      "https://logos.example.test/liga.png?expires=300&signature=opaque",
    );
    expect(logo.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("uses the local fallback for a signed logo from an unapproved origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS", "https://logos.example.test");
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
              organization: {
                name: "Camps do Interior",
                logoUrl: "https://unapproved.example.test/logo.png?signature=opaque",
              },
              invitedBy: "Organizador",
              maskedEmail: "c***@example.com",
              organizationRole: "member",
              expiresAt: "2026-08-28T12:00:00.000Z",
              emailMatches: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    );

    render(<InvitationAcceptForm />);

    expect(await screen.findByText("CI")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("não monta imagem antes do preview e usa iniciais quando a URL assinada falha", async () => {
    window.history.replaceState({}, "", "/convites/aceitar?token=invite-secret-token-value");
    let finishPreview: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finishPreview = resolve;
            }),
        ),
    );

    render(<InvitationAcceptForm />);
    expect(window.location.search).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.documentElement.innerHTML).not.toContain("invite-secret-token-value");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    finishPreview?.(
      new Response(
        JSON.stringify({
          status: "valid",
          organization: {
            name: "Camps do Interior",
            logoUrl: "/branding/signed/interior?expires=300&signature=opaque",
          },
          invitedBy: "Organizador",
          maskedEmail: "c•••@example.com",
          organizationRole: "member",
          expiresAt: "2026-08-28T12:00:00.000Z",
          emailMatches: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const image = await screen.findByRole("img", {
      name: "Logo da organização Camps do Interior",
    });
    fireEvent.error(image);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("CI").getAttribute("aria-hidden")).toBe("true");
    expect(document.documentElement.textContent).not.toContain("signature=opaque");
  });

  it("não amplia dados de organização em estados terminais", async () => {
    window.history.replaceState({}, "", "/convites/aceitar?token=revoked-secret-token-value");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "revoked",
              organization: {
                name: "Tenant que não deve aparecer",
                logoUrl: "/private/object-key/logo.png",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    );

    render(<InvitationAcceptForm />);
    expect(await screen.findByText("Este convite foi revogado")).toBeTruthy();
    expect(document.documentElement.textContent).not.toContain("Tenant que não deve aparecer");
    expect(document.documentElement.innerHTML).not.toContain("object-key");
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
          new Response(
            JSON.stringify({ status, ...(status === "used" ? { organizationSlug: "liga" } : {}) }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
    );

    render(<InvitationAcceptForm />);
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(document.documentElement.textContent).not.toContain(`${status}-secret-token-value`);
  });
});
