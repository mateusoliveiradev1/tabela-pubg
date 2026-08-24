---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 32
subsystem: identity
tags: [nestjs, fastify, sessions, identity-link, step-up, csrf, postgresql, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 29
    provides: Autoridade request.auth e proteção tenantless deny-by-default
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 37
    provides: Pending proof Discord actor/session-bound
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 42
    provides: Comando atômico D-08 para link, rotação e revogação
provides:
  - Controllers Nest protegidos para listar, revogar e encerrar sessões
  - Controllers Nest protegidos para listar, confirmar link e remover identidades
  - Remoção owner-scoped com trava da conta, proteção da última identidade e rotação/revogação no mesmo commit
  - Projeções estritas e redigidas sem token, digest, e-mail em claro ou credencial de provider
affects: [02-33, 02-34, 02-38, account-security, identity-management]

tech-stack:
  added: []
  patterns:
    - Autoridade de management derivada exclusivamente de request.auth
    - Credenciais de resposta publicadas somente após commit sensível
    - Trava da linha do usuário serializa count/remove da última identidade

key-files:
  created:
    - apps/api/src/identity/session.controller.ts
    - apps/api/src/identity/session.controller.spec.ts
    - apps/api/src/identity/identity-management.controller.ts
    - apps/api/src/identity/identity-management.controller.spec.ts
  modified:
    - apps/api/src/identity/identity.service.ts
    - apps/api/src/identity/identity.service.spec.ts
    - apps/api/src/identity/identity.module.ts
    - apps/api/src/identity/identity.runtime.ts
    - apps/api/src/app.module.spec.ts
    - packages/database/src/repositories/identity.ts

key-decisions:
  - "candidateIdentityId identifica a pending proof server-side; o controller nunca recebe subject, actor, sessão ou trust do browser."
  - "A confirmação Discord consulta a candidate bound sem consumi-la e chama exatamente uma vez o adapter D-08, que continua sendo o único writer do link."
  - "A remoção trava a conta, valida fresh step-up e confirma identidade, token atual e revoke-others na mesma transação."

patterns-established:
  - "Post-commit credential publication: rotateToSession só executa depois que o comando retorna sucesso."
  - "Owner-scoped security mutation: usuário, sessão, proof e target são sempre derivados ou vinculados no servidor."

requirements-completed: [AUTH-003, AUTH-005, ORG-002, ORG-003, NFR-005]

duration: 13min
completed: 2026-08-24
---

# Phase 2 Plan 32: Protected Session and Identity Management Summary

**Gestão real de sessões e identidades no Nest, com autoridade server-side, proof D-08 bound, proteção transacional da última identidade e credenciais publicadas apenas após commit.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-24T14:14:36Z
- **Completed:** 2026-08-24T14:28:05Z
- **Tasks:** 1 TDD
- **Files modified:** 10

## Accomplishments

- Publicou sete endpoints reais de conta para listar/revogar/logout sessões e listar/confirmar/remover identidades, todos com `@RequirePermission("authenticated")`.
- Derivou actor, sessão e trust somente de `request.auth`; schemas strict rejeitam authority smuggling e divergência entre IDs de rota e body.
- Delegou a pending proof Discord intacta e explicitamente bound ao adapter D-08 exatamente uma vez; falhas stale, replay e cross-session não publicam cookie nem CSRF.
- Redigiu identificadores antes da projeção pública e validou todas as respostas pelos contratos compartilhados strict.
- Serializou remoções pela linha do usuário, protegeu a última identidade verificada e confirmou remoção, rotação atual e revoke-others na mesma transação PostgreSQL.
- Registrou controllers e o adapter concreto de security change no `IdentityModule`, com prova de rotas no módulo Nest composto.

## Task Commits

1. **TDD RED: regressões de gerenciamento protegido** — `faf145c` (test)
2. **TDD GREEN: controllers, serviços, repository e wiring reais** — `31799ba` (feat)

## Files Created/Modified

- `apps/api/src/identity/session.controller.ts` — lista, revoke target, revoke-others e logout com lifecycle CSRF determinístico.
- `apps/api/src/identity/session.controller.spec.ts` — ownership, target equality, current/other revoke, logout, metadata e smuggling.
- `apps/api/src/identity/identity-management.controller.ts` — lista redigida, confirmação D-08 e remoção com publicação pós-commit.
- `apps/api/src/identity/identity-management.controller.spec.ts` — stale/replay/cross-session proof, last identity, other-user, ordering e ausência de credenciais em erro.
- `apps/api/src/identity/identity.service.ts` — orquestração fresh-step-up, candidate proof bound, listagem e remoção segura.
- `apps/api/src/identity/identity.service.spec.ts` — contratos de delegação única, binding e falhas antes de mutação.
- `packages/database/src/repositories/identity.ts` — projeção redigida, lookup bound e transação owner-scoped de remoção/sessões.
- `apps/api/src/identity/identity.runtime.ts` — adapters reais PostgreSQL e D-08 no runtime.
- `apps/api/src/identity/identity.module.ts` — controllers e provider do security-change adapter registrados.
- `apps/api/src/app.module.spec.ts` — prova que os sete paths existem no Fastify composto.

## Decisions Made

- O UUID enviado como `candidateIdentityId` é somente o ID da proof pendente; provider subject e display candidate são resolvidos server-side sob actor/session/purpose/expiry.
- O read da proof não a consome: o comando 02-42 revalida e consome a mesma proof dentro da transação que vincula a identidade, gira o token, revoga outras sessões e anexa evidência.
- A remoção não usa o fluxo legado `linkIdentity`; ela serializa na conta e inclui a sessão na própria transação para não deixar identidade removida com credenciais antigas ativas em caso de falha parcial.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Um build direto da API inicialmente leu os exports compilados anteriores do pacote database. O gate correto foi executado na ordem de dependências (`database build` antes de `api build`), e o build Turbo completo passou 13/13.

## Known Stubs

None — o scan dos arquivos criados/modificados não encontrou TODO, FIXME, placeholder ou fonte de dados vazia ligada ao fluxo.

## Threat Flags

None — os endpoints e a fronteira browser/BFF→controllers estão integralmente cobertos por T-02-83, T-02-84 e T-02-86 do plano.

## Verification

- Focal do plano (`session.controller`, `identity-management.controller`, `identity.service`) — PASS, 36/36.
- API completa — PASS, 14 arquivos e 120/120 testes.
- Database offline — PASS, 7 arquivos e 24/24 testes; specs reais continuam reservados ao runner preflighted existente.
- API typecheck, lint e build — PASS.
- Database lint e build — PASS.
- Root `pnpm test` — PASS, 22/22 tarefas Turbo.
- Root `pnpm build` — PASS, 13/13 tarefas Turbo; somente warning não bloqueante preexistente de link longo no standalone Next.
- Cleanup — PASS; nenhum serviço, listener, schema, segredo ou arquivo temporário foi criado por este plano.

## TDD Gate Compliance

- RED `faf145c` falhou com os dois controllers ausentes e nove comportamentos de service ainda não implementados.
- GREEN `31799ba` veio depois do RED e passou os gates focais, suíte API completa, lint, typecheck e build agregado.

## Authentication Gates

None.

## User Setup Required

None — nenhuma credencial, variável, serviço externo ou configuração manual foi adicionada.

## Next Phase Readiness

- As telas de conta e a allowlist BFF existentes agora alcançam controllers Nest reais e protegidos.
- Planos 02-33/02-34 e 02-38 podem consumir o estado autoritativo de sessão/identidade sem mocks de management.

## Self-Check: PASSED

- Os quatro arquivos criados e os seis arquivos modificados existem no working tree.
- Commits `faf145c` e `31799ba` existem no histórico na ordem RED→GREEN.
- Verificação focal, API completa, database offline, root test e root build passaram após o commit GREEN.
- Nenhuma deleção rastreada, segredo, stub, recurso temporário ou arquivo gerado não rastreado permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
