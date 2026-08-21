---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-08-21T06:33:45.634Z"
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 27
  completed_plans: 14
  percent: 52
---

# Estado do projeto

## Posição atual

- Milestone: v1 completo
- Fase: 2 de 9 — Identidade, organizações e autorização
- Plano: 11 de 24 concluídos
- Status: execução em andamento; worker de e-mail transacional cifrado e idempotente concluído
- Progresso: 52% do milestone (14 de 27 planos)

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

## Bloqueadores

- Docker não está instalado nesta máquina. Código, Compose e CI passaram nos gates disponíveis, mas o smoke test dos contêineres requer um host com Docker.

## Continuidade

- Última ação: processor BullMQ, templates OTP/convite/novo dispositivo e adapter Resend 6.21.0 aprovados com 12 testes, captura HTTP e cleanup AES-GCM no plano 02-08.
- Próxima ação: implementar CSRF, guards default-deny e bootstrap seguro do plano 02-16.
- Arquivo de retomada: `.planning/phases/02-identidade-organizacoes-e-autorizacao/02-16-PLAN.md`
