---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 22
subsystem: api-storage-worker
tags: [multipart, s3, organization-logo, postgres, outbox, bullmq, tenant-authorization]

requires:
  - phase: 02-21
    provides: inspeção estrutural de imagens, metadata tenant-aware e ledger órfão durável
  - phase: 02-09
    provides: organizações, membership live, auditoria e autorização tenant-aware
provides:
  - upload multipart limitado com inspeção de bytes antes do commit
  - criação e substituição de logo com compensação e cleanup transacional
  - URLs assinadas curtas ou fallback seguro para listas e convites
  - processor cleanupId-only com lease, delete idempotente e retry persistente
affects: [02-13, 02-14, organizations-ui, invitation-preview, deployment-storage]

tech-stack:
  added: []
  patterns:
    - multipart streaming com hard limit e metadata derivada no servidor
    - object storage antes da transação com delete compensatório e ledger independente
    - worker resolve provider/key somente do ledger server-side

key-files:
  created:
    - apps/api/src/organizations/ports/organization-logo-storage.ts
    - apps/api/src/organizations/adapters/s3-organization-logo-storage.ts
    - apps/api/src/organizations/organization-logo.integration.spec.ts
    - apps/worker/src/storage/logo-cleanup.processor.ts
    - apps/worker/src/storage/logo-cleanup.processor.spec.ts
  modified:
    - apps/api/src/organizations/organizations.service.ts
    - apps/api/src/organizations/organizations.controller.ts
    - apps/api/src/organizations/invitations.service.ts
    - apps/worker/src/main.ts
    - packages/database/src/repositories/organizations.ts

key-decisions:
  - "Multipart aceita somente name/logo, deriva MIME/tamanho do part e nunca encaminha filename ou object key."
  - "Replace ativa o novo asset e enfileira cleanup do anterior na mesma transação PostgreSQL."
  - "Falha de assinatura ou ausência do asset devolve fallback same-origin sem revelar bucket/key."
  - "Worker recebe somente cleanupId e registra apenas cleanupId/outcome em logs."

patterns-established:
  - "Compensação segura: putObject → transação → delete imediato; falha do delete → ledger+outbox independente."
  - "Cleanup idempotente: claim com lease → key validada → delete/404-success → complete ou retry persistente."

requirements-completed: [AUTH-005, ORG-001, ORG-002, NFR-005]

duration: 23min
completed: 2026-08-21
---

# Phase 2 Plan 22: Upload e cleanup seguro de logos Summary

**Logos de organizações agora fluem por multipart limitado, inspeção real, commit tenant-aware compensado, URL assinada curta e cleanup idempotente por worker.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-08-21T08:42:38Z
- **Completed:** 2026-08-21T09:05:14Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments

- API recebe multipart em stream com teto rígido, aceita apenas `name`/`logo` e valida estrutura/MIME antes de gravar S3 ou PostgreSQL.
- Criação faz rollback compensado; substituição preserva o logo anterior até commit e grava ledger+outbox do cleanup na mesma transação.
- Owner/admin live pode substituir logo; member, cross-org, oversized, MIME spoof e metadata manipulada falham antes de ativação.
- Listas e preview de convite geram URL assinada por até 300 segundos ou fallback same-origin, sem expor bucket, key ou digest.
- Worker separado consome somente `cleanupId`, valida a key carregada do ledger e aplica lease, 404 idempotente, complete e retry exponencial.

## Task Commits

Cada tarefa seguiu RED → GREEN:

1. **Task 1: Integrar multipart seguro à criação e edição** — `a295fcc` (RED), `7cbf702` (GREEN)
2. **Task 2: Processar cleanup idempotente e provar falhas** — `9d83a53` (RED), `7d32437` (GREEN)

## Files Created/Modified

- `apps/api/src/organizations/ports/organization-logo-storage.ts` — port mínimo de store/delete/download.
- `apps/api/src/organizations/adapters/s3-organization-logo-storage.ts` — adapter comum do pacote storage.
- `apps/api/src/organizations/organizations.controller.ts` — endpoints create/update/get e parser multipart estrito.
- `apps/api/src/organizations/organizations.service.ts` — autorização, ativação, compensação e projeção de URL segura.
- `apps/api/src/organizations/invitations.service.ts` — resolve logo somente após preview opaco válido.
- `packages/database/src/repositories/organizations.ts` — enqueue reutilizável dentro de transação existente.
- `apps/worker/src/storage/logo-cleanup.processor.ts` — claim/delete/complete/retry sem aceitar key no job.
- `apps/worker/src/main.ts` — S3 compartilhado e worker dedicado `storage-logo-cleanup`.

## Decisions Made

- O parser multipart não depende de biblioteca externa: Fastify entrega o stream ao coletor limitado e o controller interpreta somente dois campos permitidos.
- O adapter S3 é criado explicitamente nos entrypoints com as variáveis `S3_*` já existentes no `.env.example`.
- Preview de convite resolve logo no service somente depois que o repository confirmou o token opaco e retornou status `valid`.
- Erros do provider nunca entram nos logs/ledger; retry persiste uma razão estável e redigida.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Registrado parser multipart e adapter S3 no bootstrap da API**
- **Found during:** Task 1
- **Issue:** sem `addContentTypeParser`, Fastify rejeitaria multipart com 415 antes do controller e não haveria adapter de produção.
- **Fix:** `main.ts` registra parser streaming com limite próprio e constrói o adapter a partir de `S3_*`.
- **Files modified:** `apps/api/src/main.ts`
- **Verification:** testes multipart, typecheck e build API verdes.
- **Committed in:** `7cbf702`

**2. [Rule 2 - Missing Critical] Tornado o enqueue de cleanup reutilizável dentro da transação de replace**
- **Found during:** Task 1
- **Issue:** o helper anterior sempre abria transação própria, impedindo ativação+ledger+outbox atômicos.
- **Fix:** extraído `enqueueOrphanCleanup(executor, input)` e preservado o wrapper independente para compensação.
- **Files modified:** `packages/database/src/repositories/organizations.ts`
- **Verification:** integração real Neon passou 3 arquivos/17 testes e key-link service→repository validou.
- **Committed in:** `7cbf702`

**3. [Rule 2 - Missing Critical] Ligado resolver de logo ao preview de convite**
- **Found during:** Task 1
- **Issue:** o preview existente fixava `logoUrl: null`, contrariando o must-have de URL assinada/fallback.
- **Fix:** resolver é chamado apenas após preview opaco válido e projeta URL pública sem metadata de storage.
- **Files modified:** `apps/api/src/organizations/invitations.service.ts`, `apps/api/src/organizations/organizations.module.ts`
- **Verification:** teste de preview confirma ordem e ausência de bucket/objectKey.
- **Committed in:** `7cbf702`

**4. [Rule 1 - Bug] Normalizado key-link combinado para um arquivo verificável**
- **Found during:** verificação final
- **Issue:** `from: apps/api/package.json + apps/worker/package.json` não era um path real e produzia falso negativo.
- **Fix:** o link aponta ao lockfile, que comprova ambos os manifests workspace.
- **Files modified:** `02-22-PLAN.md`
- **Verification:** `verify.key-links` retornou 4/4.
- **Committed in:** metadata final do plano.

---

**Total deviations:** 4 auto-fixed (3 missing critical, 1 bug). **Impact:** os ajustes fecham wiring e atomicidade indispensáveis, sem nova dependência externa ou ampliação de produto.

## Issues Encountered

- A execução simultânea de `pnpm test` e `pnpm build` disputou a limpeza de `packages/database/dist` no Windows e gerou EPERM. A suíte foi repetida isoladamente e passou 22/22 tarefas; não houve defeito no código.
- O build Next global manteve o warning conhecido de path longo no symlink Bowser/AWS SDK, com exit code 0.

## Known Stubs

None. Arrays vazios localizados pelo scan são acumuladores reais ou fixtures de teste; não alimentam UI/rotas como placeholder.

## Verification

- TDD Task 1: RED confirmado; API focal 24 arquivos/134 testes verdes.
- TDD Task 2: RED confirmado; worker 4 arquivos/17 testes verdes.
- PostgreSQL Neon direto + Redis real preflight: PASS.
- Integração real stateful: 3 arquivos/17 testes: PASS.
- API/worker lint, typecheck e builds focais: PASS.
- Build global: 13/13 tarefas: PASS.
- Testes globais: 22/22 tarefas: PASS.
- Boundaries: 202 módulos/430 dependências sem violações.
- Secret scan: 275 arquivos: PASS.
- Key-links: 4/4: PASS.

## User Setup Required

None - o plano reutiliza as variáveis `S3_*` já documentadas em `.env.example`; a validação usou adapter fake e Neon/Redis de integração sem persistir credenciais.

## Next Phase Readiness

- API e worker estão prontos para as telas de organização e branding da próxima wave.
- Execução contra S3/MinIO real permanece para o gate de implantação; nenhum segredo de provider foi necessário ou gravado neste plano.

## Self-Check: PASSED

- Cinco key files criados foram confirmados no disco.
- Quatro commits RED/GREEN foram confirmados no histórico.
- Nenhuma deleção inesperada, stub bloqueante ou credencial persistida.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
