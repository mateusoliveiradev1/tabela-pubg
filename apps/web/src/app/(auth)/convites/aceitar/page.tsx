import type { Metadata } from "next";
import { AuthShell } from "../../../../components/identity/auth-shell";
import { InvitationAcceptForm } from "../../../../components/identity/invitation-accept-form";

export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function AcceptInvitationPage() {
  // InvitationAcceptForm consumes only the redacted preview logoUrl after removing token context.
  return (
    <AuthShell
      title="Colabore com a comunidade"
      description="Revise a organização antes de confirmar seu acesso."
    >
      <InvitationAcceptForm />
    </AuthShell>
  );
}
