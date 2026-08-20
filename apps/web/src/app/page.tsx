const modules = ["Web e overlays", "API", "Workers PUBG", "Bot Discord"];

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">PUBG CAMP PLATFORM</p>
      <h1>Fundação modular em execução</h1>
      <p className="lead">
        A estrutura técnica está pronta para receber organizações, campeonatos, dados PUBG e o
        pacote de transmissão nas próximas fases.
      </p>
      <ul>
        {modules.map((module) => (
          <li key={module}>{module}</li>
        ))}
      </ul>
      <p className="status">Health: /api/health/live · Readiness: /api/health/ready</p>
    </main>
  );
}
