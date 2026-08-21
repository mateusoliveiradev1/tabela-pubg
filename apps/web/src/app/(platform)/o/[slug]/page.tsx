import type { ShellOrganization } from "../../../../components/layout/app-shell";
import { FeedbackState, RoleBadge } from "../../../../components/ui/feedback";
import { loadPlatformOrganizations } from "../../layout";

type OverviewState = "authorized" | "permission" | "error" | "offline" | "session-expired";

interface OrganizationOverviewProps {
  organization: ShellOrganization | null;
  state: OverviewState;
}

export function OrganizationOverview({ organization, state }: OrganizationOverviewProps) {
  if (state !== "authorized" || !organization) {
    return (
      <section className="platform-page">
        <FeedbackState state={state === "permission" ? "permission" : state} />
      </section>
    );
  }

  return (
    <section className="platform-page organization-overview" aria-labelledby="organization-title">
      <header className="platform-page-header">
        <span className="eyebrow">VISÃO GERAL</span>
        <h1 id="organization-title">{organization.name}</h1>
        <RoleBadge tone={organization.membershipRole === "owner" ? "accent" : "neutral"}>
          {roleLabel(organization.membershipRole)}
        </RoleBadge>
      </header>
      <div className="organization-overview__grid">
        <article>
          <h2>Operação da comunidade</h2>
          <p>
            Organize membros, convites e responsabilidades antes de criar seu primeiro campeonato.
          </p>
          <a href={`/o/${organization.slug}/membros`}>Revisar equipe</a>
        </article>
        <article>
          <h2>Conta protegida</h2>
          <p>Revise suas formas de acesso e dispositivos ativos sempre que precisar.</p>
          <a href="/conta/sessoes">Revisar sessões</a>
        </article>
      </div>
    </section>
  );
}

export default async function OrganizationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await loadPlatformOrganizations();
  if (result.state !== "ready") {
    return <OrganizationOverview organization={null} state={result.state} />;
  }
  const organization = result.organizations.find((candidate) => candidate.slug === slug) ?? null;
  return (
    <OrganizationOverview
      organization={organization}
      state={organization ? "authorized" : "permission"}
    />
  );
}

function roleLabel(role: ShellOrganization["membershipRole"]): string {
  if (role === "owner") return "Proprietário";
  if (role === "admin") return "Administrador";
  return "Membro";
}
