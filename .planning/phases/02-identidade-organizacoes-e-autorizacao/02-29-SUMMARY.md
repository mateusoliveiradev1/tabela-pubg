---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 29
subsystem: authorization
tags: [nextjs-bff, nestjs, fastify, tenant-context, bola, security-logging, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    provides: Guard global, snapshots RBAC live e trust persistido dos planos 02-07 e 02-35
provides:
  - Contexto de organização derivado exclusivamente da rota BFF validada
  - Igualdade fail-closed entre parâmetros Nest e headers internos de tenant/scope
  - Registro estruturado, correlacionado e redigido de negações cross-tenant
  - Provas HTTP de bloqueio antes do handler para tenant, scope e snapshot stale
affects: [02-31, 02-32, 02-36, 02-39, 02-42]

tech-stack:
  added: []
  patterns:
    - Named route captures como única origem de headers internos de tenant no BFF
    - Route/header equality antes do snapshot RBAC e do controller Nest
    - Denial recorder best-effort com campos UUID canônicos e razões limitadas

key-files:
  created:
    - apps/api/src/authorization/permission.guard.spec.ts
  modified:
    - apps/web/src/app/api/platform/[...path]/route.ts
    - apps/web/src/app/api/platform/[...path]/route.spec.ts
    - apps/api/src/authorization/permission.guard.ts
    - apps/api/src/authorization/authorization.module.ts
    - apps/api/src/main.ts
    - apps/api/test/security.integration.spec.ts

key-decisions:
  - "O BFF injeta organization/scope somente após uma regra allowlisted extrair e validar UUIDs da rota; headers tenant do browser continuam descartados."
  - "O PermissionGuard usa parâmetros Fastify como contexto autoritativo da rota e exige igualdade com headers internos antes de consultar o snapshot PostgreSQL."
  - "Negações usam uma categoria estável, reason class limitada e apenas correlação, ator, sessão, tenant/scope da rota e permission; falha ou ausência do sink preserva o 403."

patterns-established:
  - "Validated route context: cada regra tenant-aware declara explicitamente seus captures, sem cookie, query ou body."
  - "Tenant consistency before RBAC: mismatch não carrega snapshot nem executa handler/repository."
  - "Redacted denial evidence: nenhum header fornecido, cookie, body, role, resource detail ou segredo entra no registro."

requirements-completed: [AUTH-005, ORG-002, ORG-003, NFR-005]

duration: 9min
completed: 2026-08-24
---

# Phase 2 Plan 29: Tenant Context and Cross-Tenant Denial Summary

**Contexto tenant derivado de captures BFF canônicos, validado contra parâmetros Nest antes do RBAC e auditado em negações cross-tenant redigidas.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-24T11:17:39Z
- **Completed:** 2026-08-24T11:26:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Todas as rotas de membros, convites, ownership, auditoria e logo agora extraem `organizationId` da regex já validada e o enviam ao upstream sem aceitar spoofing do navegador.
- O guard Nest compara tenant e scope canônicos dos parâmetros Fastify com os headers internos antes de carregar autorização ou entrar no controller.
- Organização errada, scope errado, role/membership stale e mismatch de contexto retornam o mesmo 403 support-coded sem revelar existência ou executar mutação.
- Cada negação de contexto/RBAC produz exatamente um evento `authorization-denied` com reason class limitada e sem cookies, body, roles, tokens ou detalhes do recurso.
- A autorização continua consultando o snapshot live em cada request; o BFF transporta contexto, mas não decide RBAC.

## Task Commits

As tarefas TDD produziram commits RED e GREEN separados:

1. **Task 1: Derivar tenant/scope na regra BFF validada** — `31790aa` (RED), `da04c41` (GREEN)
2. **Task 2: Validar contexto no Nest e registrar cross-tenant deny** — `db6c218` e `81e5594` (RED), `90405d5` (GREEN)
3. **Gate pós-tarefa: formatar extractor conforme Biome** — `7463788` (style)

## Files Created/Modified

- `apps/web/src/app/api/platform/[...path]/route.ts` — captures nomeados e injeção server-side de tenant/scope após a validação da rota.
- `apps/web/src/app/api/platform/[...path]/route.spec.ts` — headers upstream exatos, spoofing descartado e rotas identity tenantless.
- `apps/api/src/authorization/permission.guard.ts` — consistência path/header, reasons limitadas e deny antes do snapshot/handler.
- `apps/api/src/authorization/permission.guard.spec.ts` — matriz unitária de tenant/scope, stale permission e falha do recorder.
- `apps/api/src/authorization/authorization.module.ts` — port injetável do denial recorder com fallback no-op seguro.
- `apps/api/src/main.ts` — sink de produção no logger estruturado de segurança.
- `apps/api/test/security.integration.spec.ts` — Fastify inject same-tenant/cross-tenant e spies de snapshot/handler.

## Decisions Made

- UUIDs de organização e scope são normalizados para lowercase somente depois de passarem pelo formato canônico compartilhado entre BFF e guard.
- Rotas tenantless com permissões de identidade/autenticação continuam sem contexto fabricado; rotas com `:organizationId` exigem o header interno correspondente mesmo quando usam a pseudo-permissão `authenticated`.
- O recorder é best-effort e pode ser omitido em composições legadas/testes via provider no-op, mas nenhuma ausência ou exceção transforma deny em allow ou 5xx.
- Falhas de snapshot RBAC usam `permission-denied`, evitando distinguir membership inexistente, role stale ou assignment no scope errado na resposta e no detalhe público.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Formatado extractor BFF após o gate Biome**
- **Found during:** Verificação agregada pós-Task 2
- **Issue:** O formatter exigiu a expressão ternária de `scopeId` em uma linha e fez o lint web falhar.
- **Fix:** Aplicado o formatter somente ao arquivo tenant route modificado.
- **Files modified:** `apps/web/src/app/api/platform/[...path]/route.ts`
- **Verification:** Lint web e a spec BFF passaram; os três warnings CSS preexistentes permaneceram apenas como warning e foram adiados.
- **Committed in:** `7463788`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Ajuste exclusivamente mecânico necessário para o gate do arquivo modificado, sem mudança comportamental ou de escopo.

## Issues Encountered

- O lint web revelou três warnings preexistentes de `!important` no estilo reduced-motion. Como não foram causados pelo plano e não falham o gate, ficaram registrados em `deferred-items.md` sem alteração de CSS.

## Known Stubs

None — o scan dos sete arquivos não encontrou TODO, FIXME, placeholder ou fonte de dados de produção vazia ligada ao fluxo.

## Verification

- `rtk pnpm --filter @pubg-camp/web exec vitest run "src/app/api/platform/[...path]/route.spec.ts"` — PASS; 21/21 testes.
- `rtk pnpm --filter @pubg-camp/web typecheck` — PASS; sem erros TypeScript.
- `rtk pnpm --filter @pubg-camp/api exec vitest run src/authorization/permission.guard.spec.ts test/security.integration.spec.ts` — PASS; 21/21 testes.
- `rtk pnpm --filter @pubg-camp/authorization exec vitest run src/authorization.spec.ts` — PASS; 14/14 testes.
- `rtk pnpm --filter @pubg-camp/api test` — PASS; 31 arquivos/172 testes executados, com 2 arquivos/6 casos preexistentes skipped.
- `rtk pnpm --filter @pubg-camp/api build` e `typecheck` — PASS.
- `rtk pnpm --filter @pubg-camp/api lint` e `rtk pnpm --filter @pubg-camp/web lint` — PASS; web mantém somente 3 warnings preexistentes documentados.
- Cleanup — PASS; fetch globals foram restaurados, apps Nest/Fastify foram fechados por `afterEach` e nenhum recurso externo ou dado persistente foi criado.

## TDD Gate Compliance

- RED `31790aa` falhou em cinco casos porque o BFF ainda não enviava `x-organization-id`; GREEN `da04c41` passou os 21 casos e typecheck.
- RED `db6c218` falhou em mismatch/recording/stale sink; RED de integração `81e5594` provou que o handler ainda executava no mismatch.
- GREEN `90405d5` veio depois dos REDs e passou guard, Fastify inject, autorização pura, lint, typecheck, build e suíte API completa.

## Threat Flags

None — não houve endpoint, schema, acesso a arquivo ou trust boundary novo além de T-02-71 a T-02-74 já registrados no plano.

## User Setup Required

None — nenhum segredo, serviço externo, banco real ou recurso temporário foi necessário.

## Next Phase Readiness

- Planos de integração seguintes podem confiar que o BFF só transporta tenant/scope extraído da rota e que o Nest falha fechado em qualquer divergência.
- A revogação/mudança de role já afeta a request seguinte via snapshot live sem alterar sessões ou acesso a outras organizações.

## Self-Check: PASSED

- Os sete arquivos criados/modificados e este SUMMARY existem no working tree.
- Os commits `31790aa`, `da04c41`, `db6c218`, `81e5594`, `90405d5` e `7463788` existem no histórico na ordem RED→GREEN.
- Nenhuma deleção rastreada, segredo, recurso temporário ou arquivo gerado não rastreado permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
