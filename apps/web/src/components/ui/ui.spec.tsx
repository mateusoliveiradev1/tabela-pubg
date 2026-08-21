import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import { AlertDialog, Dialog } from "./dialog";
import {
  EmptyState,
  FeedbackState,
  InlineAlert,
  RoleBadge,
  Skeleton,
  StatusBadge,
} from "./feedback";
import { Input } from "./input";
import { DropdownMenu, Tabs, Tooltip } from "./menu";
import { Toast, ToastProvider, ToastViewport } from "./toast";

afterEach(() => cleanup());

describe("form controls", () => {
  it("provides accessible labels, descriptions and a verbal loading state", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Input
          label="E-mail"
          name="email"
          type="email"
          helperText="Enviaremos um código temporário."
          error="Informe um e-mail válido."
        />
        <Button loading loadingLabel="Enviando…" onClick={() => undefined}>
          Receber código
        </Button>
      </div>,
    );

    const input = screen.getByRole("textbox", { name: "E-mail" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("error");
    expect(screen.getByRole("alert").textContent).toContain("Informe um e-mail válido.");

    const button = screen.getByRole("button", { name: "Enviando…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
  });
});

describe("layered interactions", () => {
  it("closes a dialog with Escape and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(
      <Dialog
        trigger="Editar membro"
        title="Editar permissões"
        description="Revise o papel antes de salvar."
      >
        <Button>Salvar permissões</Button>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Editar membro" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Editar permissões" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fechar" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("requires an explicit alert-dialog choice and restores focus on cancel", async () => {
    const user = userEvent.setup();
    render(
      <AlertDialog
        trigger="Encerrar sessão"
        title="Encerrar sessão"
        description="Este dispositivo perderá o acesso imediatamente."
        confirmLabel="Encerrar sessão"
        onConfirm={() => undefined}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Encerrar sessão" });
    await user.click(trigger);
    expect(screen.getByRole("alertdialog", { name: "Encerrar sessão" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(document.activeElement).toBe(trigger);
  });
});

describe("keyboard navigation", () => {
  it("supports arrows and Escape in dropdown menus", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        trigger="Mais ações"
        items={[
          { label: "Editar permissões", onSelect: () => undefined },
          { label: "Revogar acesso", onSelect: () => undefined, destructive: true },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Mais ações" });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Editar permissões" }),
    );
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Revogar acesso" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("moves between tabs with arrow keys and exposes tooltip text on focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tabs
          label="Detalhes do membro"
          tabs={[
            { value: "perfil", label: "Perfil", content: "Dados do perfil" },
            { value: "permissoes", label: "Permissões", content: "Dados das permissões" },
          ]}
        />
        <Tooltip content="Transfira a propriedade antes de alterar este membro.">
          <button type="button">Regra de proprietário</button>
        </Tooltip>
      </>,
    );

    const profile = screen.getByRole("tab", { name: "Perfil" });
    profile.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Permissões" }));

    await user.tab();
    await user.tab();
    expect(
      await screen.findByRole("tooltip", {
        name: "Transfira a propriedade antes de alterar este membro.",
      }),
    ).toBeTruthy();
  });
});

describe("feedback", () => {
  it("announces urgent, passive and toast feedback without moving focus", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <button type="button">Manter foco</button>
        <InlineAlert tone="danger" title="Não foi possível concluir">
          Tente novamente.
        </InlineAlert>
        <InlineAlert tone="info">Seus dados estão atualizados.</InlineAlert>
        <Toast title="Organização criada" description="A equipe já pode ser convidada." />
        <ToastViewport label="Notificações" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Manter foco" }));
    expect(screen.getByRole("alert").textContent).toContain("Tente novamente.");
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(2);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Manter foco" }));
  });

  it("renders complete operational states and semantic badges", () => {
    render(
      <>
        <StatusBadge tone="accent">Este dispositivo</StatusBadge>
        <RoleBadge>Proprietário</RoleBadge>
        <FeedbackState state="offline" />
        <FeedbackState state="permission" />
        <FeedbackState state="session-expired" action={<Button>Entrar novamente</Button>} />
        <EmptyState
          title="Você ainda não participa de uma organização"
          description="Crie uma organização para sua comunidade ou aceite um convite para colaborar."
        />
        <div aria-label="Carregando membros" role="status">
          <Skeleton width="100%" height={48} />
        </div>
      </>,
    );

    expect(screen.getByText("Este dispositivo").textContent).toBeTruthy();
    expect(screen.getByText("Proprietário").textContent).toBeTruthy();
    expect(screen.getByText("Sem conexão. Nenhuma alteração foi enviada.")).toBeTruthy();
    expect(
      screen.getByText(
        "Não foi possível abrir esta área. Volte para uma organização à qual você tenha acesso.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Sua sessão expirou")).toBeTruthy();
    expect(
      screen.getByLabelText("Carregando membros").querySelector("[aria-hidden='true']"),
    ).toBeTruthy();
  });
});

describe("visual contract", () => {
  it("keeps the approved palette, target sizes, focus ring and reduced motion", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    for (const token of ["#090c11", "#131923", "#45d6c8", "#ff6b6b", "#f4f7fa", "#aab4c3"]) {
      expect(css.toLowerCase()).toContain(token);
    }
    expect(css).toMatch(/--control-height:\s*44px/);
    expect(css).toMatch(/--control-height-auth:\s*48px/);
    expect(css).toMatch(/outline:\s*2px solid var\(--color-accent\)/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (max-width: 320px)");
  });

  it("does not hardcode hexadecimal colors inside primitives", () => {
    const primitiveFiles = [
      "button.tsx",
      "input.tsx",
      "dialog.tsx",
      "menu.tsx",
      "toast.tsx",
      "feedback.tsx",
    ];
    for (const file of primitiveFiles) {
      const source = readFileSync(resolve(process.cwd(), "src/components/ui", file), "utf8");
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});
