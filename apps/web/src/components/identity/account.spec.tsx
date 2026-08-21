import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationOverview } from "../../app/(platform)/o/[slug]/page";
import { FirstAccessChoices } from "../../app/(platform)/primeiro-acesso/page";
import { AppShell, type ShellOrganization } from "../layout/app-shell";
import { OrganizationSwitcher } from "../layout/organization-switcher";

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
      "#conteudo-principal",
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
    expect(screen.getByRole("main").id).toBe("conteudo-principal");
  });

  it("mostra estado seguro quando não existe organização autorizada", () => {
    render(
      <AppShell organizations={[]} activeOrganizationSlug={null} loadState="ready">
        <span>não deve aparecer</span>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { name: "Você ainda não participa de uma organização" })).toBeTruthy();
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
    expect(within(results).getByRole("link", { name: /Arena 8/ }).getAttribute("href")).toBe(
      "/o/arena-8",
    );
    expect(within(results).queryByRole("link", { name: /Arena 1/ })).toBeNull();
  });
});

describe("primeiro acesso e overview", () => {
  it("prioriza convite válido sem executar aceite ao selecionar", async () => {
    const user = userEvent.setup();
    render(<FirstAccessChoices hasInvitationContext />);

    const options = screen.getByRole("list", { name: "Opções de primeiro acesso" });
    expect(within(options).getAllByRole("listitem")[0]?.textContent).toContain("Entrar por convite");
    await user.click(screen.getByRole("link", { name: "Revisar convite" }));
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
