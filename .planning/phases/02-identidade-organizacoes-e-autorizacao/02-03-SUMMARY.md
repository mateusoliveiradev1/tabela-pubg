---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 03
subsystem: database-identity-authorization
tags: [postgresql, drizzle, multi-tenant, sessions, rbac, audit, redis, ci]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 01
    provides: contratos de domínio, políticas temporais e matriz RBAC default-deny
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 02
    provides: contratos HTTP sem credenciais e configuração segura da fase
provides:
  - schema persistente modular para identidade, sessões, organizações, RBAC, auditoria e notificações cifradas
  - migration cumulativa com isolamento composto e auditoria protegida contra update/delete
  - preflight fail-closed que valida PostgreSQL, Redis e migrations do zero antes das suítes reais
  - job CI estruturalmente validado com PostgreSQL e Redis health-checked
affects: [repositories, api, worker, organizations, security-integration, phase-02-17]
tech-stack:
  added: []
  patterns: [digest-only-credentials, composite-tenant-foreign-keys, append-only-audit, isolated-migration-preflight, fail-closed-ci]
key-files:
  created:
    - packages/database/src/schema/identity.ts
    - packages/database/src/schema/organizations.ts
    - packages/database/src/schema/authorization.ts
    - packages/database/src/schema/audit.ts
    - packages/database/src/schema/notifications.ts
    - packages/database/migrations/0001_identity_organizations.sql
    - scripts/run-phase2-integration.mjs
    - scripts/validate-phase2-ci.mjs
    - vitest.integration.config.ts
  modified:
    - packages/database/src/schema.ts
    - packages/database/migrations/meta/_journal.json
    - package.json
    - turbo.json
    - .github/workflows/ci.yml
key-decisions:
  - "Credenciais reutilizáveis usam somente digests; payloads temporários de e-mail usam envelope AES-GCM apagável."
  - "Toda referência entre owners diferentes inclui o ID do owner na FK composta, inclusive usuário→identidade/sessão e organização→convite."
  - "O preflight aplica 0000+0001 em schema PostgreSQL descartável e só inicia Vitest após PostgreSQL e Redis reais responderem."
  - "Audit events são append-only também no PostgreSQL por trigger, não apenas por convenção de repository."
patterns-established:
  - "Tabelas tenant-owned carregam organization_id e provam o tenant comum por FK composta."
  - "Suites integration/concurrent nunca transformam ausência de infraestrutura em skip ou sucesso."
requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, AUTH-006, ORG-001, ORG-002, ORG-003, ORG-004, ORG-005, AUD-001, NFR-005]
duration: 22min
completed: 2026-08-21
---

# Phase 2 Plan 3: Modelo persistente de identidade e autorização Summary

**Dezesseis tabelas PostgreSQL com credenciais digest-only, isolamento multi-tenant por FKs compostas, auditoria append-only e gates reais de PostgreSQL/Redis antes das suítes**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-21T03:29:00Z
- **Completed:** 2026-08-21T03:51:00Z
- **Tasks:** 3
- **Files modified:** 20

## Accomplishments

- Identidade cobre users, providers, e-mails verificados, OTP, OAuth, devices, sessões e contextos opacos sem persistir token, código, state ou browser binding em texto puro.
- Organizações, memberships, convites, scopes e assignments possuem índices por tenant e FKs compostas que recusam relações cross-user e cross-organization.
- Notificações armazenam recipient digest e envelope AES-GCM versionado, expirável e apagável; auditoria inclui actor, motivo, snapshots, correlação e trigger append-only.
- A migration 0001 e seu snapshot/journal estão sincronizados; o runner cria schema isolado, aplica 0000+0001 do zero, valida relações e testa Redis antes de liberar Vitest serial.
- A CI provisiona PostgreSQL 18 e Redis 8.2 com healthchecks e executa preflight, integration e concurrent em ordem, sem skip ou continue-on-error.

## Task Commits

1. **Task 1: Modelar identidade, sessões e notificações cifradas**
   - `01af14e` — testes RED para credenciais, ciclo de sessões e envelope AES-GCM
   - `5d32b89` — implementação GREEN do modelo persistente de identidade
2. **Task 2: Modelar tenants, scopes, roles e auditoria**
   - `d251255` — testes RED para isolamento organizacional e FKs compostas
   - `67e67fa` — implementação GREEN de organizações, RBAC e auditoria
3. **Task 3: Gerar migration e gate PostgreSQL/Redis**
   - `cb9e41e` — migration, runner fail-closed, Vitest serial e workflow CI
4. **Correção de segurança após threat scan**
   - `b9a3c2b` — testes RED para referências cross-owner remanescentes
   - `bce8157` — FKs compostas e migration regenerada

## Files Created/Modified

- `packages/database/src/schema/identity.ts` — identidade, OTP/OAuth digest-backed, devices, sessões e alert contexts.
- `packages/database/src/schema/organizations.ts` — organizações, memberships e convites one-use de sete dias.
- `packages/database/src/schema/authorization.ts` — scopes tournament mínimos e assignments operacionais tenant-aware.
- `packages/database/src/schema/audit.ts` — eventos de auditoria com actor/scope compostos e snapshots tipados.
- `packages/database/src/schema/notifications.ts` — delivery idempotente com envelope AES-GCM apagável.
- `packages/database/src/schema/*.spec.ts` — 14 testes estruturais de credenciais e isolamento.
- `packages/database/migrations/0001_identity_organizations.sql` — DDL incremental após 0000 e trigger append-only.
- `packages/database/migrations/meta/0001_snapshot.json` — snapshot cumulativo Drizzle das 16 tabelas.
- `scripts/run-phase2-integration.mjs` — health PostgreSQL/Redis, migrations isoladas e despacho serial das suítes.
- `scripts/validate-phase2-ci.mjs` — gate estrutural do job CI e rejeição de placeholders/skips.
- `vitest.integration.config.ts` — seleção explícita integration/concurrent sem paralelismo de arquivos.
- `.github/workflows/ci.yml` — serviços reais e ordem obrigatória dos gates.

## Decisions Made

- `notification_deliveries` preserva somente recipient digest; recipient/conteúdo trafegam juntos no ciphertext e são apagados após entrega/expiração.
- `authorization_scopes(kind='tournament')` é a identidade mínima reutilizável pela Fase 3, sem antecipar entidade Tournament.
- Convites derivam estado de timestamps mutuamente exclusivos e exigem expiração exatamente sete dias após emissão.
- O runner substitui apenas qualificadores `public` por um schema aleatório interno durante o preflight, aplica cada statement e descarta o schema no final.
- A migration 0001 não redeclara a outbox já criada em 0000, embora o snapshot 0001 permaneça cumulativo para futuras gerações.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removida redeclaração da outbox na migration incremental**
- **Found during:** Task 3
- **Issue:** o projeto legado não possuía snapshot 0000; por isso o primeiro generate incluiu novamente enum/tabela/índices da outbox e falharia após 0000.
- **Fix:** a 0001 foi revisada como migration incremental, preservando snapshot 0001 cumulativo; uma geração subsequente confirmou ausência de mudanças de schema.
- **Files modified:** `packages/database/migrations/0001_identity_organizations.sql`, metadata Drizzle.
- **Verification:** `pnpm verify:migrations` e `drizzle-kit generate` sem mudanças.
- **Committed in:** `cb9e41e`, `bce8157`

**2. [Rule 1 - Bug] Constraint de motivo da auditoria convertida para API Drizzle suportada**
- **Found during:** Task 3
- **Issue:** extra config como SQL cru não apareceu no DDL gerado.
- **Fix:** usado `check()` oficial e adicionada trigger PostgreSQL que rejeita update/delete de `audit_events`.
- **Files modified:** `packages/database/src/schema/audit.ts`, migration e snapshot.
- **Verification:** DDL contém `audit_events_reason_check` e `audit_events_append_only`; `db:check` passou.
- **Committed in:** `cb9e41e`

**3. [Rule 2 - Missing Critical] Fechadas referências cross-owner remanescentes**
- **Found during:** threat scan final
- **Issue:** FKs simples permitiam associar verified email a identidade de outro usuário, OAuth a sessão de outro usuário e convite supersedido a outra organização.
- **Fix:** adicionadas uniques/FKs compostas `(user_id,id)` e `(organization_id,id)`, check de par OAuth e proibição de self-supersession.
- **Files modified:** schemas/tests de identidade e organizações, migration e snapshot.
- **Verification:** RED confirmou três falhas; GREEN passou 14/14 testes e DDL contém as três FKs compostas.
- **Committed in:** `b9a3c2b`, `bce8157`

**4. [Rule 2 - Missing Critical] Declarado PHASE2_SUITE no ambiente pass-through do Turbo**
- **Found during:** Task 3 formatting/lint
- **Issue:** o seletor da suite serial não estava declarado para o cache do Turborepo.
- **Fix:** adicionado `globalPassThroughEnv` em `turbo.json`.
- **Files modified:** `turbo.json`.
- **Verification:** Biome não emite mais warning para variável de ambiente não declarada.
- **Committed in:** `cb9e41e`

---

**Total deviations:** 4 auto-fixed (2 bugs, 2 missing critical). **Impact:** todas fecham integridade, segurança ou determinismo da migration; nenhuma amplia o domínio do produto.

## Issues Encountered

- O primeiro comando de geração repassou `--` ao Drizzle como argumento inválido; a geração foi repetida com `pnpm --filter ... exec drizzle-kit generate --name ...`.
- Docker, PostgreSQL e Redis reais não existem neste host. O preflight foi executado sem URLs e falhou explicitamente com exit 1; a execução real permanece corretamente reservada ao checkpoint 02-17.

## Known Stubs

None. As ocorrências de `placeholder` pertencem a validações que rejeitam hosts/placeholders, e o array vazio no runner é somente o acumulador de comandos Redis.

## User Setup Required

None neste plano. URLs/serviços reais serão fornecidos e validados no checkpoint 02-17; nenhum segredo foi criado ou persistido aqui.

## Next Phase Readiness

- Repositories podem usar as tabelas e tipos exportados sem inventar credenciais ou relações tenant-aware em cada query.
- Planos de integração/concurrency podem adicionar seus specs às convenções já selecionadas por `PHASE2_SUITE`.
- A aprovação de PostgreSQL, Redis e execução CI reais continua pendente para 02-17 e não foi inferida pelos gates offline.

## Self-Check: PASSED

- Todos os 20 arquivos do plano existem; commits `01af14e`, `5d32b89`, `d251255`, `67e67fa`, `cb9e41e`, `b9a3c2b` e `bce8157` existem no histórico.
- 14 testes passaram; lint, typecheck, build, boundaries, secret scan, migration journal, `drizzle-kit check` e validador CI passaram.
- O preflight sem `DATABASE_URL` falhou com exit 1 e mensagem explícita de que integração nunca é pulada.
- A migration 0001 não contém outbox duplicada e contém FKs cross-owner compostas mais trigger append-only.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
