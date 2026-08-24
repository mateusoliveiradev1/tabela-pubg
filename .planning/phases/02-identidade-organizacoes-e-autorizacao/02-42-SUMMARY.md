---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 42
subsystem: identity
tags: [postgresql, transaction, identity-link, email-change, session-rotation, outbox, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 25
    provides: Proofs actor/session-bound e outbox transacional
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 27
    provides: Sessões opacas, trust persistido e lifecycle autoritativo
  - phase: 02-identidade-organizacoes-e-autorizacao
    plans: [30, 31]
    provides: Proofs OTP/OAuth one-use com candidates server-side
provides:
  - Comando único D-08 para vínculo de identidade e troca ordinária de e-mail
  - Rotação do token atual, reautenticação, revogação das demais sessões e evidência no mesmo commit
  - Proof purpose-bound para impedir reutilização entre link-identity, link-email e change-email
  - Regressões PostgreSQL reais de rollback por fronteira, replay, binding e concorrência
affects: [02-32, 02-36, 02-37]

tech-stack:
  added: []
  patterns:
    - Token opaco de 256 bits gerado antes da transação e liberado somente após commit
    - Proof lock/recheck e consume condicional no mesmo executor da identidade, sessão e outbox
    - Evento de segurança account-scoped com payload allowlisted e sem candidate ou credencial

key-files:
  created:
    - packages/database/src/repositories/identity-security-change.ts
    - packages/database/src/identity-security-change-harness.test.ts
    - packages/database/test/identity-security-change.integration.spec.ts
    - packages/database/migrations/0005_open_iron_lad.sql
    - packages/database/migrations/meta/0005_snapshot.json
  modified:
    - packages/database/package.json
    - packages/database/src/repositories/identity.ts
    - packages/database/src/repositories/index.ts
    - packages/database/src/schema/identity.ts
    - packages/database/test/identity-organizations.integration.spec.ts
    - packages/database/migrations/meta/_journal.json

key-decisions:
  - "A proof persiste a finalidade exata e o comando exige igualdade de purpose, actor, sessão, provider e candidate antes do consume."
  - "Proofs email legadas sem purpose recuperável são encerradas pela migration; não há inferência que possa autorizar link ou troca errados."
  - "Mudança account-only produz somente identity.security-state-changed no outbox; nenhuma linha de auditoria organizacional é fabricada."
  - "O token cru de reposição nasce antes da transaction, mas só é retornado depois que proof, identidade, sessão e evidência confirmam o mesmo commit."
  - "O teste offline do pacote exclui integração real; o config phase2 preflighted continua sendo a única rota de execução do spec D-08."

patterns-established:
  - "D-08 atomic boundary: nenhum caller externo pode separar consume, identity mutation, token rotation, revoke-others ou evidence append."
  - "Failure injection: cada uma das cinco fronteiras duráveis é observável somente por hook de teste e sempre reverte o snapshot integral."

requirements-completed: [AUTH-002, AUTH-003, AUTH-006, NFR-005]

duration: 16min
completed: 2026-08-24
---

# Phase 2 Plan 42: Atomic Identity Security Change Summary

**Vínculo de identidade e troca ordinária de e-mail agora consomem a proof, alteram a identidade, substituem a sessão atual, revogam as demais e registram evidência redigida em uma única transação PostgreSQL.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-24T11:59:12Z
- **Completed:** 2026-08-24T12:15:02Z
- **Tasks:** 1 TDD
- **Files modified:** 11

## Accomplishments

- Exportou `IdentitySecurityChangePort` e o comando repository-owned que abre exatamente uma `database.transaction` e compartilha seu executor com proof, identity, session e outbox.
- Implementou link Discord/email e substituição explícita da identidade e do e-mail verificado, sem merge por coincidência e com zero-row/constraint fail-closed.
- Gerou 32 bytes opacos antes da transaction, persistiu somente o digest, renovou `reauthenticated_at`, preservou o trust autoritativo, revogou todas as outras sessões e retornou o token cru somente após commit.
- Persistiu `identity.security-state-changed` com payload allowlisted; subject, e-mail, proof digest, token e credenciais de provider não entram no evento.
- Provou rollback byte-for-byte após proof consume, identity mutation, current-session rotation, revoke-others e evidence append, além de cross-session, wrong-actor, stale, mismatch, replay e corrida com um vencedor.

## Task Commits

1. **TDD RED: contrato PostgreSQL completo da fronteira D-08** — `53b7e3c`
2. **TDD GREEN: comando atômico, purpose-bound proof e migration** — `2286614`
3. **Harness: integração real isolada da suíte offline** — `9b0f14d`
4. **Contrato estrutural: cadeia dedicada phase2 travada ponta a ponta** — `5b04a6a`

## Files Created/Modified

- `packages/database/src/repositories/identity-security-change.ts` — porta/comando D-08, validação bound, mutation, rotação/revogação e outbox.
- `packages/database/test/identity-security-change.integration.spec.ts` — 11 regressões reais, incondicionais e run-scoped.
- `packages/database/migrations/0005_open_iron_lad.sql` — purpose explícito para proofs e encerramento fail-closed de proofs email legadas ambíguas.
- `packages/database/migrations/meta/0005_snapshot.json` e `_journal.json` — metadata Drizzle da migration 0005.
- `packages/database/src/schema/identity.ts` — enum/coluna `identity_link_proof_purpose` obrigatória.
- `packages/database/src/repositories/identity.ts` — producers OTP/OAuth persistem a finalidade da proof.
- `packages/database/src/repositories/index.ts` — export público da nova fronteira.
- `packages/database/test/identity-organizations.integration.spec.ts` — fixtures OAuth atualizadas com purpose explícito.
- `packages/database/package.json` — suíte offline exclui explicitamente specs `integration` e `concurrent`.
- `packages/database/src/identity-security-change-harness.test.ts` — contrato estrutural que mantém o spec D-08 no runner real preflighted, sem escapes de skip.

## Decisions Made

- O vínculo de finalidade da proof é parte da autoridade durável, não inferência do provider ou do estado atual da conta.
- Link cria identidade explícita; change-email atualiza somente a identidade email indicada e seu único verified-email ativo, ambos scoped pelo actor.
- O lock da sessão atual precede o lock/recheck da proof, serializando dois consumidores do mesmo actor/session; o consume condicional continua sendo a garantia one-use.
- O outbox account-scoped é o registro durável aplicável porque o schema de audit é organization-bound.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Persistência da finalidade da proof**
- **Found during:** Task 1, desenho do negativo de purpose mismatch.
- **Issue:** `identity_link_proofs` guardava actor/session/provider/candidate, mas não distinguia `link-identity`, `link-email` e `change-email`; isso permitiria reaproveitar uma proof para outra operação.
- **Fix:** migration 0005, enum/coluna obrigatória e producers atualizados; proofs email legadas ambíguas são encerradas fail-closed.
- **Files modified:** schema, migration/snapshot/journal, `identity.ts` e fixtures existentes.
- **Verification:** migration journal/check, fresh apply do spec e negativos purpose-mismatched.
- **Committed in:** `2286614`

**2. [Rule 1 - Bug] Isolamento de `search_path` no harness dedicado**
- **Found during:** primeiro gate GREEN PostgreSQL.
- **Issue:** o client principal tinha pool maior que um, mas `search_path` é session-scoped; queries posteriores podiam cair em `public`.
- **Fix:** client principal limitado a uma conexão; a corrida continua usando um segundo client explícito no mesmo schema.
- **Files modified:** `packages/database/test/identity-security-change.integration.spec.ts`.
- **Verification:** 11/11 dedicados e 34/34 nas duas suites de identidade.
- **Committed in:** `2286614`

**3. [Rule 3 - Blocking] Serviços reais temporários para o gate obrigatório**
- **Found during:** preflight inicial.
- **Issue:** o processo não herdou `DATABASE_URL`/`REDIS_URL` e o plano proíbe skip.
- **Fix:** PostgreSQL 16.15 oficial e Redis 8.10 foram iniciados loopback-only em portas/diretórios run-scoped; URLs ficaram somente no processo.
- **Files modified:** nenhum arquivo do repositório.
- **Verification:** preflight real, exact selector, package suite e zero listeners após shutdown.
- **Committed in:** n/a.

**4. [Rule 1 - Bug] Integração real isolada do teste offline agregado**
- **Found during:** gate agregado pós-wave.
- **Issue:** o `test` padrão do pacote database descobria `identity-security-change.integration.spec.ts` sem o provisionamento real do runner dedicado e falhava apenas pela ausência de `DATABASE_URL`.
- **Fix:** o comando offline exclui explicitamente os globs `integration`/`concurrent`; um teste estrutural garante que o config dedicado continua incluindo o spec D-08, executa preflight antes da suíte e não aceita `skip`, `todo` ou `passWithNoTests`.
- **Files modified:** `packages/database/package.json` e `packages/database/src/identity-security-change-harness.test.ts`.
- **Verification:** teste estrutural 2/2, pacote offline 24/24, exact selector sem `DATABASE_URL` falha fechado no `beforeAll`, root test 22/22 e root build 13/13.
- **Committed in:** `9b0f14d`, `5b04a6a`

---

**Total deviations:** 4 auto-fixed (1 missing critical, 2 bugs, 1 blocking issue).
**Impact on plan:** mudanças mínimas e diretamente necessárias para cumprir binding, atomicidade e evidência D-08; nenhum redesign de serviço, controller ou UI.

## Issues Encountered

- O caso cross-actor preexistente de `runtime-security-migration.integration.spec.ts` usa timestamps absolutos já vencidos e recebe `23514` antes do FK `23503`; foi registrado em `deferred-items.md`. Fresh apply, upgrade e os outros três casos desse harness passaram antes desse negativo temporal.

## Known Stubs

None — o scan dos arquivos criados/modificados não encontrou TODO, FIXME, placeholder nem retorno vazio ligado à produção.

## Verification

- `rtk pnpm phase2:integration:preflight` — PASS contra PostgreSQL e Redis reais.
- `rtk pnpm --filter @pubg-camp/database exec vitest run test/identity-security-change.integration.spec.ts` — PASS, 11/11, zero skips.
- Suites `identity-organizations` + `identity-security-change` — PASS, 34/34.
- `rtk pnpm --filter @pubg-camp/database test` — PASS, 70 testes; 4 skips preexistentes da suite migration condicionada.
- `rtk pnpm --filter @pubg-camp/database test` sem URLs de serviço — PASS, 24/24 offline; nenhum spec real selecionado.
- Exact selector D-08 sem `DATABASE_URL` — FAIL esperado e não-zero no `beforeAll`, comprovando execução fail-closed sem skip.
- Teste estrutural do harness — PASS, 2/2; integração D-08 permanece incluída no config dedicado após preflight.
- `rtk pnpm test` — PASS, 22/22 tarefas do monorepo.
- `rtk pnpm build` — PASS, 13/13 pacotes.
- `rtk pnpm verify:migrations` — PASS, 6 migrations e `drizzle-kit check` verde.
- Database typecheck e build — PASS.
- Biome nos seis arquivos TypeScript tocados — PASS.
- Cleanup — PASS; PostgreSQL/Redis run-scoped encerrados, zero listeners e diretório temporário removido.

## TDD Gate Compliance

- RED `53b7e3c` falhou após preflight real porque a fronteira `identity-security-change` ainda não existia.
- GREEN `2286614` veio depois do RED e passou exact selector, regressões existentes, migrations, tipos, build e lint.

## Authentication Gates

None.

## User Setup Required

None — nenhuma credencial, URL de serviço ou segredo foi persistido.

## Next Phase Readiness

- 02-36 pode encaminhar proofs OTP ainda não consumidas e publicar cookie/CSRF somente com o token retornado após commit.
- 02-37 pode manter o callback OAuth limitado à criação da pending proof e delegar a confirmação final a esta porta.
- 02-32 pode usar esta fronteira como único writer no controller protegido de confirmação de vínculo.

## Self-Check: PASSED

- SUMMARY e todos os arquivos-chave criados existem no working tree.
- Commits TDD `53b7e3c` e `2286614` existem no histórico na ordem RED→GREEN; o fix de harness `9b0f14d` e seu contrato estrutural `5b04a6a` também estão presentes.
- Nenhuma deleção rastreada, segredo, stub, processo, listener ou diretório temporário do gate permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
