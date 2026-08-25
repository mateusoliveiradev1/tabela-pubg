import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditEvent, AuditTimeline } from "../audit/audit-event";
import { ScopeRoleEditor } from "../authorization/scope-role-editor";
import {
  promoteSensitiveActionContinuation,
  storeSensitiveActionContinuation,
} from "../authorization/sensitive-action-continuation";
import { InvitationList } from "./invitation-list";
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
  sessionStorage.clear();
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
    expect(
      screen.getByText("Nenhum campeonato disponível para atribuir cargos operacionais."),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Editar permissões de Proprietária da Liga com um nome suficientemente longo para quebrar linhas",
        }) as HTMLButtonElement
      ).disabled,
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "accepted", retryAfterSeconds: 60 }), {
          status: 202,
          headers: { "x-otp-challenge-id": "00000000-0000-4000-8000-000000000099" },
        }),
      )
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "step-up-confirmed",
            validUntil: "2026-08-21T10:10:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
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
    await user.type(screen.getByRole("textbox", { name: "E-mail da conta" }), "liga@example.com");
    await user.click(screen.getByRole("button", { name: "Confirmar por e-mail" }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/platform/identity/email/otp/step-up/request",
      expect.objectContaining({ body: JSON.stringify({ email: "liga@example.com" }) }),
    );
    await user.type(screen.getByRole("textbox", { name: "Código de 8 dígitos" }), "12345678");
    await user.click(screen.getByRole("button", { name: "Validar código" }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/platform/identity/email/otp/step-up/verify",
      expect.objectContaining({
        body: JSON.stringify({
          challengeId: "00000000-0000-4000-8000-000000000099",
          email: "liga@example.com",
          code: "12345678",
        }),
      }),
    );
    expect(await screen.findByText("Identidade confirmada há menos de 10 minutos")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Salvar permissões" }));
    await user.click(screen.getByRole("button", { name: "Salvando…" }));

    expect(refreshed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(6);
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

  it("restaura uma continuação Discord exata e one-use antes do commit", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "updated" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const nonce = storeSensitiveActionContinuation(
      sessionStorage,
      {
        kind: "membership-role-change",
        organizationId,
        membershipId: memberId,
        draft: { organizationRole: "admin", assignments: [] },
      },
      "Continuação Discord auditável",
    );
    expect(promoteSensitiveActionContinuation(sessionStorage, nonce)).toBe(true);

    render(
      <MemberList
        organizationId={organizationId}
        organizationName="Liga Central"
        members={[{ ...owner, organizationRole: "member" }]}
        capabilities={["members:view", "members:manage"]}
        scopes={[]}
        onAuthoritativeRefresh={() => undefined}
      />,
    );

    expect(await screen.findByText("Identidade confirmada há menos de 10 minutos")).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "Motivo da alteração" }) as HTMLTextAreaElement).value,
    ).toBe("Continuação Discord auditável");
    await user.click(screen.getByRole("button", { name: "Salvar permissões" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/platform/organizations/${organizationId}/members/${memberId}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          organizationRole: "admin",
          assignments: [],
          reason: "Continuação Discord auditável",
        }),
      }),
    );
  });

  it("cancela por teclado sem enviar mutação e exige confirmação exata na transferência", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const target = {
      ...owner,
      id: "00000000-0000-4000-8000-000000000020",
      organizationRole: "member" as const,
      user: { ...owner.user, displayName: "Nova proprietária" },
    };

    render(
      <MemberList
        organizationId={organizationId}
        organizationName="Liga Central"
        members={[owner, target]}
        capabilities={["members:view", "members:manage", "organization:ownership:transfer"]}
        scopes={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Transferir propriedade" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Novo proprietário" }),
      target.id,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Digite o nome da organização" }),
      "Nome incorreto",
    );
    expect(
      (screen.getByRole("button", { name: "Revisar transferência" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await user.click(
      screen.getByRole("button", { name: /Editar permissões de Nova proprietária/ }),
    );
    await user.click(screen.getByRole("button", { name: "Revisar alteração" }));
    await user.type(screen.getByRole("textbox", { name: "Motivo da alteração" }), "Ajuste seguro");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "Revise o impacto" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("convites operacionais", () => {
  it("separa ativos e histórico, sem expor token ou link persistido", async () => {
    const user = userEvent.setup();
    render(
      <InvitationList
        organizationId={organizationId}
        capabilities={["invitations:manage"]}
        invitations={[
          invitation("active"),
          invitation("accepted", "00000000-0000-4000-8000-000000000006"),
        ]}
      />,
    );

    expect(screen.getByText("li•••@example.com")).toBeTruthy();
    expect(screen.getByText(/Uso único/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/https?:\/\/|token=/i);
    await user.click(screen.getByRole("tab", { name: "Histórico" }));
    expect(screen.getByText("Aceito")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Revogar convite/ })).toBeNull();
  });

  it("explica reenvio, usa CSRF e não altera a lista antes da resposta", async () => {
    const user = userEvent.setup();
    let finish: ((response: Response) => void) | undefined;
    const refreshed = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <InvitationList
        organizationId={organizationId}
        capabilities={["invitations:manage"]}
        invitations={[invitation("active")]}
        onAuthoritativeRefresh={refreshed}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reenviar convite" }));
    expect(screen.getByRole("dialog").textContent).toContain("invalida o anterior");
    await user.type(
      screen.getByRole("textbox", { name: "Motivo da alteração" }),
      "Novo prazo solicitado",
    );
    await user.click(screen.getByRole("button", { name: "Enviar novo convite" }));
    expect(screen.getByText("li•••@example.com")).toBeTruthy();
    expect(refreshed).not.toHaveBeenCalled();
    finish?.(
      new Response(JSON.stringify({ status: "reissued" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/platform/organizations/${organizationId}/invitations/${memberId}/resend`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("mostra vazio acionável e remove mutações quando a capability não existe", () => {
    const { rerender } = render(
      <InvitationList
        organizationId={organizationId}
        capabilities={["invitations:manage"]}
        invitations={[]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Nenhum convite ativo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Convidar membro" })).toBeTruthy();

    rerender(
      <InvitationList
        organizationId={organizationId}
        capabilities={[]}
        invitations={[invitation("active")]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Revogar convite" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reenviar convite" })).toBeNull();
  });
});

describe("auditoria redigida", () => {
  it("traduz evento e pares antes/depois sem JSON, segredo ou e-mail completo", async () => {
    const user = userEvent.setup();
    render(<AuditEvent event={auditEvent()} />);

    expect(screen.getByText("Permissões do membro atualizadas")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ver alterações" }));
    const changes = screen.getByRole("list", { name: "Alterações do evento" });
    expect(within(changes).getByText("Antes")).toBeTruthy();
    expect(within(changes).getByText("Depois")).toBeTruthy();
    expect(changes.textContent).toContain("Cargos operacionais");
    expect(document.body.textContent).not.toContain("correlationId");
    expect(document.body.textContent).not.toContain("organizer@example.com");
    expect(document.body.textContent).not.toContain("{");
  });

  it("mantém visibilidade própria, filtros na URL e paginação explícita", () => {
    render(
      <AuditTimeline
        organizationSlug="liga-central"
        visibility="self"
        events={[auditEvent()]}
        page={2}
        totalPages={3}
        filters={{ action: "membership.roles.updated", actorId: "actor-safe-id" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Minhas ações" })).toBeTruthy();
    expect(screen.getByText("Você está vendo somente ações realizadas por você.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Limpar filtros" }).getAttribute("href")).toBe(
      "/o/liga-central/auditoria",
    );
    const pagination = screen.getByRole("navigation", { name: "Paginação da auditoria" });
    expect(
      within(pagination).getByRole("link", { name: "Página anterior" }).getAttribute("href"),
    ).toContain("page=1");
    expect(
      within(pagination).getByRole("link", { name: "Próxima página" }).getAttribute("href"),
    ).toContain("page=3");
    expect(document.body.textContent).not.toContain("Auditoria completa");
  });

  it("distingue vazio com filtros sem ampliar visibilidade", () => {
    render(
      <AuditTimeline
        organizationSlug="liga-central"
        visibility="self"
        events={[]}
        page={1}
        totalPages={0}
        filters={{ action: "session.revoked" }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Nenhum evento corresponde aos filtros." }),
    ).toBeTruthy();
    expect(screen.getByText("Você está vendo somente ações realizadas por você.")).toBeTruthy();
  });
});

function csrfResponse() {
  return new Response(null, {
    status: 200,
    headers: { "x-csrf-token": "csrf-token-with-safe-length" },
  });
}

function invitation(status: "active" | "accepted" | "expired" | "revoked", id = memberId) {
  return {
    id,
    maskedEmail: "li•••@example.com",
    organizationRole: "member" as const,
    assignments: [],
    invitedBy: "Organizadora",
    status,
    createdAt: "2026-08-20T10:00:00.000Z",
    expiresAt: "2026-08-27T10:00:00.000Z",
  };
}

function auditEvent() {
  return {
    id: "00000000-0000-4000-8000-000000000009",
    actor: { displayName: "Organizadora", maskedEmail: "or•••@example.com" },
    action: "membership.roles.updated" as const,
    targetLabel: "Membro da transmissão",
    scopeLabel: "Camp da Comunidade",
    authorizationScopeId: scopeId,
    correlationId: "00000000-0000-4000-8000-000000000010",
    reason: "Mudança de escala",
    occurredAt: "2026-08-21T10:00:00.000Z",
    changes: [{ field: "operationalRoles" as const, before: "Analista", after: "Transmissão" }],
  };
}
