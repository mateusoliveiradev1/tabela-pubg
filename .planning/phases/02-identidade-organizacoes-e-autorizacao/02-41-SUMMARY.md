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
  - Seleção Vitest separada: offline ignora integração/dist e o comando Redis coleta exatamente o spec source obrigatório
affects: [02-33, 02-39, phase2-e2e, phase2-ci]

tech-stack:
  added: []
  patterns:
    - Um runScopeId canônico governa todos os prefixes Redis de identidade de uma execução
    - Cleanup de integração usa SCAN e UNLINK somente após revalidar o escopo exato

key-files:
  created:
    - apps/api/src/identity/identity-test-selection.spec.ts
    - apps/api/vitest.config.ts
    - apps/api/vitest.redis-integration.config.ts
  modified:
    - apps/api/src/identity/identity.runtime.ts
    - apps/api/src/identity/identity.runtime.spec.ts
    - apps/api/src/identity/adapters/redis-auth-rate-limiter.ts
    - apps/api/src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts
    - scripts/run-phase2-integration.mjs
    - package.json

key-decisions:
  - "Produção mantém explicitamente pubg-camp:auth e pubg-camp:oauth:pkce; somente mode=run aceita um runScopeId fornecido pelo caller."
  - "TEST_REDIS_URL, quando presente, é o endpoint selecionado pelo spec e também recebe PING do preflight; REDIS_URL continua obrigatório."
  - "A suíte API offline coleta apenas src/**/*.spec.ts não-integrados; Redis real usa config dedicada que inclui exatamente o spec source e exclui dist."

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
- **Files modified:** 9

## Accomplishments

- Adicionou `IdentityRedisScope` e `resolveIdentityRedisPrefixes`, rejeitando escopos ausentes, amplos, malformados, com whitespace/separadores e fora de 19–67 caracteres antes de abrir Redis.
- Passou explicitamente os prefixes estáveis ou run-scoped aos adapters reais e fez os próprios construtores recusarem prefixes vazios, amplos ou escapáveis.
- Tornou o spec Redis incondicional e não-skippable, com limiter isolado, PKCE cross-run negado/one-use e cleanup `SCAN` + `UNLINK` que preserva sentinelas estrangeiras.
- Alinhou preflight e spec na precedência `TEST_REDIS_URL ?? REDIS_URL`, mantendo `REDIS_URL` obrigatório e falhando em endpoints selecionados inválidos ou inalcançáveis.
- Separou a coleta Vitest offline da integração Redis: a primeira exclui integration/dist, enquanto a segunda seleciona exatamente o spec source após o preflight fail-closed.

## Task Commits

1. **RED: regressões de run scope Redis** - `ce0fba0` (test)
2. **GREEN: isolamento Redis de identidade por execução** - `6d11edf` (feat)
3. **RED pós-wave: regressão de seleção Vitest** - `04923ea` (test)
4. **GREEN pós-wave: separação offline/Redis real** - `8f265c9` (fix)

## Files Created/Modified

- `apps/api/src/identity/identity.runtime.ts` - Resolve um modo de produção ou run e injeta os dois prefixes explícitos antes da conexão Redis.
- `apps/api/src/identity/identity.runtime.spec.ts` - Prova defaults, derivação exata, spies dos construtores e rejeição antes de conexão/escrita.
- `apps/api/src/identity/adapters/redis-auth-rate-limiter.ts` - Valida os prefixes aceitos pelos adapters de limiter e PKCE sem fallback de valor inválido.
- `apps/api/src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts` - Executa cinco casos obrigatórios contra Redis real, inclusive isolamento e cleanup com sentinelas.
- `scripts/run-phase2-integration.mjs` - Valida e pinga o endpoint Redis efetivamente selecionado pelo spec.
- `apps/api/src/identity/identity-test-selection.spec.ts` - Prova estruturalmente a cadeia offline, a cadeia dedicada e a ausência de duplicação src/dist ou escapes de skip.
- `apps/api/vitest.config.ts` - Limita a suíte API offline a specs source não-integrados e exclui artefatos `dist`.
- `apps/api/vitest.redis-integration.config.ts` - Seleciona exatamente o spec Redis source, sem tolerância a zero testes e sem coleta paralela.
- `package.json` - Expõe `phase2:redis-integration` como preflight seguido da config dedicada.

## Decisions Made

- O modo default é produção explícita e não sintetiza run ID; isolamento só existe por `{ mode: "run", runScopeId }` validado.
- Prefixes não são montados por 02-33/02-39: esses callers passam somente o mesmo E2E run ID ao contrato central.
- O preflight pinga `REDIS_URL` obrigatório e, quando diferente, também o `TEST_REDIS_URL` selecionado, deduplicando somente igualdade byte-for-byte.
- A suíte API padrão permanece totalmente offline; a prova Redis real tem comando dedicado, config exata e falha antes de executar sem URL Redis.

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

**3. [Rule 1 - Bug] Removeu integração e artefatos dist da coleta offline agregada**

- **Found during:** Gate agregado pós-wave, após a conclusão inicial do plano.
- **Issue:** `pnpm test` coletava tanto `src/...integration.spec.ts` quanto `dist/...integration.spec.js` na API offline; os dois resolviam Redis no top-level, duplicavam a prova e quebravam corretamente sem infraestrutura.
- **Fix:** A config offline passou a excluir integration/dist; uma config dedicada seleciona somente o spec Redis source após o preflight, e um teste estrutural trava as duas cadeias, a ordem e a inexistência de escapes tolerantes.
- **Files modified:** `apps/api/vitest.config.ts`, `apps/api/vitest.redis-integration.config.ts`, `apps/api/src/identity/identity-test-selection.spec.ts`, `package.json`
- **Verification:** API offline 12 arquivos/91 testes; root test 13/13 pacotes; dedicado Redis 1 arquivo/5 testes e `DBSIZE=0`; ausência de Redis falhou non-zero.
- **Committed in:** `04923ea`, `8f265c9`

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocking)
**Impact on plan:** as correções ficaram limitadas ao seletor PKCE, ao harness Vitest e ao tracking localizado; não houve redesign do runtime ou dos prefixes Redis.

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
- `rtk pnpm --filter @pubg-camp/api test` — 12 arquivos/91 testes offline, sem integration ou dist.
- `rtk pnpm test` — 13/13 pacotes aprovados sem infraestrutura Redis.
- `rtk pnpm phase2:redis-integration` — preflight aprovado e exatamente 1 arquivo/5 testes contra Redis real temporário; `DBSIZE=0` após cleanup.
- Execução dedicada sem `REDIS_URL`/`TEST_REDIS_URL` — falha non-zero, sem skip/todo/passWithNoTests.
- `identity-test-selection.spec.ts` — 2/2, cobrindo as cadeias offline/dedicada, ordem do preflight e exclusão de `dist`.
- `rtk pnpm build` — 13/13 pacotes; `rtk pnpm lint` e `rtk pnpm typecheck` — sem erros.
- `rtk pnpm verify:phase2-ci` e Biome nos quatro arquivos do harness — aprovados.

## TDD Gate Compliance

- RED `ce0fba0` precede GREEN `6d11edf` e falhou pela ausência do resolver/contrato esperado.
- GREEN passou todos os testes focais, integração Redis real, preflight e typecheck.
- O RED pós-wave `04923ea` falhou pela ausência das duas configs; o GREEN `8f265c9` passou a prova estrutural, as suítes offline e o Redis dedicado.
- Nenhum refactor separado foi necessário.

## Known Stubs

None — os valores vazios encontrados pela varredura são acumuladores locais, defaults de opções ou validações de entrada; nenhum dado vazio flui para UI ou substitui wiring real.

## User Setup Required

None — Redis temporário e schema de preflight foram limpos, e nenhuma credencial foi gravada.

## Next Phase Readiness

- 02-33 pode passar o `E2E_RUN_ID` validado como `redisScope.runScopeId` sem montar prefixes.
- 02-39 pode usar o mesmo valor para runtime e cleanup exato, com sentinela estrangeira preservada.

## Self-Check: PASSED

- Os nove arquivos modificados/criados e este SUMMARY existem no working tree.
- Os pares TDD `ce0fba0` → `6d11edf` e `04923ea` → `8f265c9` existem na ordem RED → GREEN.
- A varredura final do spec/runner não encontrou escapes de skip, comandos Redis amplos ou seletor tolerante a zero testes.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
