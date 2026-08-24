---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 37
subsystem: identity
tags: [oauth, discord, nestjs, nextjs, bff, csrf, postgresql, redis, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plans: [31, 36, 42]
    provides: Transacoes OAuth purpose-bound, endpoints OTP duraveis e comando atomico D-08
provides:
  - Rotas OAuth Discord explicitas para sign-in publico e link/step-up protegidos
  - Revogacao do token Discord antes de sessao, step-up ou pending proof local
  - Pending proof Discord server-side para confirmacao posterior pelo unico writer D-08
  - Allowlist BFF purpose-specific para OTP e OAuth sem autoridade fornecida pelo browser
affects: [02-32, 02-38, identity-management, web-authentication]

tech-stack:
  added: []
  patterns:
    - Purpose fixo no path seleciona guards; body nunca escolhe uma fronteira mais fraca
    - Provider revoke conclui antes de qualquer mutacao local OAuth
    - Callback protegido usa request.auth apenas como constraint e a transacao consumida como autoridade

key-files:
  created: []
  modified:
    - apps/api/src/identity/oauth.service.ts
    - apps/api/src/identity/identity.controller.ts
    - apps/api/src/identity/identity.runtime.ts
    - apps/web/src/app/api/platform/[...path]/route.ts
    - apps/web/src/components/identity/email-otp-form.tsx

key-decisions:
  - "Sign-in, link-identity e step-up usam paths OAuth distintos; somente sign-in recebe @Public."
  - "O token Discord e revogado depois de exchange/profile e antes de sessao, confirmStepUp ou pending proof; falha de revoke impede toda mutacao local."
  - "O BFF rejeita autoridade do browser e purpose mismatch antes do fetch, preservando actor/session exclusivamente no request.auth e na transacao server-side."

patterns-established:
  - "OAuth completion ordering: consume state -> exchange -> profile -> revoke -> local commit."
  - "Identity BFF routing: method/path/purpose exatos, sem endpoints genericos selecionados por body."

requirements-completed: [AUTH-001, AUTH-003, AUTH-006, NFR-005]

duration: 18min
completed: 2026-08-24
---

# Phase 2 Plan 37: Purpose-Specific OAuth and Identity BFF Summary

**Discord sign-in, link e step-up agora atravessam rotas purpose-specific, revogam o token do provider antes de qualquer commit local e chegam ao Nest por uma allowlist BFF sem autoridade controlada pelo browser.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-24T13:14:03Z
- **Completed:** 2026-08-24T13:31:57Z
- **Tasks:** 2 TDD
- **Files modified:** 14

## Accomplishments

- Separou sign-in Discord publico de starts/callbacks protegidos de link-identity e step-up, com purpose fixo no path e actor/session derivados de `request.auth`.
- Reordenou o callback para concluir exchange, profile e revoke antes de emitir sessao, persistir `reauthenticated_at` ou criar a pending proof Discord.
- Substituiu o link imediato no callback por uma proof server-side one-use, preservada para confirmacao posterior pelo comando atomico D-08.
- Compilou a allowlist BFF exata para todos os contratos OTP e OAuth purpose-specific e rejeitou purpose/actor/user/session/trust smuggling antes do upstream fetch.
- Atualizou somente os destinos dos formularios existentes; estrutura, estilo e copy visuais permaneceram inalterados.

## Task Commits

1. **Task 1 RED: regressões OAuth purpose-bound** - `6990ab9` (test)
2. **Task 1 GREEN: OAuth Discord protegido e revoke-before-commit** - `f588487` (feat)
3. **Task 2 RED: regressões de routing e smuggling no BFF** - `e414695` (test)
4. **Task 2 GREEN: contratos BFF e forms purpose-specific** - `6e39e5a` (feat)

## Files Created/Modified

- `apps/api/src/identity/oauth.service.ts` - Ordering revoke-before-commit, step-up via SessionService e pending proof Discord.
- `apps/api/src/identity/oauth.service.spec.ts` - Matriz positiva/negativa, replay, mismatch e spies de ordering.
- `apps/api/src/identity/identity.controller.ts` - Seis rotas OAuth explicitas com metadata publica/protegida correta.
- `apps/api/src/identity/identity.controller.spec.ts` - Autoridade request.auth, purpose tampering e rotacao CSRF pos-commit.
- `apps/api/src/identity/identity.runtime.ts` - Adapter real para transacao OAuth e criacao da pending proof PostgreSQL.
- `apps/api/src/identity/identity.service.ts` - Verificacao isolada de ownership da identidade Discord antes do step-up.
- `apps/api/src/app.module.spec.ts` - Composicao Fastify valida os seis paths OAuth reais.
- `apps/web/src/app/api/platform/[...path]/route.ts` - Allowlist exata OTP/OAuth e rejeicao recursiva de autoridade do browser.
- `apps/web/src/app/api/platform/[...path]/route.spec.ts` - Regressões de paths publicos/protegidos e exact upstream routing.
- `apps/web/src/components/identity/email-otp-form.tsx` - Request/verify apontam para o contrato explicito `sign-in`.
- `apps/web/src/components/identity/discord-navigation.ts` - Navegacao POST escolhe apenas o path correspondente ao purpose tipado.
- `apps/web/src/components/identity/oauth-callback-form.tsx` - Callback POST usa o path purpose-specific depois de remover code/state da URL.
- `apps/web/src/components/identity/auth.spec.tsx` - Regressões dos destinos reais sem mudanca visual.

## Decisions Made

- O callback protegido compara `request.auth` com o binding consumido, mas todas as mutacoes usam somente actor/session da transacao server-side.
- O callback de link cria somente a pending proof e nao publica replacement token, rotaciona sessao nem vincula identidade.
- Payload OTP explicito nao precisa carregar purpose; no OAuth o purpose permanece como defesa em profundidade e deve ser igual ao path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Wiring runtime da pending proof e verificacao Discord**
- **Found during:** Task 1 GREEN.
- **Issue:** alterar apenas service/controller deixaria o runtime sem adapter para `createIdentityLinkProof` e faria o step-up marcar uma sessao sem validar que o subject Discord pertence ao actor.
- **Fix:** ligou o repository real no runtime, injetou SessionService no OAuthService e separou a verificacao de ownership Discord antes de `confirmStepUp`.
- **Files modified:** `identity.runtime.ts`, `identity.runtime.spec.ts`, `identity.service.ts`, `app.module.spec.ts`.
- **Verification:** 45/45 testes focais API, typecheck, build e 23/23 regressões PostgreSQL OAuth.
- **Committed in:** `f588487`.

**2. [Rule 2 - Missing Critical] Atualizacao dos entrypoints Discord existentes**
- **Found during:** Task 2 GREEN.
- **Issue:** a allowlist exata removeria os paths genericos, mas a navegacao e o callback Discord continuariam apontando para eles.
- **Fix:** derivou os paths de start/callback do purpose tipado, sem alterar markup, estilo ou copy.
- **Files modified:** `discord-navigation.ts`, `oauth-callback-form.tsx`.
- **Verification:** 44/44 regressões web e build Next production verde.
- **Committed in:** `6e39e5a`.

**3. [Rule 3 - Blocking] Servicos reais temporarios para o gate PostgreSQL/Redis**
- **Found during:** verificacao da Task 1.
- **Issue:** o processo nao herdou `DATABASE_URL`/`REDIS_URL` e o runner real falha fechado sem ambos; Docker nao existe neste host.
- **Fix:** iniciou PostgreSQL 16.15 oficial e Redis 8.10 em loopback e diretorio run-scoped, executou os gates e removeu processos, listeners e arquivos temporarios.
- **Files modified:** nenhum arquivo do repositorio.
- **Verification:** preflight real passou e `identity-organizations.integration.spec.ts` passou 23/23; portas 55437/56379 ficaram sem listeners apos cleanup.
- **Committed in:** n/a.

---

**Total deviations:** 3 auto-fixed (2 missing critical, 1 blocking issue).
**Impact on plan:** os ajustes completam o wiring de producao exigido sem ampliar o produto ou redesenhar a UI.

## Issues Encountered

- `pnpm phase2:integration` executou 48 casos reais e passou 47. O unico caso vermelho e o negativo temporal preexistente de `runtime-security-migration.integration.spec.ts`, que usa timestamps absolutos de 2026-08-24 e agora recebe check `23514` antes do FK `23503`; ele ja esta registrado em `deferred-items.md`. A suite focal OAuth passou 23/23.
- Um comando adicional `pnpm verify:boundaries` nao existe; o gate correto `pnpm lint` ja executou `lint:boundaries` e passou sem violacoes.

## Known Stubs

None - o scan dos arquivos modificados nao encontrou TODO, FIXME, placeholder ou fonte de dados vazia ligada ao fluxo.

## Verification

- API focal (`oauth.service`, `identity.controller`, runtime, service e app module) - PASS, 45/45.
- Web focal (`auth.spec.tsx` e route BFF) - PASS, 44/44.
- API e web typecheck - PASS.
- `pnpm test` - PASS, 22/22 tarefas do monorepo.
- `pnpm build` - PASS, 13/13 pacotes; warning nao bloqueante de symlink longo no standalone Next.
- `pnpm lint` + dependency boundaries - PASS; tres warnings CSS preexistentes de reduced-motion permaneceram fora do escopo.
- `pnpm phase2:integration` - PARTIAL por 1 falha preexistente e temporal; 47/48 verdes.
- Suite PostgreSQL focal OAuth - PASS, 23/23.
- Cleanup - PASS; nenhum listener ou diretorio temporario permaneceu.

## TDD Gate Compliance

- Task 1 RED `6990ab9` falhou nos novos contratos; GREEN `f588487` veio depois e passou os gates focais.
- Task 2 RED `e414695` falhou em 17 regressões novas; GREEN `6e39e5a` veio depois e passou 44/44.

## Authentication Gates

None.

## User Setup Required

None - nenhum segredo, URL de servico ou configuracao externa foi persistido.

## Next Phase Readiness

- 02-32 pode consumir a pending proof Discord no controller protegido e delegar a unica mutacao duravel ao comando D-08.
- OTP e OAuth agora estao alcançaveis pelo BFF em paths exatos; os proximos planos podem reutilizar a mesma politica de autoridade server-derived.

## Self-Check: PASSED

- SUMMARY e todos os arquivos-chave existem no working tree.
- Commits TDD `6990ab9`, `f588487`, `e414695` e `6e39e5a` existem no historico na ordem RED->GREEN de cada tarefa.
- Nenhuma delecao rastreada, segredo, stub, processo, listener ou diretorio temporario do gate permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
