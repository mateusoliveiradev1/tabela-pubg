import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, type ShellOrganization } from "../layout/app-shell";
import { OrganizationLogoField, OrganizationLogoSettingsForm } from "./organization-logo-field";

const organization: ShellOrganization = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "liga-central",
  name: "Liga Central",
  logoUrl: "/branding/organization-fallback.svg",
  membershipRole: "owner",
  capabilities: ["members:view", "organization:settings:manage"],
};

const NativeUrl = globalThis.URL;

beforeEach(() => {
  class TestUrl extends NativeUrl {}
  Object.defineProperties(TestUrl, {
    createObjectURL: { value: vi.fn((file: File) => `blob:${file.name}`) },
    revokeObjectURL: { value: vi.fn() },
  });
  vi.stubGlobal("URL", TestUrl);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("campo acessível de logo", () => {
  it("aceita teclado/drop, mantém a seleção diante de arquivo inválido e revoga previews", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender, unmount } = render(
      <OrganizationLogoField value={null} onChange={onChange} />,
    );
    const input = screen.getByLabelText("Selecionar logo") as HTMLInputElement;
    const first = new File([new Uint8Array(64)], "liga.png", { type: "image/png" });
    await user.upload(input, first);
    expect(onChange).toHaveBeenLastCalledWith(first);

    rerender(<OrganizationLogoField value={first} onChange={onChange} />);
    expect(
      screen.getByRole("img", { name: "Prévia do logo selecionado" }).getAttribute("src"),
    ).toBe("blob:liga.png");

    const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "grande.webp", {
      type: "image/webp",
    });
    fireEvent.drop(screen.getByTestId("organization-logo-dropzone"), {
      dataTransfer: { files: [oversized] },
    });
    expect((await screen.findByRole("alert")).textContent).toContain("até 2 MiB");
    expect(onChange).not.toHaveBeenCalledWith(null);

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:liga.png");
  });

  it("remove a seleção explicitamente e mantém a validação do servidor como autoridade", async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array(64)], "liga.webp", { type: "image/webp" });
    const onChange = vi.fn();
    render(<OrganizationLogoField value={file} onChange={onChange} />);

    expect(screen.getByText(/servidor confirma o conteúdo/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remover logo" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("configurações autoritativas de branding", () => {
  it("envia multipart com CSRF, preserva nome no erro e só troca a URL após sucesso", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(null, { status: 415 }))
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "00000000-0000-4000-8000-000000000099",
            detectedMime: "image/png",
            byteSize: 64,
            url: "https://assets.example.test/signed/logo",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<OrganizationLogoSettingsForm organization={organization} onRefresh={refresh} />);
    const logo = new File([new Uint8Array(64)], "novo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Selecionar logo"), logo);
    await user.click(screen.getByRole("button", { name: "Salvar logo" }));

    expect((await screen.findByRole("alert")).textContent).toContain("servidor recusou");
    expect(screen.getByDisplayValue("Liga Central")).toBeTruthy();
    expect(screen.getByText("novo.png")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Salvar logo" }));
    expect((await screen.findByRole("status")).textContent).toContain("Logo atualizado");
    expect(
      screen.getByRole("img", { name: "Logo atual de Liga Central" }).getAttribute("src"),
    ).toBe("https://assets.example.test/signed/logo");
    expect(refresh).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[3]?.[1] as RequestInit;
    expect(request.method).toBe("PUT");
    expect(request.headers).toEqual(
      expect.objectContaining({ "x-csrf-token": "csrf-token-with-safe-length" }),
    );
    expect(request.body).toBeInstanceOf(FormData);
  });

  it("mostra Configurações somente quando a capability veio no shell", () => {
    const { rerender } = render(
      <AppShell organizations={[organization]} activeOrganizationSlug={organization.slug}>
        <span>conteúdo</span>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Configurações" }).getAttribute("href")).toBe(
      "/o/liga-central/configuracoes",
    );

    rerender(
      <AppShell
        organizations={[{ ...organization, capabilities: ["members:view"] }]}
        activeOrganizationSlug={organization.slug}
      >
        <span>conteúdo</span>
      </AppShell>,
    );
    expect(screen.queryByRole("link", { name: "Configurações" })).toBeNull();
  });
});

function csrfResponse() {
  return new Response(null, {
    status: 200,
    headers: { "x-csrf-token": "csrf-token-with-safe-length" },
  });
}
