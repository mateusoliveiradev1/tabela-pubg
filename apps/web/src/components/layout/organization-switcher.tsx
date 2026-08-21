"use client";

import { Building2, ChevronDown, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

export interface OrganizationSwitcherItem {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
}

interface OrganizationSwitcherProps {
  organizations: readonly OrganizationSwitcherItem[];
  activeOrganizationSlug: string | null;
}

export function OrganizationSwitcher({
  organizations,
  activeOrganizationSlug,
}: OrganizationSwitcherProps) {
  const [query, setQuery] = useState("");
  const activeOrganization = organizations.find(
    (organization) => organization.slug === activeOrganizationSlug,
  );
  const searchable = organizations.length >= 8;
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const filteredOrganizations = useMemo(
    () =>
      normalizedQuery
        ? organizations.filter((organization) =>
            organization.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
          )
        : organizations,
    [normalizedQuery, organizations],
  );

  if (!searchable) {
    return (
      <div className="organization-switcher organization-switcher--compact">
        <label className="organization-switcher__label" htmlFor="organization-switcher-select">
          Organização
        </label>
        <div className="organization-switcher__select-wrap">
          <Building2 aria-hidden="true" size={18} />
          <select
            id="organization-switcher-select"
            value={activeOrganization?.slug ?? ""}
            onChange={(event) => navigateToOrganization(event.currentTarget.value)}
          >
            <option value="">Selecione uma organização</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.slug}>
                {organization.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={18} />
        </div>
        <a className="organization-switcher__create" href="/organizacoes/nova">
          <Plus aria-hidden="true" size={16} />
          Criar organização
        </a>
      </div>
    );
  }

  return (
    <div className="organization-switcher">
      <span className="organization-switcher__label">Organização</span>
      <strong className="organization-switcher__active">
        <Building2 aria-hidden="true" size={18} />
        {activeOrganization?.name ?? "Selecione uma organização"}
      </strong>
      <label className="organization-switcher__search">
        <span className="sr-only">Buscar organização</span>
        <Search aria-hidden="true" size={17} />
        <input
          aria-label="Buscar organização"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Buscar organização"
        />
      </label>
      <ul className="organization-switcher__results" aria-label="Organizações">
        {filteredOrganizations.map((organization) => (
          <li key={organization.id}>
            <a
              aria-current={organization.slug === activeOrganizationSlug ? "page" : undefined}
              href={`/o/${organization.slug}`}
            >
              {organization.name}
            </a>
          </li>
        ))}
      </ul>
      {filteredOrganizations.length === 0 ? (
        <p className="organization-switcher__empty" role="status">
          Nenhuma organização encontrada.
        </p>
      ) : null}
      <a className="organization-switcher__create" href="/organizacoes/nova">
        <Plus aria-hidden="true" size={16} />
        Criar organização
      </a>
    </div>
  );
}

function navigateToOrganization(slug: string): void {
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return;
  window.location.assign(`/o/${slug}`);
}
