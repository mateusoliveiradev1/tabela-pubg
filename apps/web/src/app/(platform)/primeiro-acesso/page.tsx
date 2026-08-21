import { Building2, MailCheck } from "lucide-react";
import { cookies } from "next/headers";

interface FirstAccessChoicesProps {
  hasInvitationContext: boolean;
}

export function FirstAccessChoices({ hasInvitationContext }: FirstAccessChoicesProps) {
  const createOrganization = (
    <li className="first-access-card" key="create">
      <Building2 aria-hidden="true" size={28} />
      <div>
        <h2>Criar uma organização</h2>
        <p>Configure o espaço da sua comunidade e convide sua equipe.</p>
      </div>
      <a className="ui-button ui-button--primary" href="/organizacoes/nova">
        Criar organização
      </a>
    </li>
  );
  const invitation = (
    <li className="first-access-card" key="invitation">
      <MailCheck aria-hidden="true" size={28} />
      <div>
        <h2>Entrar por convite</h2>
        <p>
          {hasInvitationContext
            ? "Existe um convite pronto para revisão. Nada será aceito antes da sua confirmação."
            : "Use o link enviado por um organizador para revisar o acesso antes de aceitar."}
        </p>
      </div>
      <a className="ui-button ui-button--secondary" href="/convites/aceitar">
        {hasInvitationContext ? "Revisar convite" : "Usar link de convite"}
      </a>
    </li>
  );

  return (
    <section className="platform-page first-access" aria-labelledby="first-access-title">
      <header className="platform-page-header">
        <span className="eyebrow">PRIMEIRO ACESSO</span>
        <h1 id="first-access-title">Como você quer começar?</h1>
        <p>Escolha um caminho para revisar. A ação final sempre pedirá sua confirmação.</p>
      </header>
      <ul className="first-access-options" aria-label="Opções de primeiro acesso">
        {hasInvitationContext ? [invitation, createOrganization] : [createOrganization, invitation]}
      </ul>
    </section>
  );
}

export default async function FirstAccessPage() {
  const hasInvitationContext = (await cookies()).has("__Host-invitation-context");
  return <FirstAccessChoices hasInvitationContext={hasInvitationContext} />;
}
