"use client";

import { AuthShell } from "../../components/identity/auth-shell";
import { Button } from "../../components/ui/button";
import { InlineAlert } from "../../components/ui/feedback";

export default function AuthError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthShell title="Acesso protegido" description="Nenhum dado sensível foi exibido.">
      <InlineAlert
        tone="danger"
        title="Não foi possível concluir esta ação"
        action={<Button onClick={reset}>Tentar novamente</Button>}
      >
        Tente novamente; se o problema continuar, procure o suporte.
      </InlineAlert>
    </AuthShell>
  );
}
