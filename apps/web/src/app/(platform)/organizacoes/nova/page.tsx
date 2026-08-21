import { CreateOrganizationForm } from "../../../../components/organizations/create-organization-form";

export default function NewOrganizationPage() {
  return (
    <section className="platform-page" aria-labelledby="new-organization-title">
      <header className="platform-page-header">
        <span className="eyebrow">NOVA ORGANIZAÇÃO</span>
        <h1 id="new-organization-title">Crie o espaço da sua comunidade</h1>
        <p>Comece com o nome e a identidade visual. Você poderá convidar a equipe em seguida.</p>
      </header>
      <CreateOrganizationForm />
    </section>
  );
}
