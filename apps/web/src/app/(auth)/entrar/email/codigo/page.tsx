import { AuthShell } from "../../../../../components/identity/auth-shell";
import { EmailOtpForm } from "../../../../../components/identity/email-otp-form";

export default function EmailCodePage() {
  return (
    <AuthShell
      title="Confirme seu acesso"
      description="O código nunca é enviado automaticamente nem fica salvo."
    >
      <div className="auth-heading">
        <h2>Solicite um novo código</h2>
        <p>Por segurança, comece informando novamente o e-mail que receberá o código.</p>
      </div>
      <EmailOtpForm />
    </AuthShell>
  );
}
