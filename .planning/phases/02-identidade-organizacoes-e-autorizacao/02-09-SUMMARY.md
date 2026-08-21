---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 09
subsystem: api-organizations-authorization
tags: [nestjs, postgres, organizations, invitations, rbac, audit, outbox, aes-gcm]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 07
    provides: adapters PostgreSQL/Redis e infraestrutura de identidade
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 08
    provides: schema de organizações, memberships, convites, auditoria e notification delivery
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 16
    provides: sessão, CSRF e autorização global default-deny
provides:
  - criação e listagem explícita de organizações sem tenant ativo implícito
  - convites por e-mail com token opaco, delivery cifrado, outbox e aceite atômico
  - gestão de membros, cargos e transferência de ownership com step-up e invariant de último owner
  - auditoria tenant-aware redigida com filtros e paginação no PostgreSQL
affects: [02-11, 02-12, 02-19, organization-api, bff, notifications-worker]
tech-stack:
  added: []
  patterns: [transactional-outbox, opaque-invitation-token, recent-auth-step-up, last-owner-invariant, server-side-audit-projection]
key-files:
  created:
    - apps/api/src/organizations/organizations.service.ts
    - apps/api/src/organizations/invitations.service.ts
    - apps/api/src/organizations/members.service.ts
    - apps/api/src/organizations/organizations.module.ts
    - apps/api/src/audit/audit.service.ts
    - apps/api/src/audit/audit.module.ts
  modified:
    - apps/api/src/app.module.ts
    - apps/api/src/main.ts
    - packages/database/src/repositories/organizations.ts
    - packages/database/src/repositories/audit.ts
    - packages/contracts/src/organizations.ts
    - packages/contracts/src/audit.ts
key-decisions:
  - "Toda seleção de organização permanece explícita; criar ou listar organizações não altera tenant ativo em sessão ou cookie."
  - "Convite, auditoria, envelope cifrado e outbox são persistidos na mesma transação; o worker recebe somente deliveryId."
  - "Mudanças privilegiadas exigem step-up recente e motivo; transferência de owner também revoga as outras sessões do novo owner."
  - "Owners/admins veem auditoria da organização e membros somente os próprios eventos; filtros, contagem e paginação são aplicados no banco antes da projeção redigida."
patterns-established:
  - "Tokens de convite possuem 256 bits, são armazenados somente por digest e nunca retornam nas respostas."
  - "A invariável de último owner é verificada dentro da transação que altera membership/ownership."
requirements-completed: [AUTH-004, AUTH-005, ORG-001, ORG-002, ORG-003, ORG-004, ORG-005, AUD-001, NFR-005]
duration: 37min
completed: 2026-08-21
---

# Phase 2 Plan 09: Organizações, convites, membros e auditoria Summary

**APIs Nest completas para organizações e memberships, convites transacionais com delivery cifrado e auditoria redigida/paginada no PostgreSQL**

## Performance

- **Duration:** 37 min
- **Started:** 2026-08-21T07:06:31Z
- **Completed:** 2026-08-21T07:43:31Z
- **Tasks:** 3
- **Files modified:** 23

## Accomplishments

- Criou organizações e listou memberships do ator autenticado sem escolher organização ativa implicitamente.
- Implementou create/resend/accept de convites vinculados ao e-mail verificado, com expiração, uso único, substituição segura e membership/roles atômicos.
- Gravou convite, auditoria, envelope AES-GCM e outbox no mesmo executor transacional; nenhum e-mail real foi enviado nos testes.
- Protegeu alterações de membros e ownership com RBAC tenant-aware, motivo obrigatório, reautenticação recente, revogação de sessões e invariável concorrente de último owner.
- Expôs auditoria com visibilidade owner/admin ou self-only, labels seguros, pares before/after allowlisted, correlação, scope, filtros e paginação no banco.

## Task Commits

1. **Task 1: Criar organizações e gerenciar convites vinculados ao e-mail**
   - `24277cf` — RED: especificações falhando de organizações e convites.
   - `678375f` — GREEN: criação/listagem e lifecycle transacional de convites.
2. **Task 2: Gerenciar membros, cargos e transferência de propriedade**
   - `8c81215` — RED: especificações falhando de autorização de membros.
   - `ebe4a1b` — GREEN: cargos, step-up, ownership e invariável de último owner.
3. **Task 3: Expor auditoria filtrada e redigida**
   - `b028d5b` — RED: especificações falhando de visibilidade e redação.
   - `0e4146b` — GREEN: projeção de auditoria tenant-aware.
   - `e9a8449` — PERF: filtros, contagem e paginação movidos para a fronteira PostgreSQL.

## Files Created/Modified

- `apps/api/src/organizations/organizations.service.ts` e controller — criar/listar organizações sem tenant implícito.
- `apps/api/src/organizations/invitations.service.ts` e controller — create/resend/accept com token opaco e delivery transacional.
- `apps/api/src/organizations/members.service.ts` e controller — roles, revogação e transferência com step-up.
- `apps/api/src/organizations/organizations.module.ts` — adapters reais PostgreSQL, criptografia e tokens no runtime Nest.
- `apps/api/src/audit/audit.service.ts`, controller e module — filtros, visibilidade e projeção redigida.
- `packages/database/src/repositories/organizations.ts` — transações de convites, memberships, roles e ownership.
- `packages/database/src/repositories/audit.ts` — append seguro, visibilidade e página limitada no banco.
- `packages/database/src/repositories/sessions.ts` — consulta de reautenticação recente.
- `packages/contracts/src/organizations.ts` e `packages/contracts/src/audit.ts` — contratos inferidos e paginação auditável.
- `apps/api/src/app.module.ts` e `apps/api/src/main.ts` — registro dos módulos e bootstrap com infraestrutura real.

## Decisions Made

- A organização corrente nunca é inferida de criação/listagem: cada operação recebe organizationId explícito e a autorização recarrega o membership ao vivo.
- Resend cria uma substituição e supersede o convite anterior na mesma transação, preservando integridade referencial e a unicidade de convite ativo.
- O pseudopermissão `authenticated` só libera operações de bootstrap depois do SessionGuard; rotas tenant-aware continuam exigindo permission metadata específica.
- Auditoria não expõe JSON bruto: apenas campos allowlisted são projetados, e valores com token, cookie, OTP, senha, segredo, ciphertext ou e-mail completo viram nulos.
- A paginação de auditoria é executada no PostgreSQL para limitar egress e memória; enriquecimento e redação operam somente sobre uma página limitada.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Ligados endpoints e transações a adapters reais**
- **Found during:** Tasks 1 e 2
- **Issue:** services isolados não tornariam os endpoints utilizáveis nem garantiriam atomicidade entre domínio, audit e outbox.
- **Fix:** ampliou repositories/contratos, adicionou metadata authenticated fail-closed e registrou módulos com database, criptografia, token generator e recent-auth reais.
- **Files modified:** `apps/api/src/organizations/*`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `packages/database/src/repositories/organizations.ts`
- **Committed in:** `678375f`, `ebe4a1b`

**2. [Rule 1 - Bug] Permitida revogação de um owner quando outro owner ativo permanece**
- **Found during:** Task 2, suíte concorrente real
- **Issue:** uma defesa excessiva bloqueava admin de revogar qualquer owner, mesmo com dois owners ativos, contrariando a invariável que proíbe somente remover o último.
- **Fix:** manteve a contagem/lock transacional de último owner e removeu a proibição ampla.
- **Files modified:** `apps/api/src/organizations/members.service.ts`
- **Verification:** suíte concorrente Neon confirmou 2/2 cenários de last-owner e 2/2 cenários de convite.
- **Committed in:** `ebe4a1b`

**3. [Rule 1 - Security] Rotacionada credencial Neon após exposição acidental em saída de ferramenta**
- **Found during:** validação de integração
- **Issue:** a primeira injeção PowerShell expandiu uma variável de ambiente e mostrou a connection string na saída da ferramenta.
- **Fix:** rotacionou imediatamente a senha da role na branch isolada, revogando a credencial anterior; as execuções seguintes usaram injeção somente em memória e saída redigida.
- **Files modified:** nenhum arquivo do repositório.
- **Verification:** preflight real passou com a nova credencial e `pnpm verify:secrets` não encontrou segredo persistido.

**4. [Rule 2 - Performance] Paginação de auditoria movida para o PostgreSQL**
- **Found during:** verificação consolidada da Task 3
- **Issue:** a primeira implementação paginava corretamente a resposta, mas carregava todos os eventos visíveis antes de filtrar, contrariando NFR-005 sob histórico crescente.
- **Fix:** adicionou query de count/filtros/limit/offset no repository e manteve a projeção segura sobre apenas uma página.
- **Files modified:** `packages/database/src/repositories/audit.ts`, `apps/api/src/audit/audit.service.ts`
- **Committed in:** `e9a8449`

---

**Total deviations:** 4 auto-fixed (2 missing critical/performance, 2 bugs/security). **Impact:** atomicidade, segurança e desempenho do escopo planejado ficaram completos sem adicionar dependências externas.

## Issues Encountered

- A URL pooled do Neon não preservava o `search_path` de sessão usado pelo harness de migrations isoladas; a validação usou o endpoint direto da mesma branch apenas em memória.
- Context7/CLI não estava disponível; nenhuma API externa nova foi introduzida e a implementação seguiu os packages e tipos já instalados no workspace.

## Known Stubs

- O metadata de logo é validado na criação, mas upload/persistência e lifecycle visual pertencem ao plano 02-11. Isso não impede organizações, convites, autorização ou auditoria deste plano.

## User Setup Required

None. Neon e Redis já estavam provisionados; nenhuma connection string foi gravada e nenhum e-mail real foi enviado.

## Next Phase Readiness

- O plano 02-11 pode consumir organização/membership reais para completar logo e personalização visual.
- BFF e UI podem listar organizações, operar convites/membros e consultar audit page sem mocks.
- Não há bloqueador restante; os três key-links do plano foram verificados.

## Self-Check: PASSED

- SUMMARY, organization service e audit service existem no workspace.
- Os sete commits RED/GREEN/PERF (`24277cf`, `678375f`, `8c81215`, `ebe4a1b`, `b028d5b`, `0e4146b`, `e9a8449`) existem no histórico e preservam a ordem TDD.
- Integração Neon/Redis concluiu 3 arquivos e 17/17 testes; a suíte concorrente confirmou os quatro cenários críticos.
- API concluiu 119 testes passados e 6 skips infrastructure-only; lint, typecheck e build concluíram 12/12 tasks.
- `verify.key-links` confirmou 3/3 vínculos, secret scan passou em 241 arquivos e `git diff --check` não encontrou erros.
- Stub scan não encontrou TODO/FIXME/placeholder em produção; o único handoff conhecido é o lifecycle de logo explicitamente reservado ao plano 02-11.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
