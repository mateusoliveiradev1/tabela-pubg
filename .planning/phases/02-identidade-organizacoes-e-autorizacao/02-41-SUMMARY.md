---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 41
subsystem: auth
tags: [redis, oauth-pkce, rate-limiting, run-scope, vitest]

requires:
  - phase: 02-36
    provides: Runtime durável de identidade, OTP e composição Redis dos adapters
provides:
  - Um contrato discriminado que resolve prefixes Redis estáveis de produção ou isolados por runScopeId
  - Prova Redis real de isolamento entre limiters e stores PKCE de duas execuções concorrentes
  - Preflight fail-closed que valida e pinga o mesmo TEST_REDIS_URL selecionado pelo spec
affects: [02-33, 02-39, phase2-e2e, phase2-ci]

tech-stack:
  added: []
  patterns:
    - Um runScopeId canônico governa todos os prefixes Redis de identidade de uma execução
    - Cleanup de integração usa SCAN e UNLINK somente após revalidar o escopo exato

key-files:
  created: []
  modified:
    - apps/api/src/identity/identity.runtime.ts
    - apps/api/src/identity/identity.runtime.spec.ts
    - apps/api/src/identity/adapters/redis-auth-rate-limiter.ts
    - apps/api/src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts
    - scripts/run-phase2-integration.mjs

key-decisions:
  - "Produção mantém explicitamente pubg-camp:auth e pubg-camp:oauth:pkce; somente mode=run aceita um runScopeId fornecido pelo caller."
  - "TEST_REDIS_URL, quando presente, é o endpoint selecionado pelo spec e também recebe PING do preflight; REDIS_URL continua obrigatório."

patterns-established:
  - "Identity Redis scope: validar antes de abrir Redis e derivar auth/PKCE do mesmo valor byte-for-byte."
  - "Redis fixture ownership: preservar sentinelas estrangeiras, limpar cada run somente pelo seu prefix exato e remover a sentinela de produção explicitamente."

requirements-completed: [AUTH-001, AUTH-002, AUTH-003, NFR-005]

duration: 16min
completed: 2026-08-24
---

# Phase 02 Plan 41: Identity Redis Run Scoping Summary

**Prefixes Redis de limiter e OAuth PKCE agora são estáveis em produção e derivados de um único runScopeId validado em testes, com isolamento e cleanup comprovados contra Redis real.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-24T13:40:47.262Z
- **Completed:** 2026-08-24T13:56:25.646Z
- **Tasks:** 1
- **Files modified:** 5

## Accomplishments

- Adicionou `IdentityRedisScope` e `resolveIdentityRedisPrefixes`, rejeitando escopos ausentes, amplos, malformados, com whitespace/separadores e fora de 19–67 caracteres antes de abrir Redis.
- Passou explicitamente os prefixes estáveis ou run-scoped aos adapters reais e fez os próprios construtores recusarem prefixes vazios, amplos ou escapáveis.
- Tornou o spec Redis incondicional e não-skippable, com limiter isolado, PKCE cross-run negado/one-use e cleanup `SCAN` + `UNLINK` que preserva sentinelas estrangeiras.
- Alinhou preflight e spec na precedência `TEST_REDIS_URL ?? REDIS_URL`, mantendo `REDIS_URL` obrigatório e falhando em endpoints selecionados inválidos ou inalcançáveis.

## Task Commits

1. **RED: regressões de run scope Redis** - `ce0fba0` (test)
2. **GREEN: isolamento Redis de identidade por execução** - `6d11edf` (feat)

## Files Created/Modified

- `apps/api/src/identity/identity.runtime.ts` - Resolve um modo de produção ou run e injeta os dois prefixes explícitos antes da conexão Redis.
- `apps/api/src/identity/identity.runtime.spec.ts` - Prova defaults, derivação exata, spies dos construtores e rejeição antes de conexão/escrita.
- `apps/api/src/identity/adapters/redis-auth-rate-limiter.ts` - Valida os prefixes aceitos pelos adapters de limiter e PKCE sem fallback de valor inválido.
- `apps/api/src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts` - Executa cinco casos obrigatórios contra Redis real, inclusive isolamento e cleanup com sentinelas.
- `scripts/run-phase2-integration.mjs` - Valida e pinga o endpoint Redis efetivamente selecionado pelo spec.

## Decisions Made

- O modo default é produção explícita e não sintetiza run ID; isolamento só existe por `{ mode: "run", runScopeId }` validado.
- Prefixes não são montados por 02-33/02-39: esses callers passam somente o mesmo E2E run ID ao contrato central.
- O preflight pinga `REDIS_URL` obrigatório e, quando diferente, também o `TEST_REDIS_URL` selecionado, deduplicando somente igualdade byte-for-byte.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restringiu a enumeração PKCE ao subprefix exato**

- **Found during:** Task 1, primeiro run Redis real do GREEN.
- **Issue:** O teste PKCE enumerava o prefix inteiro do run e também encontrava dois counters legítimos do limiter, produzindo três keys em vez de uma.
- **Fix:** A prova de digest do state passou a escanear somente `${oauthPkceKeyPrefix}:*`; o cleanup final continua cobrindo o run inteiro validado.
- **Files modified:** `apps/api/src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts`
- **Verification:** Spec Redis real passou 5/5 e terminou com `DBSIZE=0`.
- **Committed in:** `6d11edf`

**2. [Rule 3 - Blocking] Compatibilizou tracking localizado após handlers não reconhecerem seções**

- **Found during:** Close-out do plano.
- **Issue:** `state.advance-plan`, `state.update-progress` e `state.record-session` esperavam headings/campos ingleses e não reconheceram as seções portuguesas existentes; `roadmap.update-plan-progress` também não alterou o parágrafo localizado.
- **Fix:** Os handlers compatíveis registraram métrica/decisões e validaram STATE; `frontmatter.merge` corrigiu o progresso autoritativo, e os ponteiros/progresso localizados foram alinhados sem avançar o próximo plano pendente 02-32.
- **Files modified:** `.planning/STATE.md`, `.planning/ROADMAP.md`
- **Verification:** `state.validate` retornou `valid: true`, frontmatter registra 39/45 (87%) e ROADMAP registra 36 planos da Fase 2 com seis restantes.
- **Committed in:** commit de metadata do plano.

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking)
**Impact on plan:** uma correção ficou limitada ao seletor PKCE; a outra manteve o tracking localizado coerente sem alterar a ordem dos planos ou a arquitetura.

## Issues Encountered

- O processo não recebeu `DATABASE_URL`; o preflight obteve uma connection string Neon somente em memória pela sessão autenticada existente, criou/removeu seu schema isolado e não imprimiu nem persistiu credenciais.
- Redis foi iniciado em loopback, sem snapshot/AOF, em diretório temporário com sentinela `pubg-camp-02-41-*`; após `DBSIZE=0`, o processo e o diretório foram removidos.
- `requirements.mark-complete` não encontrou checkboxes porque `REQUIREMENTS.md` usa uma tabela de status localizada; os status agregados foram preservados, já que AUTH-003/NFR-005 ainda dependem dos outros planos pendentes.

## Verification

- `rtk pnpm --filter @pubg-camp/api exec vitest run src/identity/identity.runtime.spec.ts` — 13/13.
- `rtk pnpm phase2:integration:preflight` — PostgreSQL + Redis aprovados.
- `rtk pnpm --filter @pubg-camp/api exec vitest run src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts` — 5/5 contra Redis real.
- `rtk pnpm --filter @pubg-camp/api typecheck` — sem erros.
- Biome nos cinco arquivos — sem erros.
- Source scan — nenhum skip/todo/runIf, `KEYS`, `FLUSHDB`, `--passWithNoTests` ou delete Redis amplo.
- `TEST_REDIS_URL` explícito inválido ou inalcançável — falha não-zero; seleção explícita válida prevaleceu sobre `REDIS_URL` inválido no spec.

## TDD Gate Compliance

- RED `ce0fba0` precede GREEN `6d11edf` e falhou pela ausência do resolver/contrato esperado.
- GREEN passou todos os testes focais, integração Redis real, preflight e typecheck.
- Nenhum refactor separado foi necessário.

## Known Stubs

None — os valores vazios encontrados pela varredura são acumuladores locais, defaults de opções ou validações de entrada; nenhum dado vazio flui para UI ou substitui wiring real.

## User Setup Required

None — Redis temporário e schema de preflight foram limpos, e nenhuma credencial foi gravada.

## Next Phase Readiness

- 02-33 pode passar o `E2E_RUN_ID` validado como `redisScope.runScopeId` sem montar prefixes.
- 02-39 pode usar o mesmo valor para runtime e cleanup exato, com sentinela estrangeira preservada.

## Self-Check: PASSED

- Os cinco arquivos modificados e este SUMMARY existem no working tree.
- Os commits TDD `ce0fba0` e `6d11edf` existem e aparecem na ordem RED → GREEN.
- A varredura final do spec/runner não encontrou escapes de skip, comandos Redis amplos ou seletor tolerante a zero testes.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
