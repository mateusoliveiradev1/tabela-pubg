---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 01
subsystem: identity-authorization
tags: [domain, identity, organizations, rbac, default-deny, multi-tenant, tdd]
requires:
  - phase: 01-fundacao-modular-e-ambientes
    provides: monorepo TypeScript, pacote de domínio e gates de arquitetura
provides:
  - IDs nominais e políticas temporais determinísticas para identidade
  - invariante de proteção do último proprietário
  - pacote de autorização com vocabulário finito e avaliação default-deny
affects: [api, database, organizations, tournaments, audit]
tech-stack:
  added: ["@pubg-camp/authorization"]
  patterns: [clock-injection, branded-identifiers, finite-permissions, live-snapshot-rbac, strict-role-union]
key-files:
  created:
    - packages/domain/src/identity.ts
    - packages/domain/src/organizations.ts
    - packages/authorization/src/index.ts
    - packages/authorization/src/authorization.spec.ts
  modified:
    - packages/domain/src/index.ts
    - pnpm-lock.yaml
key-decisions:
  - "OTP usa 8 dígitos, 10 minutos e 5 tentativas; step-up usa 10 minutos."
  - "Sessões usam 30 dias de inatividade com teto absoluto de 90 dias; convites expiram em 7 dias."
  - "A autorização usa 14 permissões nomeadas, sem wildcard, claims ou DSL."
  - "Owner e admin atuam na organização inteira; ownership transfer permanece exclusivo de owner."
patterns-established:
  - "Toda política temporal recebe Clock e permanece determinística em testes."
  - "Toda decisão RBAC valida ator, organização, membership e escopo antes de avaliar papéis atuais."
requirements-completed: [AUTH-005, ORG-003, ORG-004, NFR-005]
duration: 8min
completed: 2026-08-20
---

# Phase 2 Plan 1: Contratos de identidade e autorização Summary

**IDs nominais, janelas temporais determinísticas e matriz RBAC multi-tenant default-deny com seis papéis integralmente testados**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-21T02:43:17Z
- **Completed:** 2026-08-21T02:51:35Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- O domínio distingue User, Identity, Session, Device, Membership, Invitation, AuthorizationScope e AuditEvent por tipos nominais.
- OTP, convite, step-up e sessões obedecem limites explícitos e usam `Clock` injetado; a remoção do último owner retorna erro de domínio.
- Owner, admin, referee, registrations, broadcast e analyst possuem uma matriz finita com união estrita, revogação imediata e negação cross-tenant/cross-scope.

## Task Commits

1. **Criar tipos e políticas temporais puras de identidade e organizações**
   - `71bc460` — testes RED das políticas de domínio
   - `a56bc07` — implementação GREEN de identidade e último owner
2. **Implementar matriz RBAC escopada e default-deny**
   - `4e8dea4` — testes RED da matriz de seis papéis
   - `e7aa888` — implementação GREEN do avaliador escopado

## Files Created/Modified

- `packages/domain/src/identity.ts` — IDs branded, estados e políticas temporais puras.
- `packages/domain/src/organizations.ts` — memberships e erro de último owner.
- `packages/domain/src/index.ts` — barrel público do domínio ampliado.
- `packages/domain/src/identity.spec.ts` — limites temporais e distinções nominais.
- `packages/domain/src/organizations.spec.ts` — matriz da invariante de ownership.
- `packages/authorization/src/index.ts` — permissões, papéis, snapshot e função `can`.
- `packages/authorization/src/authorization.spec.ts` — matriz table-driven positiva e negativa.
- `packages/authorization/package.json` — pacote puro do workspace.
- `packages/authorization/tsconfig.json` — configuração TypeScript compartilhada.
- `pnpm-lock.yaml` — registro do novo workspace local, sem dependência externa nova.

## Decisions Made

- `organization:audit:self:read` pertence a qualquer membership ativa; auditoria completa continua exclusiva de owner/admin.
- Permissões de campeonato exigem `authorizationScopeId` explícito inclusive para owner/admin.
- Papéis ou permissões desconhecidos invalidam a decisão, e assignments de outro tenant nunca concedem capacidade.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Adicionados testes de domínio omitidos da lista de arquivos**
- **Found during:** Task 1
- **Issue:** a ação exigia TDD para as funções puras, mas os arquivos de teste não apareciam em `files_modified`.
- **Fix:** criados `identity.spec.ts` e `organizations.spec.ts` antes da implementação, com RED confirmado.
- **Files modified:** `packages/domain/src/identity.spec.ts`, `packages/domain/src/organizations.spec.ts`
- **Committed in:** `71bc460`, `a56bc07`

**Total deviations:** 1 auto-fixed (missing critical functionality). **Impact:** a mudança apenas materializa a cobertura TDD exigida pelo próprio plano.

## Issues Encountered

None.

## Known Stubs

None. Inicializadores vazios e `null` encontrados pela varredura pertencem exclusivamente a builders de teste e ao papel organizacional opcional do snapshot.

## User Setup Required

None.

## Next Phase Readiness

- Os contratos puros estão prontos para os schemas HTTP e configurações do plano 02-02.
- Nenhum endpoint, segredo, schema de banco ou nova superfície de rede foi introduzido.

## Self-Check: PASSED

- 23 testes passaram: 9 no domínio e 14 na autorização.
- Lint, typecheck e build passaram para `@pubg-camp/domain` e `@pubg-camp/authorization`.
- `pnpm lint:boundaries` passou sem violações.
- Todos os arquivos-chave e commits `71bc460`, `a56bc07`, `4e8dea4` e `e7aa888` existem.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-20*
