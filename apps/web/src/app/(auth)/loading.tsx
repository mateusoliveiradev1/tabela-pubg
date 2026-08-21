export default function AuthLoading() {
  return (
    <main className="auth-shell" aria-busy="true" aria-label="Carregando acesso">
      <section className="auth-shell__intro">
        <span className="eyebrow">PUBG CAMP</span>
        <h1>Preparando acesso seguro</h1>
      </section>
      <div className="auth-shell__form-column">
        <section className="auth-card" role="status">
          Carregando…
        </section>
      </div>
    </main>
  );
}
