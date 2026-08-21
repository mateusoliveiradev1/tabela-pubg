import { AuthShell } from "../../../../components/identity/auth-shell";
import { EmailOtpForm } from "../../../../components/identity/email-otp-form";

export default function EmailSignInPage() {
  return (
    <AuthShell
      title="Acesso sem senha"
      description="Receba um código temporário e continue com segurança."
    >
      <div className="auth-heading">
        <h2>Entre com seu e-mail</h2>
        <p>Não confirmamos publicamente se um endereço está cadastrado.</p>
      </div>
      <EmailOtpForm />
    </AuthShell>
  );
}
