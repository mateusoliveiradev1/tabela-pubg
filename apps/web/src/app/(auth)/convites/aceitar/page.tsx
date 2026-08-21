import { AuthShell } from "../../../../components/identity/auth-shell";
import { InvitationAcceptForm } from "../../../../components/identity/invitation-accept-form";

export default function AcceptInvitationPage() {
  return (
    <AuthShell
      title="Colabore com a comunidade"
      description="Revise a organização antes de confirmar seu acesso."
    >
      <InvitationAcceptForm />
    </AuthShell>
  );
}
