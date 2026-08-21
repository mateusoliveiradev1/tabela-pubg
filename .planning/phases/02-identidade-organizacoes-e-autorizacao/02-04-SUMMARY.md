---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 04
subsystem: database-identity-sessions
tags: [postgresql, drizzle, oauth, otp, opaque-sessions, aes-256-gcm, outbox]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 03
    provides: schema persistente, migrations e runner fail-closed de integração
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 17
    provides: PostgreSQL e Redis reais aprovados para os repositories
provides:
  - consumo atômico e single-use de OAuth state e desafios OTP digest-backed
  - vinculação explícita de identidades por provider e subject sem merge por e-mail
  - delivery AES-256-GCM com outbox contendo somente deliveryId
  - sessões opacas revogáveis com sliding expiry, rotação e dispositivos
  - contexto de alerta user-bound, digest-backed e estritamente read-only
affects: [identity-use-cases, session-guards, email-worker, security-integration]
tech-stack:
  added: []
  patterns: [injected-repository-executor, conditional-update-consumption, encrypted-delivery-envelope, opaque-token-digest]
key-files:
  created:
    - packages/database/src/repositories/identity.ts
    - packages/database/src/repositories/notifications.ts
    - packages/database/src/repositories/sessions.ts
    - packages/database/src/repositories/index.ts
    - packages/database/test/identity-organizations.integration.spec.ts
    - packages/database/test/session-alert-context.integration.spec.ts
  modified:
    - packages/database/src/index.ts
    - packages/database/package.json
    - scripts/run-phase2-integration.mjs
key-decisions:
  - "Repositories recebem executor e dependências injetadas; nenhum singleton, env ou conexão é aberto dentro dos casos de persistência."
  - "OAuth state, browser binding, OTP, session token, device fingerprint e alert token persistem somente como SHA-256/HMAC; e-mail e payload de entrega permanecem no envelope AES-256-GCM."
  - "Resolver um alerta de novo dispositivo é user-bound e read-only; a revogação continua uma operação autenticada separada."
patterns-established:
  - "Consumo single-use usa UPDATE condicional com purpose, binding, expiry e estado terminal no mesmo statement."
  - "Novo dispositivo, sessão, alert context, delivery cifrada e outbox podem compartilhar a mesma transaction injetada."
  - "Suites PostgreSQL externas são opt-in no teste unitário normal e fail-closed quando executadas pelo runner oficial."
requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-006, NFR-005]
duration: 25min
completed: 2026-08-21
---

# Phase 2 Plan 04: Repositories transacionais de identidade e sessões Summary

**OAuth/OTP single-use, sessões opacas revogáveis e notificações AES-256-GCM persistidos atomicamente em PostgreSQL com outbox sem segredos**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-21T04:07:01.241Z
- **Completed:** 2026-08-21T04:32:24.752Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Implementou OAuth state ligado a browser e purpose, OTP supersedível com HMAC e tentativas atômicas, além de conflito de identidade não enumerável sem vinculação automática por e-mail.
- Implementou delivery temporária AES-256-GCM, AAD ligado ao registro, limpeza de ciphertext e outbox limitada a `deliveryId`.
- Implementou tokens de sessão e alerta com 32 bytes, persistência exclusiva de SHA-256, sliding expiry de 30 dias, teto de 90 dias, escrita coalescida em 5 minutos, rotação e revogação observável no próximo lookup.
- Implementou o fluxo transacional de novo dispositivo com device, session, alert context, notification delivery e outbox, provado por rollback real.
- Validou os repositories em Neon PostgreSQL e Redis reais: 10 testes de integração passaram, além de lint, typecheck, suite unitária e build completos do monorepo.

## Task Commits

1. **Task 1: Persistir OAuth, OTP e identidades com consumo único**
   - `a3eb369` — RED: integração PostgreSQL para OAuth, OTP, identidade e notification boundary.
   - `4f948b8` — GREEN: repositories condicionais e envelope AES-256-GCM com outbox.
2. **Task 2: Implementar sessões opacas e dispositivos revogáveis**
   - `94cccf1` — RED: lifecycle de sessão, sliding expiry, revogação, alert context e rollback.
   - `0693072` — GREEN: sessões opacas, devices e alertas transacionais.
   - `6c26acd` — correção do gate: serialização das suites PostgreSQL no endpoint pooled.
   - `bd98fba` — harness: integração externa opt-in na suite unitária e fail-closed no runner.

## Files Created/Modified

- `packages/database/src/repositories/identity.ts` — OAuth, OTP, digests e vinculação explícita de identidades.
- `packages/database/src/repositories/notifications.ts` — envelope AES-256-GCM, decrypt controlado, limpeza e outbox secret-free.
- `packages/database/src/repositories/sessions.ts` — devices, sessão opaca, touch/rotate/revoke/list e alert context read-only.
- `packages/database/src/repositories/index.ts` — barrel público dos repositories.
- `packages/database/src/index.ts` — reexporta repositories sem criar singleton.
- `packages/database/package.json` — serializa arquivos de teste que dependem de search path isolado.
- `packages/database/test/identity-organizations.integration.spec.ts` — cinco provas reais de OAuth/OTP/identity/notification/rollback.
- `packages/database/test/session-alert-context.integration.spec.ts` — cinco provas reais de sessão/expiry/revogação/alert/rollback.
- `scripts/run-phase2-integration.mjs` — inicialização segura da suite no Windows sem shell ou `.cmd` direto.

## Decisions Made

- O repository recebe um executor Drizzle que pode ser a conexão ou a transaction; operações compostas compartilham a transaction fornecida pelo caso de uso.
- HMAC do OTP inclui purpose e e-mail normalizado, evitando reutilização cruzada do mesmo código.
- O AAD do envelope de notificação inclui delivery, template, recipient digest, key version e expiry, impedindo troca de ciphertext entre registros.
- Alert context nunca atualiza `resolvedAt`, nunca autoriza sozinho e retorna somente `active`, `already-revoked` ou `not-found-expired` para o usuário autenticado correspondente.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrigido lançamento da suite de integração no Windows**
- **Found during:** Task 1, primeiro gate `phase2:integration`.
- **Issue:** Node 24 recusava `spawn("pnpm.cmd", ..., { shell: false })` com `EINVAL`, bloqueando a suite real após o preflight.
- **Fix:** o runner usa o entrypoint pnpm fornecido pelo lifecycle e o executa com `process.execPath`, mantendo `shell: false`.
- **Files modified:** `scripts/run-phase2-integration.mjs`.
- **Verification:** `pnpm phase2:integration` passou contra Neon e Redis reais.
- **Committed in:** `4f948b8`

**2. [Rule 3 - Blocking] Serializadas suites PostgreSQL com search path isolado**
- **Found during:** gate final com o comando exato do plano.
- **Issue:** arquivos executados em paralelo contra o endpoint Neon pooled perdiam a afinidade do `search_path` durante migrations concorrentes.
- **Fix:** a suite do package database passou a usar `--no-file-parallelism`; schemas continuam únicos e removidos ao final.
- **Files modified:** `packages/database/package.json`.
- **Verification:** oito arquivos e 24 testes passaram no comando do package com infraestrutura real.
- **Committed in:** `6c26acd`

**3. [Rule 2 - Missing Critical] Separado gate externo da suite unitária normal**
- **Found during:** verificação completa do monorepo.
- **Issue:** `pnpm test` sem infraestrutura externa importaria suites PostgreSQL e falharia antes do runner fail-closed, quebrando feedback unitário local.
- **Fix:** arquivos de integração executam somente quando `DATABASE_URL` está presente; o runner oficial continua exigindo PostgreSQL e Redis antes de iniciá-los.
- **Files modified:** `packages/database/test/identity-organizations.integration.spec.ts`, `packages/database/test/session-alert-context.integration.spec.ts`.
- **Verification:** `pnpm test` passou sem serviços externos e `pnpm phase2:integration` executou os 10 testes reais com serviços presentes.
- **Committed in:** `bd98fba`

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing critical). **Impact:** todos os ajustes preservam o gate fail-closed e tornam a validação determinística no Windows/Neon sem ampliar o produto.

## Issues Encountered

- O endpoint PostgreSQL pooled exigiu serialização entre arquivos que alteram `search_path`; cada suite continua usando schema aleatório próprio e limpeza garantida.
- O aviso futuro do loader nativo do Vite não afeta a execução atual; não foi alterado por estar fora do escopo funcional deste plano.

## Known Stubs

None. Todos os repositories estão ligados a PostgreSQL real e as suites externas são executadas pelo runner fail-closed.

## Threat Flags

None. O novo acesso ao banco, lifecycle de tokens e boundary transaction→outbox estão integralmente cobertos pelo threat model T-02-07/T-02-08 do plano.

## User Setup Required

None. A infraestrutura temporária já estava configurada pelo plano 02-17; nenhuma URL, chave ou connection string foi persistida.

## Next Phase Readiness

- Os casos de uso de identidade podem consumir repositories injetáveis para Discord OAuth, OTP e sessões.
- O worker de e-mail pode resolver delivery pelo ID, descriptografar com key version e limpar o envelope após entrega.
- O plano 02-05 pode reutilizar o padrão de executor/transaction e os mesmos gates PostgreSQL reais para organizações.

## Self-Check: PASSED

- Os cinco artefatos principais existem no worktree.
- Os seis commits TDD/correção do plano existem no histórico.
- Preflight real, 10 testes de integração, 24 testes do package, lint, typecheck, secret scan, suite e build do monorepo passaram.
- Nenhuma credencial, URL de serviço ou material autenticador em plaintext foi persistido.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
