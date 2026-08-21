---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 21
subsystem: storage-database
tags: [organization-logo, multipart, magic-bytes, s3, postgres, drizzle, outbox]

requires:
  - phase: 02-05
    provides: repositories tenant-aware, organizações persistentes e outbox transacional
provides:
  - contratos públicos estritos para logo e cleanup opaco
  - inspeção estrutural PNG/JPEG/WebP e chave branding gerada no servidor
  - assets de logo tenant-aware com um ACTIVE por organização
  - ledger órfão independente com outbox, lease, retry e conclusão idempotente
affects: [02-07, 02-08, 02-09, organizations-api, worker-storage-cleanup]

tech-stack:
  added: []
  patterns:
    - magic-byte e estrutura mínima antes de persistir bytes
    - metadata no PostgreSQL e bytes somente em object storage
    - cleanup órfão independente da vida da organização

key-files:
  created:
    - packages/storage/src/organization-logo.ts
    - packages/database/migrations/0002_organization_logos.sql
    - packages/database/test/organization-logo.integration.spec.ts
  modified:
    - packages/contracts/src/organizations.ts
    - packages/storage/src/index.ts
    - packages/database/src/schema/organizations.ts
    - packages/database/src/repositories/organizations.ts

key-decisions:
  - "O worker recebe somente cleanupId; provider e object key permanecem no ledger server-side."
  - "A ativação serializa na organização e marca o asset anterior DELETE_PENDING na mesma transação."
  - "Testes de concorrência usam o endpoint Neon direto; o pooler transacional não preserva search_path."

patterns-established:
  - "Logo seguro: validateUpload, inspeção estrutural, igualdade de MIME e SHA-256 antes do putObject."
  - "Cleanup durável: ledger sem organization FK, enqueue+outbox atômicos e claim com lease."

requirements-completed: [ORG-001, NFR-005]

duration: 27min
completed: 2026-08-21
---

# Phase 2 Plan 21: Fundação segura de logos de organização Summary

**Pipeline de logos com inspeção real de PNG/JPEG/WebP, metadata tenant-aware e cleanup órfão transacional validado em PostgreSQL Neon e Redis reais.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-08-21T05:26:49Z
- **Completed:** 2026-08-21T05:53:18Z
- **Tasks:** 3
- **Files modified:** 16

## Accomplishments

- Contratos multipart rejeitam bytes/base64, filename, bucket, key e payloads de cleanup além de `cleanupId`.
- Inspeção server-side aceita apenas PNG/JPEG/WebP estruturais até 2 MiB, rejeitando MIME spoofing, HTML/SVG e polyglots com conteúdo trailing.
- Migration 0002 adiciona assets tenant-aware, um único logo ativo por organização e ledger órfão sem FK de organização.
- Repositories provam rollback da troca, concorrência com duas conexões, outbox atômico, lease, retry e complete idempotentes.

## Task Commits

Cada tarefa seguiu RED → GREEN e foi commitada atomicamente:

1. **Task 1: contratos e bytes reais** — `8b9eac4` (RED), `fa1114f` (GREEN)
2. **Task 2: metadata e migration** — `4520a01` (RED), `1422a85` (GREEN)
3. **Task 3: ativação e cleanup transacionais** — `fc4c6c5` (RED), `09efa5d` (GREEN)

## Files Created/Modified

- `packages/contracts/src/organizations.ts` — schemas multipart, resposta pública e job opaco.
- `packages/storage/src/organization-logo.ts` — inspeção estrutural, digest e upload server-side.
- `packages/storage/src/index.ts` — adapter com `putObject`/`deleteObject` e validação de key.
- `packages/database/src/schema/organizations.ts` — assets, enums, constraints e ledger órfão.
- `packages/database/migrations/0002_organization_logos.sql` — migration incremental validada do zero.
- `packages/database/src/repositories/organizations.ts` — pending/active logo e cleanup transacional.
- `packages/database/test/organization-logo.integration.spec.ts` — integração e concorrência PostgreSQL real.

## Decisions Made

- Object key é sempre `branding/{organizationUUID}/{objectUUID}` e nunca aceita filename/path do cliente.
- Banco persiste metadata e key server-side; URL assinada e bytes não entram no schema.
- `StorageCleanupRepository` não recebe `organizationId` e abre sua própria transação para ledger+outbox.
- O submódulo de logo do pacote storage possui export explícito para manter o grafo sem ciclos.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removido ciclo no pacote storage**
- **Found during:** Task 3
- **Issue:** reexportar `organization-logo` no barrel que ele próprio importava violava o gate `no-circular`.
- **Fix:** o módulo ganhou subpath exportado e entry própria no build, preservando o reuso de `validateUpload`/`createObjectKey`.
- **Files modified:** `packages/storage/package.json`, `packages/storage/src/index.ts`
- **Verification:** `pnpm lint:boundaries` e build global verdes.
- **Committed in:** `09efa5d`

**2. [Rule 1 - Bug] Corrigido key-link com descrição misturada ao path**
- **Found during:** verificação final
- **Issue:** o segundo `from` do plano continha texto descritivo e não resolvia para arquivo.
- **Fix:** normalizado para o path real do repository.
- **Files modified:** `02-21-PLAN.md`
- **Verification:** `verify.key-links` retornou 3/3.
- **Committed in:** metadata final do plano.

---

**Total deviations:** 2 auto-fixed (2 bugs). **Impact:** correções mantêm a arquitetura planejada e eliminam falso negativo/ciclo de dependência sem ampliar o produto.

## Issues Encountered

- A connection string padrão fornecida pelo Neon apontava ao pooler transacional, inadequado para testes que dependem de `search_path` e duas sessões. O endpoint direto do mesmo compute foi obtido via Neon e a suíte real passou.
- Uma primeira invocação PowerShell foi bloqueada pela política de execução. A chamada foi refeita com `pnpm.cmd`; nenhuma credencial foi persistida. O secret scan final passou em 200 arquivos.
- A suíte integrada completa levou 126 s por recriar schemas isolados no Neon; concluiu com 3 arquivos e 17 testes verdes.

## Known Stubs

None. O único array vazio localizado pelo scan é um acumulador tipado no teste concorrente e recebe resultados reais antes da asserção.

## Verification

- PostgreSQL Neon + Redis real preflight: PASS.
- Migration 0000 → 0002 do zero: PASS.
- Integração real: 3 arquivos, 17 testes: PASS.
- Logo integration focal: 3/3: PASS.
- Unitários globais: 21 tarefas Turbo: PASS.
- Build global: 13 tarefas Turbo: PASS.
- `verify:migrations`, `db:check`, `verify:secrets`, `lint:boundaries`: PASS.
- Key-links: 3/3: PASS.

## User Setup Required

None - Neon/Redis foram usados somente como infraestrutura de integração e nenhuma credencial foi gravada.

## Next Phase Readiness

- Foundation pronta para endpoints de organização e worker de cleanup.
- S3 real permanece deliberadamente fora deste plano; adapter e inspeção foram verificados com fake unitário.

## Self-Check: PASSED

- Quatro key files confirmados no disco.
- Seis commits RED/GREEN confirmados no histórico.
- Nenhuma deleção inesperada ou credencial persistida.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
