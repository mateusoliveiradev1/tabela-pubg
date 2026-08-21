import { OrganizationLogoSettingsForm } from "../../../../../../components/organizations/organization-logo-field";
import { FeedbackState } from "../../../../../../components/ui/feedback";
import { loadPlatformOrganizations } from "../../../layout";

export const dynamic = "force-dynamic";

export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await loadPlatformOrganizations();
  if (result.state !== "ready") return <SettingsPageState state={result.state} />;
  const organization = result.organizations.find((candidate) => candidate.slug === slug);
  if (!organization?.capabilities.includes("organization:settings:manage")) {
    return <SettingsPageState state="permission" />;
  }

  return (
    <section className="platform-page" aria-labelledby="organization-settings-title">
      <header className="platform-page-header">
        <span className="eyebrow">ORGANIZAÇÃO</span>
        <h1 id="organization-settings-title">Identidade visual</h1>
        <p>Atualize o logo usado no seletor, nos convites e nas telas da sua comunidade.</p>
      </header>
      <OrganizationLogoSettingsForm organization={organization} />
    </section>
  );
}

function SettingsPageState({
  state,
}: {
  state: "permission" | "error" | "offline" | "session-expired";
}) {
  return (
    <section className="platform-page">
      <FeedbackState state={state} />
    </section>
  );
}
