---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 26
subsystem: worker
tags: [postgresql, bullmq, redis, outbox, idempotency, notifications]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    provides: State machine de outbox com claim token, lease, retry e publicação terminal do plano 02-25
provides:
  - Publisher PostgreSQL→BullMQ com mapeamento estrito para jobs UUID-only
  - Job idempotente derivado do UUID do evento de outbox
  - Lifecycle readiness-first e shutdown ordenado de publisher, filas, workers e conexões
  - Terminalidade de delivery condicionada à persistência ou vencedor concorrente equivalente
affects: [02-27, 02-30, 02-31, 02-35, 02-36]

tech-stack:
  added: []
  patterns:
    - Lease-owned publication com jobId durável e retry redigido
    - Readiness PostgreSQL/Redis/BullMQ antes de iniciar publisher e health listener
    - Compare-and-reload para confirmar outcome terminal de notificação

key-files:
  created:
    - apps/worker/src/outbox/publisher.ts
    - apps/worker/src/outbox/publisher.spec.ts
  modified:
    - apps/worker/src/main.ts
    - apps/worker/src/notifications/processor.ts
    - apps/worker/src/notifications/processor.spec.ts

key-decisions:
  - "Jobs BullMQ carregam somente deliveryId ou cleanupId e usam o UUID do evento como jobId."
  - "Queue e Worker precisam concluir waitUntilReady antes do publisher iniciar e do servidor anunciar readiness."
  - "Falha de clear só é idempotente quando o reload encontra exatamente o mesmo estado terminal persistido."

patterns-established:
  - "Opaque queue boundary: type/version/payload/event id são validados antes de qualquer acesso à fila."
  - "Durable replay: enqueue resolvido pode marcar published; falha ou lease perdida tenta retry estável sem texto de provider."
  - "Ordered shutdown: publisher→queues→workers→server→database→Redis→storage→telemetry, protegido contra sinais repetidos."

requirements-completed: [AUTH-002, ORG-002, NFR-005]

duration: 9min
completed: 2026-08-24
---

# Phase 2 Plan 26: Durable Outbox Publisher Summary

**Publisher lease-safe transforma commits do outbox em jobs BullMQ opacos e idempotentes, com lifecycle readiness-first e outcomes de delivery confirmados no PostgreSQL.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-24T09:53:31Z
- **Completed:** 2026-08-24T10:02:34Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Mapeou `notification.delivery.requested` e `storage.logo.cleanup` versão 1 para filas fixas contendo somente UUID, sempre com `jobId = outbox.id`.
- Preservou retry durável em payload inválido, falha de enqueue, transição PostgreSQL falha e lease perdida, sem copiar mensagens de provider ou payload para banco/logs.
- Compôs producers, consumers e publisher somente após PostgreSQL, Redis, Queue e Worker confirmarem readiness.
- Endureceu o processor para nunca retornar `delivered`/`expired` quando `clear()` falha, aceitando somente o mesmo outcome terminal confirmado por reload.

## Task Commits

As duas tarefas TDD produziram commits RED e GREEN separados:

1. **Task 1: Publicar claims do outbox com job id idempotente** — `2947140` (RED), `e76d1ea` (GREEN)
2. **Task 2: Compor publisher e endurecer terminalidade do delivery** — `cd35c1e` (RED), `ab55c1e` (GREEN)

## Files Created/Modified

- `apps/worker/src/outbox/publisher.ts` — publisher injetável com claim bounded, mapper estrito, retry estável e polling abortável.
- `apps/worker/src/outbox/publisher.spec.ts` — contratos de mapeamento, replay, falha, lease, continuação parcial e drain no stop.
- `apps/worker/src/main.ts` — readiness e lifecycle conjunto de producers, consumers, publisher, health server e conexões.
- `apps/worker/src/notifications/processor.ts` — confirmação persistida de delivered/expired com reload de concorrência.
- `apps/worker/src/notifications/processor.spec.ts` — negativos de clear perdido e vencedor terminal concorrente.

## Decisions Made

- Um retorno resolvido de `Queue.add` é sucesso idempotente inclusive em replay; somente depois dele o publisher tenta marcar o evento como published.
- `markPublished=false` nunca produz sucesso falso: o publisher tenta retry com o mesmo claim token e deixa a lease recuperável se ownership já foi perdida.
- Startup falha fechado e executa cleanup ordenado caso PostgreSQL, Redis, Queue ou Worker não confirmem readiness.
- Erros de startup, fila e shutdown são registrados somente por categoria/componente, sem incluir exception, connection string ou payload.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Context7 não estava instalado e o fallback Bash estava indisponível no host Windows. A API BullMQ 6 foi confirmada na documentação oficial e nas declarações locais da versão instalada 6.1.2 (`waitUntilReady`, `add` e `close`).

## Known Stubs

None — o scan dos cinco arquivos criados/modificados não encontrou TODO, FIXME, placeholders ou data sources vazios.

## Verification

- `rtk pnpm --filter @pubg-camp/worker test -- outbox/publisher` — PASS; 35 testes após a Tarefa 1.
- `rtk pnpm --filter @pubg-camp/worker test -- notifications/processor` — PASS; 38 testes após a Tarefa 2.
- `rtk pnpm --filter @pubg-camp/worker test` — PASS; 6 arquivos e 38 testes.
- `rtk pnpm --filter @pubg-camp/worker build` — PASS; bundle ESM gerado com sucesso.
- `rtk pnpm --filter @pubg-camp/worker typecheck` — PASS.
- `rtk pnpm exec biome check ...` nos cinco arquivos — PASS.
- Gate estrutural de readiness/shutdown — PASS em 11/11 relações de ordem e idempotência.

## TDD Gate Compliance

- Task 1: RED `2947140` precede GREEN `e76d1ea`.
- Task 2: RED `cd35c1e` precede GREEN `ab55c1e`.
- Ambos os RED falharam pelos comportamentos ainda ausentes; ambos os GREEN passaram a suíte completa.

## User Setup Required

None — nenhuma credencial, serviço externo ou configuração adicional foi persistida.

## Next Phase Readiness

- O caminho commit PostgreSQL→outbox→BullMQ→processor está pronto para OTP, convites, alertas e logo cleanup.
- O plano 02-27 pode consumir o lifecycle completo ao promover trust de sessão no runtime.

## Self-Check: PASSED

- Os cinco arquivos criados/modificados existem.
- Os quatro commits TDD existem no histórico: `2947140`, `e76d1ea`, `cd35c1e`, `ab55c1e`.
- Nenhuma deleção rastreada, segredo persistido ou arquivo gerado não rastreado permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
