"use client";

import { Building2, ClipboardList, Menu, Settings, ShieldCheck, Users, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { EmptyState, FeedbackState } from "../ui/feedback";
import { OrganizationSwitcher, type OrganizationSwitcherItem } from "./organization-switcher";

export type ShellCapability =
  | "members:view"
  | "members:manage"
  | "audit:view"
  | "audit:view:self"
  | "organization:settings:manage";

export interface ShellOrganization extends OrganizationSwitcherItem {
  membershipRole: "owner" | "admin" | "member";
  capabilities: readonly ShellCapability[];
}

type ShellLoadState = "ready" | "loading" | "error" | "offline" | "session-expired";

interface AppShellProps {
  children: ReactNode;
  organizations: readonly ShellOrganization[];
  activeOrganizationSlug?: string | null;
  loadState?: ShellLoadState;
}

export function AppShell({
  children,
  organizations,
  activeOrganizationSlug,
  loadState = "ready",
}: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDrawerOpen(false);
      window.setTimeout(() => document.getElementById("platform-drawer-trigger")?.focus(), 0);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);
  const routeOrganizationSlug = organizationSlugFromPath(pathname);
  const resolvedSlug = activeOrganizationSlug ?? routeOrganizationSlug;
  const activeOrganization = organizations.find(
    (organization) => organization.slug === resolvedSlug,
  );
  const isOrganizationRoute = routeOrganizationSlug !== null;
  const isOnboardingRoute = pathname === "/primeiro-acesso" || pathname === "/organizacoes/nova";
  const isAccountRoute = pathname === "/conta" || pathname.startsWith("/conta/");

  if (loadState !== "ready") {
    return (
      <main className="platform-state" id="platform-content">
        <FeedbackState
          state={
            loadState === "loading"
              ? "loading"
              : loadState === "session-expired"
                ? "session-expired"
                : loadState
          }
          action={
            loadState === "session-expired" ? (
              <a className="ui-button ui-button--primary" href="/entrar?retorno=%2Fprimeiro-acesso">
                Entrar novamente
              </a>
            ) : null
          }
        />
      </main>
    );
  }

  if (organizations.length === 0 && !isOnboardingRoute && !isAccountRoute) {
    return (
      <main className="platform-state" id="platform-content">
        <EmptyState
          title="Você ainda não participa de uma organização"
          description="Crie uma organização para sua comunidade ou aceite um convite para colaborar."
          action={
            <a className="ui-button ui-button--primary" href="/primeiro-acesso">
              Começar
            </a>
          }
        />
      </main>
    );
  }

  if (isOrganizationRoute && !activeOrganization) {
    return (
      <main className="platform-state" id="platform-content">
        <FeedbackState state="permission" />
      </main>
    );
  }

  const capabilities = new Set(activeOrganization?.capabilities ?? []);
  const navigation = activeOrganization
    ? [
        {
          label: "Visão geral",
          href: `/o/${activeOrganization.slug}`,
          icon: Building2,
          visible: true,
        },
        {
          label: "Membros",
          href: `/o/${activeOrganization.slug}/membros`,
          icon: Users,
          visible: capabilities.has("members:view"),
        },
        {
          label: "Convites",
          href: `/o/${activeOrganization.slug}/convites`,
          icon: ClipboardList,
          visible: capabilities.has("members:manage"),
        },
        {
          label: "Auditoria",
          href: `/o/${activeOrganization.slug}/auditoria`,
          icon: ShieldCheck,
          visible: capabilities.has("audit:view") || capabilities.has("audit:view:self"),
        },
        {
          label: "Configurações",
          href: `/o/${activeOrganization.slug}/configuracoes`,
          icon: Settings,
          visible: capabilities.has("organization:settings:manage"),
        },
      ].filter((item) => item.visible)
    : [];

  return (
    <div className="platform-shell">
      <a className="skip-link" href="#platform-content">
        Pular para o conteúdo
      </a>
      <header className="platform-topbar">
        <Button
          className="platform-drawer-trigger"
          id="platform-drawer-trigger"
          size="icon"
          variant="ghost"
          aria-controls="platform-sidebar"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Fechar navegação" : "Abrir navegação"}
          onClick={() => setDrawerOpen((current) => !current)}
        >
          {drawerOpen ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
        </Button>
        <a className="platform-brand" href="/primeiro-acesso" aria-label="PUBG Camp">
          PUBG CAMP
        </a>
        <span className="platform-topbar__organization">
          {activeOrganization?.name ?? "Conta e segurança"}
        </span>
      </header>
      <aside
        className="platform-sidebar"
        data-open={drawerOpen || undefined}
        id="platform-sidebar"
        aria-label="Navegação principal"
      >
        <OrganizationSwitcher
          organizations={organizations}
          activeOrganizationSlug={activeOrganization?.slug ?? null}
        />
        {navigation.length > 0 ? (
          <nav aria-label="Organização">
            <ul className="platform-navigation">
              {navigation.map((item) => {
                const Icon = item.icon;
                const current = pathname === item.href;
                return (
                  <li key={item.href}>
                    <a aria-current={current ? "page" : undefined} href={item.href}>
                      <Icon aria-hidden="true" size={19} />
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
        <nav className="platform-account-navigation" aria-label="Conta e segurança">
          <a href="/conta/identidades">Formas de acesso</a>
          <a href="/conta/sessoes">Sessões e dispositivos</a>
        </nav>
      </aside>
      {drawerOpen ? (
        <button
          type="button"
          className="platform-drawer-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}
      <main className="platform-main" id="platform-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function organizationSlugFromPath(pathname: string): string | null {
  const match = /^\/o\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(pathname);
  return match?.[1] ?? null;
}
