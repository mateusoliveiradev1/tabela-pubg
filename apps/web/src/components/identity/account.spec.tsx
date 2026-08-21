import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationOverview } from "../../app/(platform)/o/[slug]/page";
import { FirstAccessChoices } from "../../app/(platform)/primeiro-acesso/page";
import { AppShell, type ShellOrganization } from "../layout/app-shell";
import { OrganizationSwitcher } from "../layout/organization-switcher";
import { CreateOrganizationForm } from "../organizations/create-organization-form";
import { SessionsPanel } from "./device-session-card";
import { IdentityCards } from "./identity-cards";

const organizations: ShellOrganization[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "liga-central",
    name: "Liga Central",
    logoUrl: null,
    membershipRole: "owner",
    capabilities: ["members:view", "members:manage", "audit:view", "organization:settings:manage"],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "arena-sul",
    name: "Arena Sul",
    logoUrl: null,
    membershipRole: "member",
    capabilities: ["members:view", "audit:view:self"],
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("platform shell e organização explícita", () => {
  it("mantém a organização ativa na URL e limita a navegação às capabilities do servidor", () => {
    render(
      <AppShell organizations={organizations} activeOrganizationSlug="liga-central">
        <h1>Painel</h1>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Pular para o conteúdo" }).getAttribute("href")).toBe(
      "#platform-content",
    );
    expect(screen.getByRole("link", { name: "Visão geral" }).getAttribute("href")).toBe(
      "/o/liga-central",
    );
    expect(screen.getByRole("link", { name: "Membros" }).getAttribute("href")).toBe(
      "/o/liga-central/membros",
    );
    expect(screen.getByRole("link", { name: "Convites" }).getAttribute("href")).toBe(
      "/o/liga-central/convites",
    );
    expect(screen.getByRole("main").id).toBe("platform-content");
  });

  it("mostra estado seguro quando não existe organização autorizada", () => {
    render(
      <AppShell organizations={[]} activeOrganizationSlug={null} loadState="ready">
        <span>não deve aparecer</span>
      </AppShell>,
    );

    expect(
      screen.getByRole("heading", { name: "Você ainda não participa de uma organização" }),
    ).toBeTruthy();
    expect(screen.queryByText("não deve aparecer")).toBeNull();
  });

  it("habilita busca a partir de oito organizações sem persistir seleção na sessão", async () => {
    const user = userEvent.setup();
    const manyOrganizations = Array.from({ length: 8 }, (_, index) => ({
      ...organizations[1],
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      slug: `arena-${index + 1}`,
      name: `Arena ${index + 1}`,
    }));

    render(
      <OrganizationSwitcher organizations={manyOrganizations} activeOrganizationSlug="arena-1" />,
    );
    await user.type(screen.getByRole("searchbox", { name: "Buscar organização" }), "Arena 8");

    const results = screen.getByRole("list", { name: "Organizações" });
    expect(
      within(results)
        .getByRole("link", { name: /Arena 8/ })
        .getAttribute("href"),
    ).toBe("/o/arena-8");
    expect(within(results).queryByRole("link", { name: /Arena 1/ })).toBeNull();
  });
});

describe("primeiro acesso e overview", () => {
  it("prioriza convite válido sem executar aceite ao selecionar", async () => {
    const user = userEvent.setup();
    render(<FirstAccessChoices hasInvitationContext />);

    const options = screen.getByRole("list", { name: "Opções de primeiro acesso" });
    expect(within(options).getAllByRole("listitem")[0]?.textContent).toContain(
      "Entrar por convite",
    );
    await user.tab();
    expect(screen.getByRole("link", { name: "Revisar convite" }).getAttribute("href")).toBe(
      "/convites/aceitar",
    );
  });

  it("renderiza overview autorizado e uniformiza permission/cross-tenant", () => {
    const { rerender } = render(
      <OrganizationOverview organization={organizations[0]} state="authorized" />,
    );
    expect(screen.getByRole("heading", { name: "Liga Central" })).toBeTruthy();
    expect(screen.getByText("Proprietário")).toBeTruthy();

    rerender(<OrganizationOverview organization={null} state="permission" />);
    expect(
      screen.getByText(
        "Não foi possível abrir esta área. Volte para uma organização à qual você tenha acesso.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("organização inexistente");
  });
});

describe("criação de organização", () => {
  it("valida logo, preserva o formulário em erro e só navega após confirmação", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organization: {
              id: "00000000-0000-4000-8000-000000000008",
              slug: "liga-do-bairro",
              name: "Liga do Bairro",
              logoUrl: null,
              membershipRole: "owner",
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateOrganizationForm onNavigate={navigate} />);
    const name = screen.getByRole("textbox", { name: "Nome da organização" });
    await user.type(name, "Liga do Bairro");
    await user.upload(
      screen.getByLabelText(/Selecionar logo/),
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], "grande.png", { type: "image/png" }),
    );
    expect(screen.getByRole("alert").textContent).toContain("até 2 MiB");

    await user.click(screen.getByRole("button", { name: "Criar organização" }));
    expect(await screen.findByText("Este nome não está disponível ou é inválido.")).toBeTruthy();
    expect((name as HTMLInputElement).value).toBe("Liga do Bairro");
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Criar organização" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/o/liga-do-bairro/membros"));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/platform/organizations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token-with-safe-length" }),
      }),
    );
  });
});

describe("formas de acesso", () => {
  it("não remove a última identidade e confirma vínculo explicitamente sem estado otimista", async () => {
    const user = userEvent.setup();
    let finishLink: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishLink = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <IdentityCards
        identities={[
          {
            id: "00000000-0000-4000-8000-000000000010",
            provider: "discord",
            status: "verified",
            displayIdentifier: "li•••a",
            linkedAt: "2026-08-20T10:00:00.000Z",
          },
        ]}
        pendingLink={{
          id: "00000000-0000-4000-8000-000000000011",
          provider: "email",
          displayIdentifier: "l•••@example.com",
        }}
        onRefresh={() => undefined}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Desvincular Discord" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Confirmar vínculo de e-mail" }));
    expect(screen.getByRole("dialog").textContent).toContain("Contas nunca são unidas");
    expect(document.body.textContent).toContain("l•••@example.com");
    expect(document.body.textContent).not.toContain("00000000-0000-4000-8000-000000000011");

    await user.click(screen.getByRole("button", { name: "Vincular identidade" }));
    expect(screen.getByRole("button", { name: "Vinculando…" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Vínculo concluído");
    finishLink?.(
      new Response(
        JSON.stringify({ status: "linked", provider: "email", otherSessionsRevoked: 2 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(
      await screen.findByText("Vínculo concluído. Encerramos 2 outras sessões por segurança."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/platform/identity/identities/link/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          candidateIdentityId: "00000000-0000-4000-8000-000000000011",
          confirmation: true,
        }),
      }),
    );
  });

  it("mantém conflito de vínculo não enumerável", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(new Response(null, { status: 409 })),
    );
    render(
      <IdentityCards
        identities={[
          {
            id: "00000000-0000-4000-8000-000000000010",
            provider: "discord",
            status: "verified",
            displayIdentifier: "li•••a",
            linkedAt: "2026-08-20T10:00:00.000Z",
          },
        ]}
        pendingLink={{
          id: "00000000-0000-4000-8000-000000000011",
          provider: "email",
          displayIdentifier: "l•••@example.com",
        }}
        onRefresh={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Confirmar vínculo de e-mail" }));
    await user.click(screen.getByRole("button", { name: "Vincular identidade" }));

    expect(
      await screen.findByText(
        "Esta forma de acesso já está vinculada a outra conta. Nenhuma conta foi unida.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("usuário proprietário");
  });
});

describe("sessões e alertas de novo acesso", () => {
  it("ordena a sessão atual, destaca alerta ativo e nunca mostra IP ou fingerprint", () => {
    const sessions = [session(2), session(1, { isCurrent: true }), session(3)];
    render(
      <SessionsPanel
        sessions={sessions}
        alertStatus="active"
        highlightedSessionId={sessions[0]?.id ?? null}
      />,
    );

    const cards = screen.getAllByRole("article");
    expect(cards[0]?.textContent).toContain("Este dispositivo");
    expect(cards[1]?.textContent).toContain("Novo acesso");
    expect(screen.getByRole("alert").textContent).toContain("Revise este dispositivo");
    expect(document.body.textContent).not.toMatch(/192\.168|fingerprint|endereço IP/i);
  });

  it("mantém a sessão até o POST com CSRF ser confirmado pelo servidor", async () => {
    const user = userEvent.setup();
    const target = session(2);
    const current = session(1, { isCurrent: true });
    const changed = vi.fn();
    let finishRevoke: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishRevoke = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionsPanel sessions={[target, current]} onAuthoritativeChange={changed} />);

    const targetCard = screen
      .getByRole("heading", { name: target.device.label })
      .closest("article") as HTMLElement;
    await user.click(within(targetCard).getByRole("button", { name: "Encerrar sessão" }));
    await user.click(screen.getByRole("button", { name: "Encerrar sessão agora" }));

    expect(targetCard.isConnected).toBe(true);
    expect(targetCard.textContent).toContain(target.device.label);
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Encerrando…" })).toBeTruthy();
    finishRevoke?.(
      new Response(JSON.stringify({ status: "revoked", revokedSessionId: target.id }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/platform/identity/sessions/${target.id}/revoke`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token-with-safe-length" }),
      }),
    );
  });

  it.each([
    ["revoked", "Esta sessão já foi encerrada."],
    ["expired", "Não encontramos esta sessão. Ela pode ter expirado ou já ter sido removida."],
    ["not-found", "Não encontramos esta sessão. Ela pode ter expirado ou já ter sido removida."],
  ] as const)("apresenta alerta %s sem revelar identificador", (alertStatus, copy) => {
    render(
      <SessionsPanel sessions={[session(1, { isCurrent: true })]} alertStatus={alertStatus} />,
    );
    expect(screen.getByText(copy)).toBeTruthy();
    expect(document.body.textContent).not.toContain("alert-context-secret");
  });

  it("trata zero sessões como inconsistência e suporta vinte dispositivos", () => {
    const { rerender } = render(<SessionsPanel sessions={[]} />);
    expect(
      screen.getByRole("heading", { name: "Não foi possível confirmar sua sessão" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Entrar novamente" })).toBeTruthy();

    rerender(
      <SessionsPanel
        sessions={Array.from({ length: 20 }, (_, index) =>
          session(index + 1, { isCurrent: index === 0 }),
        )}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(20);
  });
});

function session(
  index: number,
  overrides: Partial<{
    isCurrent: boolean;
    status: "active" | "revoked" | "expired";
  }> = {},
) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    device: {
      label: `Dispositivo ${index}`,
      browser: index % 2 === 0 ? "Chrome" : "Firefox",
      operatingSystem: index % 2 === 0 ? "Windows" : "Linux",
    },
    approximateLocation: index % 2 === 0 ? "São Paulo, Brasil" : null,
    createdAt: "2026-08-20T10:00:00.000Z",
    lastSeenAt: "2026-08-21T09:00:00.000Z",
    idleExpiresAt: "2026-08-22T09:00:00.000Z",
    absoluteExpiresAt: "2026-09-20T10:00:00.000Z",
    isCurrent: overrides.isCurrent ?? false,
    status: overrides.status ?? "active",
  };
}

function csrfResponse(token = "csrf-token-with-safe-length") {
  return new Response(null, { status: 200, headers: { "x-csrf-token": token } });
}
