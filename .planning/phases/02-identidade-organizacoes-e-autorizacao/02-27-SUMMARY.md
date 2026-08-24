---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 27
subsystem: identity
tags: [postgresql, opaque-sessions, sliding-expiry, trust, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    provides: Trust persistido e constraints provisional/trusted do plano 02-25
provides:
  - Token opaco de sessão de dispositivo gerado e devolvido por um único owner no repository
  - Emissão explícita de trust com limites trusted e provisional aplicados no PostgreSQL
  - Resolve-and-touch coalescido em cinco minutos com idle de 30 dias e teto absoluto de 90 dias
  - Contexto de autenticação de produção enriquecido com trust persistido
affects: [02-30, 02-35, 02-36, 02-42]

tech-stack:
  added: []
  patterns:
    - Repository-owned opaque credential com persistência digest-only
    - Conditional touch com predicados de usuário ativo e lifecycle fail-closed
    - Clock injetável para emissão e renovação determinísticas

key-files:
  created: []
  modified:
    - packages/database/src/repositories/sessions.ts
    - packages/database/test/session-alert-context.integration.spec.ts
    - apps/api/src/identity/session.service.ts
    - apps/api/src/identity/session.service.spec.ts
    - apps/api/src/identity/identity.runtime.ts
    - apps/api/src/main.ts

key-decisions:
  - "O repository é o único gerador do token em issueForDevice e devolve exatamente o token cujo digest persistiu."
  - "Trusted usa idle deslizante de 30 dias e teto absoluto de 90 dias; provisional permanece limitada a 15 minutos no repository."
  - "Autenticação de produção usa resolveAndTouchSession e propaga somente trust lido da sessão ativa persistida."

patterns-established:
  - "Single-owner token: a camada de serviço não gera credencial que o adapter possa descartar."
  - "Coalesced activity: antes de cinco minutos ocorre somente leitura; depois, update condicional preserva o teto absoluto."
  - "Lifecycle predicates: usuário ativo, revogação, idle e absolute expiry valem tanto no write quanto no fallback read."

requirements-completed: [AUTH-003, NFR-005]

duration: 25min
completed: 2026-08-24
---

# Phase 2 Plan 27: Opaque Session Lifecycle Summary

**Sessões opacas com token single-owner, trust persistido e renovação deslizante coalescida sob teto absoluto no PostgreSQL.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-24T10:06:54Z
- **Completed:** 2026-08-24T10:31:54Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- Eliminou o token descartado de `SessionService.startDeviceSession`: o cookie devolvido agora é exatamente o token gerado pelo repository e associado ao digest da linha inserida.
- Persistiu `provisional|trusted` explicitamente nos dois caminhos de emissão, limitando provisional a 15 minutos e trusted a idle de 30 dias sob cap absoluto de 90 dias.
- Adicionou `resolveAndTouchSession` com touch condicional a cada cinco minutos, predicados de usuário ativo/revogação/expiração e retorno de sessão, device e trust em ambos os caminhos.
- Substituiu o lookup read-only do bootstrap pelo lifecycle autoritativo e passou o trust persistido ao contexto de autenticação.

## Task Commits

A tarefa TDD produziu commits RED e GREEN separados:

1. **Task 1: Unificar origem do token e resolve-and-touch** — `b68881b` (RED), `2e211af` (GREEN)

## Files Created/Modified

- `packages/database/src/repositories/sessions.ts` — emissão trust-aware, limites provisional/trusted e resolve-and-touch coalescido.
- `packages/database/test/session-alert-context.integration.spec.ts` — contratos reais de digest/token, trust, touch/cap e negações sem mutação.
- `apps/api/src/identity/session.service.ts` — port de device session devolve o token do repository e exige trust explícito.
- `apps/api/src/identity/session.service.spec.ts` — prova que o serviço não fabrica token/alert token descartados.
- `apps/api/src/identity/identity.runtime.ts` — adapter persiste trust, injeta clock e encaminha `issued.token`.
- `apps/api/src/main.ts` — autenticação chama `resolveAndTouchSession` e propaga trust persistido.

## Decisions Made

- O repository de sessão de dispositivo possui a geração da credencial; o serviço apenas devolve o resultado persistido.
- O repository aplica limites de trust mesmo se um caller fornecer expiry maior, evitando depender somente da constraint do banco.
- Ordinary touch nunca rotaciona token; o update muda apenas `lastSeenAt`, `idleExpiresAt` e `updatedAt`, condicionado ao lifecycle ativo.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- A connection string Neon inicial usava pool transacional, incompatível com o `search_path` session-scoped do harness. O gate foi repetido no endpoint direto da mesma branch temporária, sem persistir a credencial.
- O gate completo permaneceu vermelho somente porque `runtime-security-migration.integration.spec.ts` excedeu o hook preexistente de 30 segundos durante setup multi-schema. O item foi registrado em `deferred-items.md`; nenhuma migration/tooling fora do escopo foi alterada.

## Known Stubs

None — o scan dos seis arquivos modificados encontrou apenas coleções vazias de fixture e checks de null legítimos, sem TODO, FIXME, placeholder ou data source de produção vazio.

## Verification

- `rtk pnpm --filter @pubg-camp/api exec vitest run src/identity/session.service.spec.ts src/identity/identity.runtime.spec.ts` — PASS; 2 arquivos e 11 testes.
- Lifecycle PostgreSQL em branch Neon run-scoped — PASS; `session-alert-context.integration.spec.ts` com 7/7 testes.
- `rtk pnpm phase2:integration` com PostgreSQL Neon direto + Redis real loopback — preflight PASS; 3/4 arquivos e 19 testes PASS; somente o hook histórico de migration excedeu 30 s, com 4 casos skipped.
- `rtk pnpm --filter @pubg-camp/database build` — PASS; ESM e declarações geradas.
- `rtk pnpm --filter @pubg-camp/api build` — PASS; TypeScript sem erros.
- `rtk pnpm exec biome check ...` nos sete arquivos do plano — PASS.
- Cleanup — PASS; branch Neon removida, Redis encerrado e nenhum diretório temporário restante.

## TDD Gate Compliance

- RED `b68881b` falhou porque o serviço devolvia `opaque-1`, token local descartado, em vez de `repository-token` persistido.
- GREEN `2e211af` veio depois do RED e passou unitários, lifecycle PostgreSQL, lint e builds.

## User Setup Required

None — nenhum segredo, serviço ou arquivo de configuração foi persistido.

## Next Phase Readiness

- O trust de sessão já chega ao runtime e está pronto para enforcement fail-closed no plano 02-35.
- Promoção provisional→trusted e trocas sensíveis podem reutilizar o token/digest autoritativo nos planos 02-30, 02-36 e 02-42.

## Self-Check: PASSED

- Os seis arquivos modificados e este SUMMARY existem no working tree.
- Os commits TDD `b68881b` e `2e211af` existem no histórico na ordem RED→GREEN.
- Nenhuma deleção rastreada, segredo persistido, processo Redis ou branch Neon temporária permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
