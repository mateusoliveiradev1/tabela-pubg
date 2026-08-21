import { AuthShell } from "../../../components/identity/auth-shell";
import { DiscordButton } from "../../../components/identity/discord-button";
import { EmailOtpForm } from "../../../components/identity/email-otp-form";

export default function SignInPage() {
  return (
    <AuthShell>
      <div className="auth-heading">
        <h2>Entre na plataforma</h2>
        <p>Use o Discord para continuar ou receba um código temporário por e-mail.</p>
      </div>
      <DiscordButton />
      <div className="auth-divider">
        <span>ou use seu e-mail</span>
      </div>
      <EmailOtpForm />
      <a className="auth-privacy-link" href="/privacidade">
        Política de privacidade
      </a>
    </AuthShell>
  );
}
