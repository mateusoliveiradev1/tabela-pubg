---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 25
subsystem: database
tags: [postgresql, drizzle, session-trust, outbox, leases, migrations]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    provides: schema base de identidade, organizações, auditoria, notificações e outbox
provides:
  - Trust de sessão persistente com backfill derivado de e-mail verificado e cap provisional
  - Provas OTP/OAuth/identity-link vinculadas a actor e sessão
  - State machine de outbox com claim SKIP LOCKED, lease, retry e publicação terminal
  - Gate PostgreSQL real para fresh apply e upgrade cumulativo 0000-0003
affects: [02-26, 02-27, 02-30, 02-31, 02-35, 02-36]

tech-stack:
  added: []
  patterns:
    - Estado de autenticação transitório vinculado por FK composta actor/sessão
    - Ownership de publicação por claim token e lease persistidos
    - Migração PostgreSQL validada em schemas criptograficamente isolados

key-files:
  created:
    - packages/database/migrations/0003_runtime_security_closure.sql
    - packages/database/migrations/meta/0003_snapshot.json
    - packages/database/test/runtime-security-migration.integration.spec.ts
  modified:
    - packages/database/src/schema/identity.ts
    - packages/database/src/schema.ts
    - packages/database/src/outbox.ts
    - packages/database/src/outbox.test.ts
    - packages/database/src/repositories/sessions.ts
    - packages/database/migrations/meta/_journal.json

key-decisions:
  - "Trust legado é trusted somente com e-mail verificado ativo; os demais registros viram provisional e são limitados a 15 minutos."
  - "Claims do outbox usam FOR UPDATE SKIP LOCKED e toda mutação posterior exige token de claim com lease ainda válido."
  - "Erros do outbox persistem apenas códigos estáveis de até 64 caracteres; texto de provider, recipient ou token é descartado."

patterns-established:
  - "Backfill fail-closed: prova durável eleva trust; ausência de prova reduz capacidade e duração."
  - "Lease ownership: publish/retry são updates condicionais por id, status, claim token e expiração."
  - "Migration gate: fresh e upgrade usam schemas únicos e DROP SCHEMA guardado por prefixo em finally."

requirements-completed: [AUTH-002, AUTH-003, ORG-002, NFR-005]

duration: 20min
completed: 2026-08-24
---

# Phase 2 Plan 25: Runtime Security Persistence Summary

**Trust de sessão, provas actor/session-bound e outbox lease-safe persistidos por Drizzle e comprovados em PostgreSQL real nos caminhos fresh e upgrade.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-24T08:45:33Z
- **Completed:** 2026-08-24T09:05:44Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Adicionou `session_trust`, vínculo composto de challenges e provas de identity link expirantes/one-use sem persistir credenciais em texto puro.
- Evoluiu o outbox para claim concorrente com `FOR UPDATE SKIP LOCKED`, lease recuperável, ownership por token, retry redigido e estado published terminal.
- Validou 0000→0003 do zero e 0000→0002→0003 com preservação de identidades Discord/memberships, backfill determinístico e negativos reais de FK, replay e stale lease.
- Executou o gate com PostgreSQL 16.15 e Redis 8.10 loopback-only temporários; 21/21 testes de integração passaram e todos os recursos foram removidos.

## Task Commits

Tarefas TDD produziram commits RED e GREEN separados:

1. **Task 1: Persistir trust e provas actor/session-bound** — `f583de0` (RED), `9f4707f` (GREEN)
2. **Task 2: Implementar state machine durável do outbox** — `4094829` (RED), `299f331` (GREEN)
3. **Task 3: Executar gate de migration push em PostgreSQL isolado** — `bf8883b` (RED), `e170418` (GREEN/fixes)

## Files Created/Modified

- `packages/database/migrations/0003_runtime_security_closure.sql` — migração cumulativa de trust, proofs e leases com backfill fail-closed.
- `packages/database/migrations/meta/0003_snapshot.json` — snapshot Drizzle equivalente ao schema final.
- `packages/database/test/runtime-security-migration.integration.spec.ts` — gate PostgreSQL real fresh/upgrade, catálogo e negativos de concorrência.
- `packages/database/src/schema/identity.ts` — trust, bindings, provas e constraints de identidade.
- `packages/database/src/schema.ts` — claim token, lease expiry e índice de claim do outbox.
- `packages/database/src/outbox.ts` — claim, publish e retry condicionais com clock/token injetados.
- `packages/database/src/outbox.test.ts` — contratos unitários da state machine com executor em memória.
- `packages/database/src/schema/identity.spec.ts` — contratos unitários TDD do schema de segurança.
- `packages/database/src/repositories/sessions.ts` — compatibilidade explícita de trust para emissores legados trusted.
- `packages/database/migrations/meta/_journal.json` — registro da migração 0003.

## Decisions Made

- Sessões legadas sem e-mail verificado ativo não recebem confiança por inferência: o upgrade reduz `absolute_expires_at` e `idle_expires_at` para o teto de 15 minutos.
- Challenges/OAuth legados não-sign-in que não carregavam vínculo durável são removidos na migração, pois não podem ser backfilled com segurança.
- Eventos `publishing` legados sem lease são recuperados como `failed` com código estável `migration_recovered` e voltam a ser elegíveis.
- O publisher não aceita texto arbitrário em `last_error`; qualquer valor fora do formato de código é substituído por `publish_failed`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Serialização de timestamps em SQL raw do outbox**
- **Found during:** Task 3 (gate PostgreSQL real)
- **Issue:** parâmetros `Date` em SQL raw Drizzle/Postgres.js chegavam ao encoder sem transformação de coluna.
- **Fix:** timestamps são convertidos para ISO e tipados explicitamente como `timestamptz` no SQL.
- **Files modified:** `packages/database/src/outbox.ts`, `packages/database/src/outbox.test.ts`
- **Verification:** unit tests 22/22 e integração 21/21.
- **Committed in:** `e170418`

**2. [Rule 3 - Blocking] Emissores legados não preenchiam a nova coluna trust**
- **Found during:** Task 3 (suite de integração existente)
- **Issue:** `issueSessionForDevice` e `issueIdentitySession` preservavam o comportamento trusted anterior, mas inseriam `trust` como nulo após a migração.
- **Fix:** ambos persistem `trusted` explicitamente até o plano 02-27 promover trust a input/runtime de primeira classe.
- **Files modified:** `packages/database/src/repositories/sessions.ts`
- **Verification:** todos os cinco testes existentes de lifecycle de sessão voltaram a passar no PostgreSQL real.
- **Committed in:** `e170418`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking issue).
**Impact on plan:** correções necessárias para executar o contrato em PostgreSQL real; nenhuma biblioteca, tabela ou arquitetura adicional foi introduzida.

## Issues Encountered

- Não havia `DATABASE_URL` nem PostgreSQL local. Foi baixado o archive oficial PostgreSQL 16.15 da EDB por HTTPS para diretório temporário, validado por tamanho e SHA-256, inicializado loopback-only e removido após o gate.
- Redis 8.10 local foi iniciado em porta loopback isolada, sem persistência, e encerrado após a suíte.
- O aviso existente do Vite sobre `configLoader: native` permaneceu informativo e não afetou os testes.

## Known Stubs

None — o scan dos arquivos criados/modificados não encontrou TODO, FIXME, placeholders ou data sources vazios.

## Verification

- `rtk pnpm verify:migrations` — PASS; 4 migrations e `drizzle-kit check` verde.
- `rtk pnpm --filter @pubg-camp/database test` — PASS; 22 unit tests executados, integration specs corretamente separadas.
- `rtk pnpm --filter @pubg-camp/database typecheck` — PASS.
- `rtk pnpm exec biome check ...` — PASS nos 7 arquivos TypeScript alterados relevantes.
- `rtk pnpm phase2:integration` — PASS; PostgreSQL e Redis preflight, 4 arquivos e 21 testes executados.
- Leak check após a suíte — PASS; zero schemas `phase2_runtime_security_%` restantes.

## User Setup Required

None — nenhuma configuração externa ou credencial foi persistida.

## Next Phase Readiness

- O plano 02-26 pode consumir a state machine durável do outbox.
- O plano 02-27 deve substituir a compatibilidade trusted dos emissores legados por trust explícito derivado do fluxo de autenticação.
- Planos 02-30/02-31 podem implementar consume/transition sobre challenges e proofs actor/session-bound.

## Self-Check: PASSED

- Arquivos criados existem: migration 0003, snapshot 0003 e runtime security integration spec.
- Commits TDD existem no histórico: `f583de0`, `9f4707f`, `4094829`, `299f331`, `bf8883b`, `e170418`.
- Nenhuma deleção rastreada ou arquivo gerado não rastreado permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
