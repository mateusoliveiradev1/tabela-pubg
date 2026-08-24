---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 39
subsystem: testing
tags: [playwright, nestjs, postgresql, redis, bullmq, github-actions, csp]

requires:
  - phase: 02-32
    provides: authorization guards and tenant isolation contracts
  - phase: 02-33
    provides: isolated fake-provider runtime mode
  - phase: 02-36
    provides: OTP lifecycle and step-up flows
  - phase: 02-37
    provides: organization membership, invitation and audit flows
  - phase: 02-41
    provides: BFF secret boundary and browser routes
  - phase: 02-42
    provides: runtime security migrations
provides:
  - real API, worker, Next.js and browser Phase 2 runtime gate
  - fail-closed CI contract for the eight mandatory expanded jobs
  - validated run-scoped PostgreSQL, Redis, mailbox and object cleanup
affects: [02-34, 02-40, phase-2-verification]

tech-stack:
  added: []
  patterns: [canonical-run-scope, real-process-e2e, expanded-job-contract, second-origin-browser-evidence]

key-files:
  created:
    - apps/api/src/organizations/adapters/e2e-organization-logo-storage.ts
    - apps/web/e2e/phase2-runtime.spec.ts
  modified:
    - scripts/run-phase2-e2e.mjs
    - scripts/validate-phase2-ci.mjs
    - .github/workflows/ci.yml
    - apps/api/src/main.ts
    - apps/api/src/e2e/provider-mode.spec.ts
    - apps/web/playwright.config.ts
    - apps/web/package.json
    - package.json

key-decisions:
  - "Propagar um único E2E_RUN_ID validado, sem transformação, por schema, Redis/BullMQ, mailbox, objetos e cleanup."
  - "Manter API, worker, Next.js e Chromium reais; somente Discord, e-mail e armazenamento usam adapters falsos sob o modo E2E isolado."
  - "Servir o logo por uma segunda origem loopback real para provar CSP e igualdade dos bytes no navegador."
  - "Validar os oito pares expandidos de jobs obrigatórios, em vez de aceitar somente nomes de jobs matriciais."

patterns-established:
  - "Runtime evidence: preflight -> schema/migrations -> seed -> processos reais -> Playwright -> assertions -> graceful stop -> cleanup exato."
  - "CI contracts: inventários nomeados e mutações negativas impedem skips, seletores vazios e regressão para evidência sintética."

requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, AUTH-006, ORG-001, ORG-002, ORG-003, ORG-004, ORG-005, AUD-001, NFR-005]

duration: 1h 16m
completed: 2026-08-24
---

# Phase 2 Plan 39: Runtime real e contrato CI Summary

**Gate Playwright que sobe API, worker, Next.js, PostgreSQL e Redis reais sob um escopo efêmero, com CI fail-closed sobre oito jobs obrigatórios**

## Performance

- **Duration:** 1h 16m
- **Started:** 2026-08-24T15:31:44Z
- **Completed:** 2026-08-24T16:48:36Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Criado harness real que valida o run ID, prepara schema/role temporários, inicia worker/API/servidor de imagem/Next.js, executa seis histórias no Chromium e limpa somente recursos do run.
- Provados upgrade provisional-to-trusted, convite de sete dias e uso único, step-up para mutações sensíveis, último owner, auditoria por papel, isolamento tenant e logo CSP em segunda origem.
- Fixado no workflow o runtime gate e os contratos de autorização/BFF, com validador de 31 mutações negativas e oito pares expandidos obrigatórios.

## Task Commits

1. **Task 1 RED: contratos inicialmente falhos** - `d742528` (test)
2. **Task 1 GREEN: stack real e seis histórias browser** - `7953d3f` (feat)
3. **Task 2: contrato CI fail-closed** - `55a0412` (ci)
4. **Task 1 hardening: convite e último owner** - `9ccb82e` (fix)
5. **Post-run RED: exigir build fresh-checkout de autorização** - `a28e1be` (test)
6. **Post-run GREEN: adicionar build antes dos contratos** - `f51cb28` (fix)
7. **Post-run hardening: construir o fechamento mínimo domain + authorization** - `74af3d3` (fix)
8. **Post-run RED: exigir closures dependency-only do API e worker** - `8021456` (test)
9. **Post-run GREEN: construir todos os entrypoints do runtime sem buildar apps** - `caf29fd` (fix)

## Files Created/Modified

- `scripts/run-phase2-e2e.mjs` - lifecycle real, escopo canônico, processos e cleanup em `finally`.
- `apps/web/e2e/phase2-runtime.spec.ts` - seis histórias sequenciais com browser e assertions PostgreSQL/Redis.
- `apps/api/src/main.ts` - wiring E2E estritamente condicionado e origem de logo loopback validada.
- `apps/api/src/organizations/adapters/e2e-organization-logo-storage.ts` - adapter temporário que publica bytes em uma segunda origem real.
- `apps/api/src/e2e/provider-mode.spec.ts` - contrato do adapter Discord pelas URLs reais de token, usuário e revogação.
- `apps/web/playwright.config.ts` - projeto `phase2-runtime` isolado dos projetos browser amplos.
- `.github/workflows/ci.yml` - gate real após migrations/integração e suites de segurança obrigatórias.
- `scripts/validate-phase2-ci.mjs` - estrutura CI, inventários e 31 casos negativos nomeados.
- `package.json` e `apps/web/package.json` - comando raiz `test:e2e:runtime` sem fallback sintético.

## Decisions Made

- O run ID é validado uma vez e comparado byte a byte em todos os consumidores e alvos de cleanup; valores genéricos são recusados.
- Provedores externos permanecem falsos somente na conjunção de flags E2E, enquanto o produto inteiro roda como processos reais.
- O logo é servido por outro origin loopback para testar a fronteira CSP de verdade, não por uma rota sintética do BFF.
- O contrato CI conta as oito expansões obrigatórias e rejeita `skip`, seletores vazios, condições permissivas e artifacts sensíveis.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Adicionado armazenamento de logo com segunda origem real**
- **Found during:** Task 1
- **Issue:** O adapter existente não oferecia uma origem independente para demonstrar CSP e igualdade de bytes.
- **Fix:** Adapter E2E dedicado, URL loopback estrita e servidor temporário com conteúdo isolado pelo run.
- **Files modified:** `apps/api/src/organizations/adapters/e2e-organization-logo-storage.ts`, `apps/api/src/main.ts`, `scripts/run-phase2-e2e.mjs`
- **Verification:** caso `second-origin-logo` passou no Chromium com comparação byte a byte.
- **Committed in:** `7953d3f`

**2. [Rule 1 - Bug] Corrigidos correlation IDs inválidos no harness**
- **Found during:** Task 1
- **Issue:** IDs textuais eram recusados pelo outbox PostgreSQL e impediam o fluxo real.
- **Fix:** Cada chamada browser agora gera UUID válido.
- **Files modified:** `apps/web/e2e/phase2-runtime.spec.ts`
- **Verification:** 6/6 casos runtime passaram com API e worker reais.
- **Committed in:** `7953d3f`

**3. [Rule 1 - Bug] Corrigida extração do token de convite no mailbox**
- **Found during:** Task 1
- **Issue:** O token chega após fragmento `#token=` dentro de JSON e o parser anterior não capturava o valor opaco de forma limitada.
- **Fix:** Parser base64url delimitado e compatível com o fragmento real.
- **Files modified:** `apps/web/e2e/phase2-runtime.spec.ts`
- **Verification:** convite válido, expirado, e-mail divergente e replay passaram no runtime.
- **Committed in:** `7953d3f`

**4. [Rule 3 - Blocking] Ajustado orçamento do runtime para PostgreSQL remoto**
- **Found during:** Task 1
- **Issue:** O timeout Playwright padrão não comportava migrations e chamadas reais sob latência remota.
- **Fix:** Orçamento de 180 segundos apenas no projeto runtime e paginação mínima válida de auditoria.
- **Files modified:** `apps/web/playwright.config.ts`, `apps/web/e2e/phase2-runtime.spec.ts`
- **Verification:** execução completa passou em 2,3 minutos.
- **Committed in:** `7953d3f`

**5. [Rule 2 - Missing Critical] Tornadas explícitas invariantes de convite e último owner**
- **Found during:** Verificação final da Task 1
- **Issue:** O fluxo funcionava, mas a prova não comparava efeitos antes/depois do replay nem exercitava e-mail divergente e revogação do único owner.
- **Fix:** Assertions de token não consumido, contagens exatas de membership/audit/outbox, união de assignments e owner preservado.
- **Files modified:** `apps/web/e2e/phase2-runtime.spec.ts`
- **Verification:** comando raiz `pnpm phase2:integration:preflight && pnpm test:e2e:runtime` passou 6/6.
- **Committed in:** `9ccb82e`

**6. [Rule 1 - Bug] Produzido o entrypoint de autorização em fresh checkout**
- **Found during:** Run CI `32788590904` do SHA `ac1594a`
- **Issue:** O build `@pubg-camp/web^...` não inclui `@pubg-camp/authorization`; por isso `permission.guard.spec.ts` falhava antes de coletar testes. Um build direto de authorization também falhava no DTS sem `@pubg-camp/domain`.
- **Fix:** O workflow agora executa `pnpm turbo run build --filter=@pubg-camp/authorization...` antes dos contratos, construindo somente `domain + authorization`; o validador rejeita ausência ou ordem tardia.
- **Files modified:** `.github/workflows/ci.yml`, `scripts/validate-phase2-ci.mjs`
- **Verification:** Worktree destacado sem `dist` reproduziu a falha antes do passo e passou 53/53 contratos depois dele, mantendo `apps/api/dist` ausente.
- **Committed in:** `a28e1be`, `f51cb28`, `74af3d3`

**7. [Rule 1 - Bug] Produzidos todos os entrypoints workspace exigidos pelo runtime**
- **Found during:** Run CI `32790336671` do SHA `76fa827`
- **Issue:** Os contratos já passavam, mas `tsx apps/worker/src/main.ts` falhava ao resolver `@pubg-camp/config/dist/index.js`; API e worker dependem de closures maiores do que web/authorization.
- **Fix:** O workflow executa `pnpm turbo run build --filter=@pubg-camp/api^... --filter=@pubg-camp/worker^...` antes dos contratos e runtime. Os filtros `^...` constroem nove pacotes transitivos e excluem os apps API/worker.
- **Files modified:** `.github/workflows/ci.yml`, `scripts/validate-phase2-ci.mjs`
- **Verification:** Dry-run fresh-checkout enumerou exatamente nove pacotes sem API/worker; todos os entrypoints foram produzidos e o runtime real completou 6/6 no Chromium.
- **Committed in:** `8021456`, `caf29fd`

---

**Total deviations:** 7 auto-fixed (5 bugs/missing critical, 1 blocking, 1 evidence hardening)
**Impact on plan:** Correções restritas à fidelidade e segurança do harness; nenhum redesign visual ou superfície de produção foi adicionado.

## Issues Encountered

- O primeiro `pnpm ci:verify` parou nos erros preexistentes TS2783 do worker; após a correção independente `1f2dfed`, a reexecução pós-remediação passou integralmente.
- O run CI `32788590904` falhou porque o fresh checkout não possuía `packages/authorization/dist`; a simulação local reproduziu exatamente a resolução de pacote e provou o fechamento mínimo antes do novo checkpoint humano de 02-34.
- O run CI `32790336671` mostrou que o fechamento apenas de authorization era insuficiente para iniciar o worker; o dry-run Turbo tornou explícita a closure real sem recorrer ao build dos apps.
- Um teste intermediário comparou a ordem de um enum PostgreSQL; a assertion foi corrigida para comparar a união ordenada no código e o gate real passou em seguida.
- A primeira branch PostgreSQL efêmera foi revogada imediatamente após uma falha de quoting exibir sua credencial temporária. A execução final usou nova branch, nunca persistiu o segredo e removeu a branch ao terminar.

## Verification

- Lifecycle self-test: 11 casos nomeados passaram.
- Provider Vitest: 4/4 passaram pelas URLs reais do adapter Discord.
- Runtime Playwright: 6/6 passaram contra stack real; a prova fresh-checkout pós-closure completou em 2,4 minutos.
- CI validator self-test: 34/34 mutações negativas passaram; contrato normal e `verify:phase2-ci` passaram.
- Em worktree fresh-checkout sem `dist`, o build dedicado produziu somente `domain + authorization`; authorization, permission guard/PKCE e BFF passaram 53/53.
- O dry-run final de API/worker enumerou exatamente `authorization`, `config`, `contracts`, `database`, `domain`, `logger`, `observability`, `queue` e `storage`; nenhum app foi buildado.
- `pnpm ci:verify` passou integralmente, incluindo secrets, boundaries, lint, typecheck, testes e builds.
- API e web typecheck passaram durante as tarefas; hooks de todos os commits passaram sem bypass.
- PostgreSQL temporário removido; Redis retornou `DBSIZE 0`, processo foi parado e diretório temporário removido.

## Known Stubs

None - nenhum placeholder ou fonte de dados vazia foi introduzido nos arquivos do plano.

## TDD Gate Compliance

- RED: `d742528`
- GREEN: `7953d3f`
- Hardening após evidência real: `9ccb82e`

## User Setup Required

None - o harness cria e remove seus próprios escopos quando PostgreSQL e Redis são fornecidos pelo ambiente CI.

## Next Phase Readiness

- 02-34 pode solicitar um novo push explícito do HEAD pós-`caf29fd` e capturar os oito pares expandidos obrigatórios; os runs `32788590904` e `32790336671` permanecem evidências falhas superseded.
- 02-40 pode consumir o gate runtime e os inventários fail-closed na verificação consolidada da fase.
- Não há recursos temporários ou segredos de 02-39 remanescentes.

## Self-Check: PASSED

- Todos os 10 arquivos criados/modificados existem.
- Commits `d742528`, `7953d3f`, `55a0412`, `9ccb82e`, `a28e1be`, `f51cb28`, `74af3d3`, `8021456` e `caf29fd` existem no histórico.
- Nenhuma deleção inesperada ou arquivo gerado ficou no worktree.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
