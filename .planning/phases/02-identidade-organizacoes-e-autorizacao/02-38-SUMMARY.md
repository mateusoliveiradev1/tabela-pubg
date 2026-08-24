---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 38
subsystem: routing-contracts
tags: [bff, nestjs, fastify, contracts, authorization]

requires:
  - phase: 02-32
    provides: controllers reais de sessões e gestão de identidades no módulo Nest composto
provides:
  - manifesto canônico das 39 combinações method/path expostas pelo BFF
  - matchers BFF compilados do manifesto com materialização segura de UUIDs
  - contrato contra o router Fastify/Nest realmente inicializado
affects: [02-39, 02-40, phase-2-verification, web-bff, api-routing]

tech-stack:
  added: []
  patterns:
    - inventário declarativo compartilhado como fonte única BFF→Nest
    - templates Fastify registrados validados junto de amostras concretas do BFF

key-files:
  created:
    - packages/contracts/src/platform-route-inventory.ts
    - packages/contracts/src/platform-route-inventory.spec.ts
  modified:
    - packages/contracts/src/index.ts
    - apps/api/src/app.module.spec.ts
    - apps/web/src/app/api/platform/[...path]/route.ts
    - apps/web/src/app/api/platform/[...path]/route.spec.ts

key-decisions:
  - "Cada combinação method/path ocupa uma entrada própria, inclusive quando métodos compartilham o mesmo template."
  - "No Fastify 5, hasRoute recebe o template registrado; a amostra concreta prova separadamente matching e materialização upstream."

patterns-established:
  - "Rotas dinâmicas usam somente captures UUID nomeados definidos pelo manifesto."
  - "Contexto tenant é extraído exclusivamente do capture indicado pela própria rota."

requirements-completed: [AUTH-003, AUTH-005, ORG-002, ORG-003, NFR-005]

duration: 8min
completed: 2026-08-24
---

# Phase 02 Plan 38: Inventário canônico BFF→Nest Summary

**Manifesto compartilhado de 39 rotas que compila o allowlist do BFF e prova cada upstream contra o router Nest/Fastify real**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-24T14:32:22Z
- **Completed:** 2026-08-24T14:40:35Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- Fixou exatamente as 39 combinações method/path de produção, com amostra concreta, template upstream, limite de corpo, rotação CSRF, política de referrer e extractor tenant quando aplicável.
- Substituiu o allowlist duplicado do BFF por matchers compilados de `PlatformRouteInventory`, mantendo headers tenant do navegador descartados e contexto derivado da rota.
- Inicializou o módulo Nest real e confirmou via `Fastify.hasRoute` todas as rotas do manifesto, incluindo sessões e identidades do plano 02-32.
- Removeu a rota sintética `__e2e/logos` do inventário e handler de produção.

## Task Commits

O ciclo TDD foi registrado atomicamente:

1. **RED — contrato falhando do inventário canônico** — `28a79d7` (test)
2. **GREEN — manifesto compartilhado e BFF compilado** — `fb6936e` (feat)

## Files Created/Modified

- `packages/contracts/src/platform-route-inventory.ts` — fonte canônica, compilador de templates UUID e materializador upstream.
- `packages/contracts/src/platform-route-inventory.spec.ts` — lista exata, unicidade, amostras concretas e invariantes tenant.
- `packages/contracts/src/index.ts` — export público do inventário.
- `apps/api/src/app.module.spec.ts` — contrato de registro contra a aplicação Nest composta.
- `apps/web/src/app/api/platform/[...path]/route.ts` — BFF compilado do manifesto compartilhado.
- `apps/web/src/app/api/platform/[...path]/route.spec.ts` — regressão que rejeita o antigo handler sintético.

## Decisions Made

- Entradas são normalizadas por combinação method/path, evitando regras agrupadas que poderiam esconder duplicatas ou diferenças de metadata.
- Como o Fastify 5 exige o template exatamente registrado em `hasRoute`, o teste usa `upstreamPath` para o router e valida `samplePath`/`upstreamSamplePath` no contrato compartilhado.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `rtk pnpm --filter @pubg-camp/contracts exec vitest run src/platform-route-inventory.spec.ts` — 3 testes aprovados.
- `rtk pnpm --filter @pubg-camp/api exec vitest run src/app.module.spec.ts` — 2 testes aprovados contra Nest/Fastify real.
- `rtk pnpm --filter @pubg-camp/web exec vitest run "src/app/api/platform/[...path]/route.spec.ts"` — 30 testes aprovados.
- Typecheck de contracts, API e web aprovado; Biome aprovado nos seis arquivos do plano.

## Next Phase Readiness

- O contrato BFF→Nest está fechado para os planos restantes de gap closure e para a nova verificação da Fase 2.
- Nenhum bloqueador novo; permanece apenas o bloqueador Docker já registrado no estado do projeto.

## Self-Check: PASSED

- Os seis arquivos do plano e este SUMMARY existem no worktree.
- Os commits TDD `28a79d7` e `fb6936e` existem no histórico.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
