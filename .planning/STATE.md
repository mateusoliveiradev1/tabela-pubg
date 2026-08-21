---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-08-21T09:06:50.288Z"
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 27
  completed_plans: 20
  percent: 74
---

# Estado do projeto

## Posição atual

- Milestone: v1 completo
- Fase: 2 de 9 — Identidade, organizações e autorização
- Plano: 17 de 24 concluídos
- Status: execução em andamento; upload, projeção e cleanup seguro de logos concluídos
- Progresso: 74% do milestone (20 de 27 planos)

## Decisões acumuladas

- Monorepo TypeScript com pnpm/Turborepo e aplicações implantáveis separadamente.
- Next.js App Router, NestJS/Fastify, PostgreSQL/Drizzle, Redis/BullMQ e S3 compatível.
- Execução sequencial no working tree principal, com commits atômicos por tarefa.
- Verificações humanas consolidadas ao final da fase.
- O preflight inicial da Fase 2 usa PostgreSQL Neon em branch isolada e Redis real loopback-only, sem persistir connection strings.
- A aprovação de PostgreSQL/Redis/migrations do plano 02-17 não aprova a CI final, reservada ao plano 02-24.
- Repositories de identidade e sessão persistem somente digests/HMAC; payloads temporários usam AES-256-GCM e o outbox recebe apenas `deliveryId`.
- Repositories tenant-owned exigem `organizationId` junto do recurso e gravam mutação, audit sanitizado e outbox no mesmo executor transacional.
- Convites e ownership serializam na linha da organização; as corridas usam duas conexões Neon diretas e nunca mock/PGlite.
- A matrix CI da Fase 2 redige logs e produz artifact por suite, mas sua execução remota continua reservada ao plano 02-24.
- OAuth, OTP e sessões dependem apenas de ports, Clock e RNG injetados; linking exige confirmação dual/step-up e alert context permanece read-only.
- Logos validam assinatura/estrutura PNG, JPEG e WebP antes do upload; banco guarda apenas metadata e key server-side.
- Cleanup de storage usa ledger sem FK de organização, outbox somente com `cleanupId` e claim com lease/retry idempotente.
- Verifier PKCE é one-use no Redis, indexado somente pelo digest do state; `documented-exception` exige evidence ID e repara para `required` sem migration.
- OAuth externo usa HTTP capturado nos testes e nunca devolve authorization URL, challengeId, sessionId ou provider token no JSON público.
- Jobs de notificação carregam somente `deliveryId`; recipient, OTP, convite e alert context permanecem cifrados até o worker e são apagados após entrega/expiração.
- Retry reutiliza a idempotency key da delivery; um resend de convite nasce como nova delivery com chave e token próprios.
- CSRF usa binding HMAC distinto para pre-auth e sessão, com rotação em autenticação e invalidação no logout.
- A API aplica SessionGuard, CsrfGuard e PermissionGuard globais; somente `@Public` pula sessão e ausência de permission metadata nega.
- Autorização resolve sessão e carrega snapshot tenant-aware diretamente do PostgreSQL em cada request, sem roles em cookie ou cache.
- Seleção de organização permanece explícita; criar ou listar organizações não altera tenant ativo em sessão ou cookie.
- Convite, audit, envelope cifrado e outbox são gravados na mesma transação; o worker recebe somente `deliveryId`.
- Auditoria aplica visibilidade, filtros, contagem e paginação no PostgreSQL antes da projeção redigida.
- Radix e Lucide ficam isolados nos primitivos locais; componentes de domínio recebem apenas capacidades já resolvidas.
- Specs TSX executam em jsdom e testes de route continuam em Node por projetos Vitest distintos.
- A UI usa quatro tamanhos, dois pesos e tokens globais grafite/teal; componentes TSX não codificam cores hexadecimais.
- O BFF aceita somente combinações path/method allowlisted e um `API_INTERNAL_ORIGIN` server-only sem credenciais ou path.
- O token CSRF retorna em header same-origin, é readquirido com os cookies rotacionados após autenticação e descartado no logout.
- O Next encaminha 401/403/404 e capabilities sem interpretar autorização; o Nest permanece a única autoridade RBAC.
- O desafio OTP permanece fora do JSON público e cruza o BFF apenas em header opaco allowlisted.
- Callback OAuth público é POST-only com CSRF; GET não processa `code` ou `state`.
- Contexto de convite sai da URL antes do preview e permanece em custódia HttpOnly curta até o POST explícito de aceite.
- Multipart de logo aceita somente `name`/`logo`, deriva metadata no servidor e nunca encaminha filename ou object key.
- Replace ativa o novo asset e enfileira cleanup do anterior na mesma transação; compensação de órfão usa transação independente.
- Worker de logo recebe somente `cleanupId` e resolve provider/key do ledger server-side.

## Bloqueadores

- Docker não está instalado nesta máquina. Código, Compose e CI passaram nos gates disponíveis, mas o smoke test dos contêineres requer um host com Docker.

## Continuidade

- Última ação: upload, URL segura e cleanup idempotente de logos concluídos no plano 02-22.
- Próxima ação: continuar a wave 10 conforme o orquestrador da Fase 2.
- Arquivo de retomada: nenhum; plano 02-22 completo.
