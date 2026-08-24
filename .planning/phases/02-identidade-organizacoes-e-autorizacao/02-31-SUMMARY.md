---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 31
subsystem: identity
tags: [oauth, postgresql, session-binding, step-up, identity-proof, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 30
    provides: Sessões ativas e confirmação de método persistida em reauthenticated_at
provides:
  - Transações OAuth purpose-specific vinculadas a actor/session derivados da sessão ativa
  - Pré-requisito não circular para step-up e confirmação fresca exclusiva para link-identity
  - Candidate proofs server-side, expirantes e consumidas condicionalmente uma única vez
  - Projeção runtime sem perda de purpose, actorId, sessionId ou timestamp de confirmação
affects: [02-32, 02-37, 02-42]

tech-stack:
  added: []
  patterns:
    - Prerequisites OAuth derivados da sessão PostgreSQL ativa, nunca do callback
    - Consumo one-use por UPDATE condicional com binding de actor/session/candidate

key-files:
  created: []
  modified:
    - packages/database/src/repositories/identity.ts
    - packages/database/test/identity-organizations.integration.spec.ts
    - apps/api/src/identity/identity.runtime.ts
    - apps/api/src/identity/identity.runtime.spec.ts

key-decisions:
  - "Step-up OAuth exige somente a sessão autenticada ativa; link-identity exige reauthenticated_at da mesma sessão estritamente mais recente que dez minutos."
  - "A candidate proof guarda provider/subject/display somente no PostgreSQL e é consumida por ID opaco com binding e UPDATE condicional one-use."

patterns-established:
  - "OAuth purpose binding: sign-in não carrega actor/session; propósitos protegidos os derivam e persistem a partir de sessão ativa."
  - "Pending link proof: candidate server-side com TTL, binding actor/session e consumo condicional concorrente."

requirements-completed: [AUTH-001, AUTH-003, AUTH-006, NFR-005]

duration: 22 min
completed: 2026-08-24
---

# Phase 02 Plan 31: OAuth Purpose-Specific Proof Persistence Summary

**OAuth protegido agora preserva autoridade server-derived no PostgreSQL, permite step-up sem pré-prova circular e entrega candidate proofs expirantes e one-use para vínculo de identidade.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-24T11:31:43Z
- **Completed:** 2026-08-24T11:53:56Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Persistiu e recuperou `purpose`, actor/user e sessão para OAuth protegido sem aceitar promoção por troca de purpose no callback.
- Validou sessão ativa, usuário ativo, revogação e expirações; step-up não requer `reauthenticated_at`, enquanto link exige confirmação fresca da mesma sessão.
- Implementou criação e consumo de pending identity-link proofs com candidate data somente server-side, TTL, binding e exatamente um vencedor sob consumo concorrente.
- Preservou o timestamp de confirmação e o alias `actorId` na projeção runtime sem expor state, browser binding ou tokens.

## Task Commits

1. **TDD RED: regressões de persistência OAuth e candidate proof** - `b9d8dbf` (test)
2. **TDD GREEN: persistência purpose-specific e consumo bound one-use** - `93b17e6` (feat)
3. **Formatação das regressões de integração** - `a645df1` (style)

## Files Created/Modified

- `packages/database/src/repositories/identity.ts` - Valida prerequisites por purpose, persiste bindings e cria/consome proofs.
- `packages/database/test/identity-organizations.integration.spec.ts` - Matriz PostgreSQL positiva/negativa, expiry, replay e concorrência.
- `apps/api/src/identity/identity.runtime.ts` - Projeta purpose, actor/user, session e confirmação temporal sem perda.
- `apps/api/src/identity/identity.runtime.spec.ts` - Regressões unitárias da projeção protegida e sign-in sem autoridade.

## Verification

- `rtk pnpm --filter @pubg-camp/api exec vitest run src/identity/identity.runtime.spec.ts` - PASS, 3/3.
- API unit suite - PASS, 182 testes; 6 skips preexistentes de suites condicionais.
- Database unit suite - PASS, 22 testes; integrações condicionais não foram tratadas como evidência nesse comando.
- PostgreSQL direto + Redis efêmero - PASS no preflight e em `phase2:integration`, 3 arquivos e 33/33 testes selecionados.
- Typecheck de API e database - PASS.
- Build de API e database - PASS.
- Lint global e dependency boundaries - PASS; três warnings CSS preexistentes continuam registrados fora do escopo.

## Decisions Made

- A confirmação fresca para link é lida de `sessions.reauthenticated_at` e precisa estar no intervalo aberto de dez minutos; um timestamp ausente, futuro ou no limite é negado.
- Step-up usa somente a sessão autenticada ativa porque o próprio exchange OAuth é a reautenticação.
- A proof pending contém a candidate Discord server-side e requer actor, sessão e provider corretos no consumo.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

- O primeiro preflight falhou fechado porque o processo não herdou `DATABASE_URL`/`REDIS_URL`. O ambiente temporário foi reconstruído sem expor ou persistir segredos; o preflight e a suíte real passaram no endpoint PostgreSQL direto.

## Issues Encountered

- `runtime-security-migration.integration.spec.ts` manteve quatro skips por `beforeAll` exceder o `hookTimeout` de 30 segundos. É um problema preexistente do harness, já registrado em `deferred-items.md` no plano 02-27; os 33 testes selecionados deste run passaram e nenhum skip foi mascarado como sucesso.

## User Setup Required

None - os recursos temporários de verificação são gerenciados pelo orquestrador e não alteram a configuração do projeto.

## Next Phase Readiness

- O repository/runtime está pronto para 02-37 conectar os endpoints OAuth protegidos e para 02-42 consumir a proof dentro da mudança atômica D-08.
- O cleanup da branch Neon temporária e do Redis efêmero permanece com o orquestrador raiz após o fechamento da wave.

## Self-Check: PASSED

- Os quatro arquivos modificados existem e os commits RED, GREEN e de formatação foram encontrados no histórico.
- O SUMMARY existe no caminho esperado e as verificações automatizadas aplicáveis estão registradas acima.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
