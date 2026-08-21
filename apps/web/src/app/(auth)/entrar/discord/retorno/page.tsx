import { AuthShell } from "../../../../../components/identity/auth-shell";
import { OAuthCallbackForm } from "../../../../../components/identity/oauth-callback-form";

export default function DiscordCallbackPage() {
  return (
    <AuthShell
      title="Retorno seguro"
      description="Os dados do provedor são processados sem aparecer nesta tela."
    >
      <OAuthCallbackForm />
    </AuthShell>
  );
}
