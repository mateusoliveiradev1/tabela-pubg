---
phase: 01-fundacao-modular-e-ambientes
plan: 02
subsystem: platform-runtime
tags: [nextjs, nestjs, fastify, drizzle, postgresql, redis, bullmq, s3, discord]
requires:
  - phase: 01-01
    provides: workspace e pacotes compartilhados
provides:
  - quatro aplicações implantáveis com health/readiness
  - schema Drizzle, migração inicial e outbox transacional
  - adaptadores Redis/BullMQ e S3
affects: [auth, tournaments, pubg-import, public-page, broadcast, discord]
tech-stack:
  added: [nextjs, react, nestjs, fastify, drizzle, postgres-js, bullmq, ioredis, aws-sdk, discord.js]
  patterns: [liveness-vs-readiness, graceful-shutdown, transactional-outbox, adapter-boundaries]
key-files:
  created: [packages/database/src/schema.ts, apps/api/src/health/health.controller.ts, apps/web/src/app/api/health/ready/route.ts, apps/worker/src/main.ts]
  modified: [pnpm-lock.yaml, pnpm-workspace.yaml]
key-decisions:
  - "Liveness nunca consulta infraestrutura; readiness consulta dependências com timeout."
  - "A outbox possui migração explícita e pode receber eventos dentro da transação de negócio."
patterns-established:
  - "Cada processo controla inicialização e encerramento de suas conexões."
  - "Uploads são negados fora da allowlist de MIME e tamanho."
requirements-completed: [NFR-001, NFR-004, NFR-005, NFR-007, NFR-009]
duration: 10min
completed: 2026-08-20
---

# Phase 1 Plan 2: Serviços e persistência Summary

**Next.js, NestJS/Fastify, worker BullMQ e bot Discord apoiados por Drizzle, Redis e S3 modularizados**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-20T21:03:00Z
- **Completed:** 2026-08-20T21:12:00Z
- **Tasks:** 2
- **Files modified:** 49

## Accomplishments

- Schema e migração inicial da outbox com índices de entrega e agregado.
- Quatro aplicações independentes, todas compilando e com sinais de saúde.
- 61 módulos e 75 dependências analisados sem violação arquitetural.

## Task Commits

1. **Implementar persistência, filas e armazenamento por adaptadores** — `9a74e6f` (feat)
2. **Criar web, API, worker e bot com health e readiness** — `9fafac1` (feat)

## Files Created/Modified

- `packages/database/src/schema.ts` — outbox e índices.
- `packages/database/migrations/0000_foundation.sql` — migração inicial.
- `packages/queue/src/index.ts` — conexões, filas e workers.
- `packages/storage/src/index.ts` — URLs assinadas e política de upload.
- `apps/web/src/app/api/health/ready/route.ts` — readiness web.
- `apps/api/src/health/health.controller.ts` — endpoints NestJS.
- `apps/worker/src/main.ts` — processo BullMQ e health Fastify.
- `apps/discord-bot/src/main.ts` — gateway Discord e health Fastify.

## Decisions Made

- Health usa o mesmo contrato Zod em todos os processos.
- A tela Next.js criada é deliberadamente técnica; o design do produto permanece para as fases 6 e 7.
- O guia de boas práticas React foi aplicado; os componentes são Server Components estáticos sem hidratação desnecessária.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Ajustes ESM do ioredis 6 e `rootDir` do Drizzle foram corrigidos antes do commit e cobertos por typecheck/build.

## User Setup Required

None - external credentials serão descritas no plano operacional 01-03.

## Next Phase Readiness

- Pronto para Compose, imagens Docker, CI e documentação no plano 01-03.

## Self-Check: PASSED

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` e `drizzle-kit check` passaram.
- Web gerou rotas estática e dinâmicas de health com Next.js 16.
- Commits das duas tarefas estão presentes.

---
*Phase: 01-fundacao-modular-e-ambientes*
*Completed: 2026-08-20*
