---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 05
subsystem: database-organizations-authorization
tags: [postgresql, drizzle, multi-tenant, row-locks, audit, outbox, github-actions]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 04
    provides: repositories transacionais e padrão de executor injetado
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 17
    provides: PostgreSQL Neon e Redis reais aprovados para gates
provides:
  - repositories de organização, membership, convite e autorização com tenant explícito
  - auditoria sanitizada com visibilidade owner/admin completa e member self-only
  - consumo single-use de convite com e-mail verificado e payload operacional completo
  - proteção concorrente do último owner e transferência explícita de ownership
  - matrix CI PostgreSQL/Redis com logs redigidos e artifacts por suite
affects: [organization-use-cases, permission-guards, audit-api, phase2-ci]
tech-stack:
  added: []
  patterns: [tenant-explicit-repository, coordinator-row-lock, transactional-audit-outbox, real-two-connection-race]
key-files:
  created:
    - packages/database/src/repositories/audit.ts
    - packages/database/src/repositories/authorization.ts
    - packages/database/src/repositories/organizations.ts
    - packages/database/test/invitation.concurrent.spec.ts
    - packages/database/test/last-owner.concurrent.spec.ts
  modified:
    - packages/database/test/identity-organizations.integration.spec.ts
    - packages/database/src/repositories/index.ts
    - .github/workflows/ci.yml
    - scripts/validate-phase2-ci.mjs
key-decisions:
  - "Todo lookup tenant-owned recebe organizationId junto do resourceId e retorna ausência sem revelar outro tenant."
  - "Convite e ownership serializam na linha coordenadora da organização; convite também bloqueia e revalida sua própria linha dentro da transaction."
  - "Corridas no Neon usam duas conexões diretas derivadas da connection string MCP, evitando afinidade de search_path instável no endpoint pooled."
  - "A CI remota não foi disparada neste plano; a autorização final e o push permanecem no checkpoint 02-24."
patterns-established:
  - "Mutações sensíveis recebem um único executor e gravam estado, audit sanitizado e outbox antes do mesmo commit."
  - "AuditWriter elimina campos de token, e-mail, payload, credencial e valores com endereço completo antes da persistência."
  - "Suites concorrentes sincronizam duas transactions já abertas por barreira e comprovam o estado completo do vencedor."
requirements-completed: [AUTH-004, AUTH-005, ORG-001, ORG-002, ORG-003, ORG-004, ORG-005, AUD-001, NFR-005]
duration: 27min
completed: 2026-08-21
---

# Phase 2 Plan 05: Organizações tenant-aware e invariantes concorrentes Summary

**Repositories multi-tenant com audit/outbox atômicos, convite single-use e último owner protegidos por locks reais do PostgreSQL**

## Performance

- **Duration:** 27 min
- **Started:** 2026-08-21T04:37:12.511Z
- **Completed:** 2026-08-21T05:04:08.148Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Criou organizações com owner inicial, audit sanitizado e outbox no mesmo executor transacional, permitindo ao mesmo usuário participar de várias organizações sem contexto implícito.
- Implementou snapshot de autorização sempre atual, lookup composto por organização/recurso e consulta de auditoria completa para owner/admin ou self-only para membro.
- Implementou convite de sete dias com digest, e-mail verificado, row locks, membership, papel global, todos os cargos operacionais, audit e outbox em um único commit.
- Provou com duas conexões PostgreSQL reais que somente um aceite vence e que remoção/transferência concorrente nunca deixa a organização sem owner.
- Dividiu integração e concorrência em matrix CI fail-closed, com credenciais redigidas no job log e artifact de retenção curta por suite.

## Task Commits

1. **Task 1: Criar repositories tenant-aware e audit writer atômico**
   - `d7659f0` — RED: multi-organização, isolamento tenant, snapshot, auditoria e rollback.
   - `0fd0fff` — GREEN: repositories de organização, autorização e AuditWriter sanitizado.
2. **Task 2: Provar convite e último owner sob corrida PostgreSQL**
   - `1913af0` — RED: duas conexões e barreiras para convite e ownership.
   - `4c1735e` — GREEN: locks, rechecks, convite completo, remoção e transferência.
3. **Task 3: Executar gates PostgreSQL e Redis na CI**
   - `b977483` — matrix, redaction, artifacts e validator estrutural correspondente.

## Files Created/Modified

- `packages/database/src/repositories/audit.ts` — append sanitizado e visibilidade all/self por tenant.
- `packages/database/src/repositories/authorization.ts` — snapshot corrente de membership e assignments ativos.
- `packages/database/src/repositories/organizations.ts` — organizações, convites, aceite, revogação e ownership com locks.
- `packages/database/src/repositories/index.ts` — exports públicos dos repositories novos.
- `packages/database/test/identity-organizations.integration.spec.ts` — nove provas reais de atomicidade e isolamento.
- `packages/database/test/invitation.concurrent.spec.ts` — aceite concorrente, e-mail/expiry/revoke/replay e estado completo.
- `packages/database/test/last-owner.concurrent.spec.ts` — remoções e transferência concorrentes em duas conexões.
- `.github/workflows/ci.yml` — matrix PostgreSQL/Redis e artifacts redigidos.
- `scripts/validate-phase2-ci.mjs` — gate estrutural da matrix, pipefail, redaction e upload.

## Decisions Made

- O repository não aceita lookup por ID isolado para recursos tenant-owned; `organizationId` faz parte de toda assinatura relevante.
- A organização é a linha coordenadora estável de convite e ownership; o convite também é bloqueado antes de recarregar estado terminal, e-mail e expiry.
- Convites persistem somente SHA-256 do token. Audit/outbox recebem IDs e estados, nunca token, e-mail completo ou role payload controlado externamente.
- O endpoint pooled continua válido para preflight/integração serial, mas o gate de concorrência deriva o endpoint direto da URL fornecida pelo Neon MCP para manter duas sessões reais e `search_path` estável.
- Nenhum push ou GitHub Actions foi executado; o plano 02-24 permanece como gate de autorização da CI final.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrigidos Date binds e timeout curto nos testes Neon**
- **Found during:** Task 1, primeiro GREEN real.
- **Issue:** inserts SQL de teste passavam `Date` sem type inference e novos cenários excediam o timeout unitário de cinco segundos pela latência externa.
- **Fix:** timestamps brutos usam ISO e somente os casos externos novos declaram timeout de 15 segundos.
- **Files modified:** `packages/database/test/identity-organizations.integration.spec.ts`.
- **Verification:** nove testes passaram no Neon real; package lint/typecheck/build passaram.
- **Committed in:** `0fd0fff`

**2. [Rule 3 - Blocking] Usadas conexões Neon diretas nas corridas**
- **Found during:** Task 2, gate RED das duas conexões.
- **Issue:** o endpoint pooled podia reutilizar backend e perder afinidade do `search_path`, invalidando a prova de duas transactions persistentes.
- **Fix:** as suites derivam o endpoint direto da connection string obtida via MCP; cada cliente mantém sua própria conexão e a barreira é cruzada com as duas transactions abertas.
- **Files modified:** `packages/database/test/invitation.concurrent.spec.ts`, `packages/database/test/last-owner.concurrent.spec.ts`.
- **Verification:** `pnpm phase2:concurrent` passou 4/4 testes reais em 78 segundos.
- **Committed in:** `4c1735e`

**3. [Rule 3 - Blocking] Atualizado validator para a CI em matrix**
- **Found during:** Task 3, primeiro `verify:phase2-ci`.
- **Issue:** o validator anterior confundia `phase2:integration` com o prefixo de `phase2:integration:preflight` e exigia o layout sequencial antigo.
- **Fix:** o gate agora exige a matrix exata, suites independentes, pipefail, redaction e artifact por suite, distinguindo o comando de integração por lookahead.
- **Files modified:** `scripts/validate-phase2-ci.mjs`.
- **Verification:** `verify:phase2-ci`, `verify:compose`, `verify:migrations`, `verify:secrets` e preflight real passaram.
- **Committed in:** `b977483`

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking). **Impact:** os ajustes tornam as provas determinísticas no Windows/Neon e mantêm o escopo e as fronteiras de segurança do plano.

## Issues Encountered

- O endpoint Neon pooled não oferece afinidade de sessão suficiente para um teste de corrida baseado em `search_path`; o endpoint direto resolveu sem mock, PGlite ou skip.
- A execução externa completa é naturalmente mais lenta: integração passou 14/14 em 76 segundos e concorrência 4/4 em 78 segundos.
- A GitHub Actions não foi disparada porque não houve autorização de push; a validação final permanece explicitamente no plano 02-24.

## Known Stubs

None. Todos os repositories estão ligados ao schema real; as suites concorrentes exigem PostgreSQL real e nunca substituem o gate por fake.

## Threat Flags

None. Os novos acessos tenant-owned, locks concorrentes, audit/outbox e serviços CI estão cobertos por T-02-09, T-02-10, T-02-11 e T-02-SC do plano.

## User Setup Required

None. PostgreSQL e Redis temporários já estavam configurados pelo plano 02-17; nenhuma connection string ou credencial foi persistida.

## Next Phase Readiness

- Casos de uso de organização podem criar tenants, convidar/revogar membros e transferir ownership sobre repositories transacionais.
- Guards podem carregar snapshots atuais sem cache de roles e negar imediatamente membership/assignment revogado.
- O plano 02-06 pode construir os serviços HTTP sobre essas primitivas; a execução remota da matrix continua reservada ao 02-24.

## Self-Check: PASSED

- Os cinco artefatos principais e o SUMMARY existem no worktree.
- Os cinco commits TDD/tarefa do plano aparecem no histórico Git.
- Key-link `organizations.ts` → `audit.ts` foi verificado pelo SDK (1/1).
- Integração real passou 14/14; concorrência real passou 4/4; package local passou 14 testes com suites externas opt-in.
- Lint, boundaries, typecheck, build, migrations, compose estrutural, CI estrutural e secret scan passaram.
- Nenhuma credencial, connection string ou token foi persistido no repositório.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
