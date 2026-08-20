# Contexto — Fase 1: Fundação modular e ambientes

## Resultado esperado

Um repositório que qualquer colaborador consiga instalar, validar e executar de forma previsível, com aplicações separadas e contratos claros para impedir que o crescimento do produto transforme o código em um monólito acoplado.

## Decisões bloqueadas

- Stack moderna e totalmente modular em TypeScript.
- `apps/web`, `apps/api`, `apps/worker` e `apps/discord-bot` são unidades de implantação independentes.
- PostgreSQL, Redis e armazenamento S3 compatível fazem parte do ambiente local.
- Drizzle é o ORM e a outbox transacional nasce nesta fase.
- Configuração validada, logs JSON e base de OpenTelemetry são compartilhados.
- A interface final não é escopo desta fase; a web recebe apenas uma tela técnica mínima e health endpoints.
- O repositório usa `main`, sem worktrees ou branches auxiliares nesta execução.

## Qualidade e operação

- Um comando documentado sobe o ambiente completo quando Docker está disponível.
- Liveness não depende de serviços externos; readiness valida dependências necessárias.
- CI executa lint, limites arquiteturais, typecheck, testes e build via Turborepo.
- Nenhum segredo real pode ser versionado.
- Cada tarefa e cada fechamento de plano gera commit próprio.

## Fora do escopo

- Autenticação, organizações e RBAC.
- Regras do campeonato e pontuação.
- Consumo real da API PUBG.
- Interface pública final, overlays e integração Discord ativa.
