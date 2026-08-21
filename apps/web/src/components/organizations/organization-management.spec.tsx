import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScopeRoleEditor } from "../authorization/scope-role-editor";
import { MemberList } from "./member-list";

const organizationId = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
const scopeId = "00000000-0000-4000-8000-000000000003";

const owner = {
  id: memberId,
  user: {
    id: "00000000-0000-4000-8000-000000000004",
    displayName: "Proprietária da Liga com um nome suficientemente longo para quebrar linhas",
    maskedEmail: "li•••@example.com",
  },
  organizationRole: "owner" as const,
  status: "active" as const,
  assignments: [],
  joinedAt: "2026-08-20T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("membros e permissões autoritativas", () => {
  it("preserva todas as informações no layout responsivo e protege o único proprietário", () => {
    render(
      <MemberList
        organizationId={organizationId}
        organizationName="Liga Central"
        members={[owner]}
        capabilities={["members:view", "members:manage", "ownership:transfer"]}
        scopes={[]}
      />,
    );

    const row = screen.getByRole("article", { name: /Proprietária da Liga/ });
    expect(row.textContent).toContain(owner.user.maskedEmail);
    expect(row.textContent).toContain("Proprietário");
    expect(row.textContent).toContain("Ativo");
    expect(screen.getByText("1 membro")).toBeTruthy();
    expect(screen.getByText("Nenhum campeonato disponível para atribuir cargos operacionais."))
      .toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Editar permissões de Proprietária da Liga com um nome suficientemente longo para quebrar linhas" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(document.body.textContent).toContain(
      "Transfira a propriedade antes de alterar este membro.",
    );
  });

  it("não cria controles de mutação sem capability entregue pelo servidor", () => {
    render(
      <MemberList
        organizationId={organizationId}
        organizationName="Liga Central"
        members={[{ ...owner, organizationRole: "member" }]}
        capabilities={["members:view"]}
        scopes={[]}
      />,
    );

    expect(screen.queryByRole("button", { name: /Editar permissões/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Revogar acesso/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Transferir propriedade/ })).toBeNull();
  });

  it("separa papel global, cargos por campeonato e capacidades resultantes", () => {
    render(
      <ScopeRoleEditor
        member={owner}
        scopes={[
          {
            id: scopeId,
            name: "Camp da Comunidade",
            roles: ["referee", "registrations", "broadcast", "analyst"],
          },
        ]}
        capabilities={["members:manage", "matches:score", "broadcast:operate"]}
        protectedOwner={false}
        onRequestCommit={() => undefined}
      />,
    );

    expect(screen.getByRole("group", { name: "Papel na organização" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Cargos por campeonato" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Árbitro — Camp da Comunidade" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Transmissão — Camp da Comunidade" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Permissões resultantes" }).textContent).toContain(
      "Operar transmissão",
    );
    expect(document.body.textContent).not.toContain("acesso total");
  });

  it("preserva motivo no step-up, impede submit duplicado e atualiza só após resposta", async () => {
    const user = userEvent.setup();
    let finishMutation: ((response: Response) => void) | undefined;
    const refreshed = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishMutation = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberList
        organizationId={organizationId}
        organizationName="Liga Central"
        members={[{ ...owner, organizationRole: "member" }]}
        capabilities={["members:view", "members:manage"]}
        scopes={[]}
        onAuthoritativeRefresh={refreshed}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Editar permissões/ }));
    await user.click(screen.getByRole("radio", { name: "Administrador" }));
    await user.click(screen.getByRole("button", { name: "Revisar alteração" }));
    const reason = screen.getByRole("textbox", { name: "Motivo da alteração" });
    await user.type(reason, "Mudança na equipe de organização");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("heading", { name: "Confirme que é você" })).toBeTruthy();
    expect((reason as HTMLTextAreaElement).value).toBe("Mudança na equipe de organização");
    await user.click(screen.getByRole("button", { name: "Confirmar por e-mail" }));
    await user.click(screen.getByRole("button", { name: "Salvar permissões" }));
    await user.click(screen.getByRole("button", { name: "Salvando…" }));

    expect(refreshed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finishMutation?.(
      new Response(JSON.stringify({ status: "updated", membership: owner }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Permissões atualizadas")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/platform/organizations/${organizationId}/members/${memberId}`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token-with-safe-length" }),
      }),
    );
  });
});

function csrfResponse() {
  return new Response(null, {
    status: 200,
    headers: { "x-csrf-token": "csrf-token-with-safe-length" },
  });
}
