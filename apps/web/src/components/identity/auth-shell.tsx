import type { ReactNode } from "react";

interface AuthShellProps {
  children: ReactNode;
  eyebrow?: string;
  title?: string;
  description?: string;
}

export function AuthShell({
  children,
  eyebrow = "PUBG CAMP",
  title = "Campeonatos organizados, transmissões impecáveis.",
  description = "A operação da sua comunidade, das inscrições ao placar ao vivo, em um só lugar.",
}: AuthShellProps) {
  return (
    <main className="auth-shell">
      <section className="auth-shell__intro" aria-labelledby="auth-platform-title">
        <span className="eyebrow">{eyebrow}</span>
        <h1 id="auth-platform-title">{title}</h1>
        <p>{description}</p>
      </section>
      <div className="auth-shell__form-column">
        <section className="auth-card">{children}</section>
      </div>
    </main>
  );
}
