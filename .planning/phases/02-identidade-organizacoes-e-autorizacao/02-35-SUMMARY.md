---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 35
subsystem: authorization
tags: [nestjs, fastify, session-trust, default-deny, security-logging, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    provides: Trust provisional/trusted persistido e propagado pelo resolve-and-touch do plano 02-27
provides:
  - Enforcement global fail-closed de trust antes de permissões e repositories
  - Metadata handler-only para onboarding autenticado e logout provisional
  - Evento estável e redigido para tentativas negadas de sessões provisionais
  - Matriz HTTP trusted/provisional/missing sobre todas as permissões do produto
affects: [02-32, 02-36, 02-39, 02-42]

tech-stack:
  added: []
  patterns:
    - Persisted trust gating antes de RBAC e de handlers protegidos
    - Bypass provisional handler-only combinado exclusivamente com permission authenticated
    - Security event port com payload mínimo e logging best-effort sem alterar o deny

key-files:
  created: []
  modified:
    - apps/api/src/authorization/authorization.service.ts
    - apps/api/src/authorization/decorators.ts
    - apps/api/src/authorization/permission.guard.ts
    - apps/api/src/authorization/authorization.module.ts
    - apps/api/src/main.ts
    - apps/api/src/identity/identity.controller.ts
    - apps/api/src/app.module.spec.ts
    - apps/api/test/security.integration.spec.ts

key-decisions:
  - "Trust ausente ou fora do vocabulário nunca recebe compatibilidade trusted e é negado antes do RBAC."
  - "AllowProvisional vale somente no handler, exige permission authenticated e não pode liberar permissões organizacionais ou de campeonato."
  - "A negação provisional registra apenas categoria, correlationId, actorId e sessionId; falha do sink não altera o resultado 403."

patterns-established:
  - "Trust-first authorization: depois de @Public, o guard valida request.auth.trust antes de snapshots ou handlers."
  - "Narrow provisional escape hatch: metadata de classe e permissões de produto não abrem o bypass."
  - "Redacted denial evidence: nenhum cookie, token, fingerprint, path ou permission entra no evento."

requirements-completed: [AUTH-003, AUTH-005, NFR-005]

duration: 7min
completed: 2026-08-24
---

# Phase 2 Plan 35: Persisted Trust Authorization Summary

**Trust persistido aplicado globalmente antes de RBAC, com provisional limitado a handlers autenticados explicitamente allowlisted e negações redigidas.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-24T11:03:14Z
- **Completed:** 2026-08-24T11:09:57Z
- **Tasks:** 1
- **Files modified:** 8

## Accomplishments

- Estendeu o contexto autenticado com `trust: provisional | trusted` e preservou a origem autoritativa já ligada a `resolveAndTouchSession` no bootstrap.
- Fechou `PermissionGuard` para negar trust provisional, ausente ou inválido antes de carregar snapshot RBAC ou executar handler protegido.
- Criou `@AllowProvisional()` handler-only e restringiu sua eficácia a endpoints com `RequirePermission("authenticated")`, mantendo `@Public` como bypass separado.
- Registrou um único evento `authorization-provisional-denied` por tentativa bloqueada, contendo somente correlação, ator e sessão.
- Provou via Fastify inject o comportamento trusted, as negações de criação/aceite/alerta e todas as 14 permissões do produto, além dos únicos bypasses explícitos.

## Task Commits

A tarefa TDD produziu commits RED e GREEN separados:

1. **Task 1: Aplicar trust provisional fail-closed** — `d48c305` (RED), `d1e0632` (GREEN)

## Files Created/Modified

- `apps/api/src/authorization/authorization.service.ts` — contrato de trust e port do evento de segurança redigido.
- `apps/api/src/authorization/decorators.ts` — metadata `AllowProvisional` dedicada.
- `apps/api/src/authorization/permission.guard.ts` — gate trust-first, bypass estreito e negação antes de RBAC.
- `apps/api/src/authorization/authorization.module.ts` — wiring obrigatório do security log port.
- `apps/api/src/main.ts` — sink de produção do evento de autorização usando o logger estruturado existente.
- `apps/api/src/identity/identity.controller.ts` — request protegido usa o `AuthenticatedSession` completo, incluindo trust.
- `apps/api/src/app.module.spec.ts` — composição do módulo fornece o novo port obrigatório.
- `apps/api/test/security.integration.spec.ts` — matriz HTTP trusted/provisional/missing e provas de redação/early deny.

## Decisions Made

- O metadata provisional é lido exclusivamente do handler; metadata de classe não amplia uma árvore de rotas inteira.
- Mesmo com metadata, uma sessão provisional só passa com a pseudo-permissão `authenticated`; permissões RBAC e resolução de alerta continuam negadas.
- O correlation ID só é aceito no formato UUID; qualquer valor não canônico vira `unavailable` e não injeta conteúdo arbitrário no log.
- O sink de segurança é obrigatório na composição, mas uma falha ao registrar não transforma o deny 403 em erro 5xx.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrigido fixture de missing trust que acionava o default trusted**
- **Found during:** Task 1 (Aplicar trust provisional fail-closed)
- **Issue:** Passar `undefined` ao helper de teste ativava o parâmetro default `trusted`, produzindo falso allow no caso que pretendia simular trust ausente.
- **Fix:** Introduzido o sentinel explícito `missing`, que omite a propriedade no objeto autenticado em runtime.
- **Files modified:** `apps/api/test/security.integration.spec.ts`
- **Verification:** O caso missing trust passou a receber 403 em organização, convite, alerta, RBAC e até handlers com metadata provisional.
- **Committed in:** `d1e0632`

**2. [Rule 2 - Missing Critical] Ligado o security log e o tipo completo fora da lista nominal do plano**
- **Found during:** Task 1 (Aplicar trust provisional fail-closed)
- **Issue:** O novo evento não poderia chegar ao logger de produção sem registrar um provider no módulo; o tipo local de request de identidade também ocultava o trust recém-obrigatório.
- **Fix:** Adicionado port obrigatório em `AuthorizationModule`, fixture de composição e uso de `AuthenticatedSession` no request protegido.
- **Files modified:** `apps/api/src/authorization/authorization.module.ts`, `apps/api/src/app.module.spec.ts`, `apps/api/src/identity/identity.controller.ts`
- **Verification:** Typecheck, lint, composição Nest e suíte completa da API passaram.
- **Committed in:** `d1e0632`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** As correções foram necessárias para provar missing trust e tornar o logging de produção efetivo; nenhuma superfície ou comportamento fora da autorização foi ampliado.

## Issues Encountered

- O primeiro helper de teste representava trust ausente com `undefined`, mas o default parameter do JavaScript convertia esse caso em `trusted`; o sentinel explícito removeu a ambiguidade.

## Known Stubs

None — o scan dos oito arquivos modificados não encontrou TODO, FIXME, placeholder ou fonte de dados de produção vazia.

## Verification

- `rtk pnpm --filter @pubg-camp/api exec vitest run test/security.integration.spec.ts` — PASS; 14/14 testes.
- `rtk pnpm --filter @pubg-camp/api typecheck` — PASS; sem erros TypeScript.
- `rtk pnpm --filter @pubg-camp/api lint` — PASS; 53 arquivos Biome.
- `rtk pnpm --filter @pubg-camp/api test` — PASS; 30 arquivos e 165 testes, com 2 arquivos/6 casos preexistentes skipped.
- Cleanup — PASS; apps Nest/Fastify foram fechados por `afterEach`, sem providers, cookies ou sinks globais restantes.

## TDD Gate Compliance

- RED `d48c305` falhou com `AllowProvisional is not a function`, antes de qualquer implementação.
- GREEN `d1e0632` veio depois do RED e passou matriz HTTP, typecheck, lint e a suíte completa da API.

## Threat Flags

None — não houve endpoint, schema, acesso a arquivo ou trust boundary novo além de T-02-66/T-02-67 já registrados no plano.

## User Setup Required

None — nenhum segredo, serviço externo ou recurso temporário foi necessário.

## Next Phase Readiness

- Os controllers reais dos planos 02-32/02-36 podem aplicar `@AllowProvisional()` somente no email-verification onboarding e logout; todo restante já falha fechado.
- A prova runtime/browser do plano 02-39 pode verificar a transição provisional→trusted contra o mesmo limite global.

## Self-Check: PASSED

- Os oito arquivos modificados e este SUMMARY existem no working tree.
- Os commits TDD `d48c305` e `d1e0632` existem no histórico na ordem RED→GREEN.
- Nenhuma deleção rastreada, segredo, recurso temporário ou arquivo gerado não rastreado permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
