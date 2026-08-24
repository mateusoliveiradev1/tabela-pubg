---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 30
subsystem: identity
tags: [postgresql, otp, identity-proof, session-binding, atomic-promotion, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    provides: Trust persistido, challenges actor/session-bound e sessões opacas dos planos 02-25/02-27
provides:
  - OTP purpose-specific com binding durável de actor e sessão
  - Resolução/criação de identidade email sem merge por coincidência Discord
  - Proofs email one-use para link/change e step-up persistido
  - Promoção provisional para trusted com troca de token e revogação das demais sessões em uma transação
affects: [02-31, 02-36, 02-42]

tech-stack:
  added: []
  patterns:
    - Completion OTP purpose-specific sob uma única transaction PostgreSQL
    - Identidade email indexada por SHA-256 do subject sem merge por normalized-email
    - Failure injection por fronteira durável para provar rollback integral

key-files:
  created:
    - packages/database/migrations/0004_cute_justice.sql
    - packages/database/migrations/meta/0004_snapshot.json
  modified:
    - packages/database/src/repositories/identity.ts
    - packages/database/src/repositories/sessions.ts
    - packages/database/src/schema/identity.ts
    - packages/database/test/identity-organizations.integration.spec.ts
    - apps/api/src/identity/otp.service.ts
    - apps/api/src/identity/otp.service.spec.ts
    - apps/api/src/identity/identity.runtime.ts

key-decisions:
  - "Sign-in resolve exclusivamente provider=email/providerSubject digest; normalized-email já pertencente a Discord produz conflito estável sem merge."
  - "Link/change consomem o challenge correto e produzem identity_link_proof ainda não consumida, vinculada ao mesmo actor/session para o comando atômico 02-42."
  - "Promoção provisional retorna o token cru somente depois do commit que liga email, eleva trust, persiste reauth, substitui digest e revoga todas as outras sessões."

patterns-established:
  - "Bound OTP: sign-in exige binding nulo; toda finalidade protegida exige actorId e sessionId exatos em create/find/failure/consume."
  - "Atomic promotion: challenge, identity, trust, token e revoke-others compartilham o mesmo executor transacional."

requirements-completed: [AUTH-002, AUTH-003, ORG-002, NFR-005]

duration: 21min
completed: 2026-08-24
---

# Phase 2 Plan 30: Bound OTP Identity Proofs Summary

**OTP persistente por finalidade com identidade email sem merge implícito e promoção provisional→trusted totalmente atômica no PostgreSQL.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-24T10:36:37Z
- **Completed:** 2026-08-24T10:57:16Z
- **Tasks:** 1 TDD
- **Files modified:** 10

## Accomplishments

- Vinculou challenges protegidos a actor/session desde a criação até o consume condicional, preservando sign-in sem binding e sem mutação em mismatch.
- Resolveu ou criou conta email por `provider=email` + subject digest, com concorrência first-sign-in convergindo para um único user/identity e conflito de e-mail Discord sem auto-merge.
- Transformou link/change em proofs email duráveis, one-use e bound; step-up agora persiste e retorna o instante confirmado.
- Implementou a transação de promoção Discord provisional que consome OTP, liga email, eleva trust, registra reauth, troca token e revoga todas as outras sessões.
- Provou rollback completo após cada fronteira de mutação e nos conflitos de actor/session, already-trusted, identidade e token digest.

## Task Commits

A tarefa TDD produziu commits RED e GREEN separados:

1. **Task 1: Vincular challenges e resolver identidade email sem merge** — `844ea77` (RED), `1ba5b5c` (GREEN)

## Files Created/Modified

- `packages/database/migrations/0004_cute_justice.sql` — adiciona purpose provisional e separa unicidade ativa pública da bound.
- `packages/database/migrations/meta/0004_snapshot.json` — snapshot Drizzle equivalente à migration 0004.
- `packages/database/migrations/meta/_journal.json` — registra a migration 0004.
- `packages/database/src/schema/identity.ts` — enum e índices purpose/binding de challenges.
- `packages/database/src/repositories/identity.ts` — consume bound, email account resolution, proofs e completion transacional.
- `packages/database/src/repositories/sessions.ts` — lock ativo, promoção de trust e substituição condicional de token.
- `packages/database/test/identity-organizations.integration.spec.ts` — concorrência, replay, conflitos e rollback por fronteira no PostgreSQL real.
- `apps/api/src/identity/otp.service.ts` — contratos purpose-specific e resultados privados persistidos.
- `apps/api/src/identity/otp.service.spec.ts` — unidade RED→GREEN para binding e completion por finalidade.
- `apps/api/src/identity/identity.runtime.ts` — adapter real do port OTP para a transação do database.

## Decisions Made

- Challenges bound usam dois índices parciais: sign-in único por email/purpose e protected único por email/purpose/actor/session. Assim dois atores não supersedem a prova um do outro.
- O subject da identidade email e dos proofs é SHA-256 do e-mail normalizado; o valor normalizado permanece somente na tabela autoritativa de e-mails verificados.
- Erros de unicidade são classificados atravessando o `cause` do wrapper Drizzle, permitindo rollback/rejeição estável sem expor detalhe PostgreSQL.
- A session provisional promovida recebe horizonte trusted, `reauthenticated_at` fresco e novo digest; o token cru não entra em logs, outbox ou persistência.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Persistência do novo purpose e isolamento de challenges bound**
- **Found during:** Task 1 (modelagem do consume purpose-specific)
- **Issue:** o enum PostgreSQL não continha `verify-provisional-email` e o índice ativo global permitia que outro actor supersedesse um challenge protegido do mesmo e-mail.
- **Fix:** migration 0004 adicionou o enum e dividiu a unicidade em índices parciais sign-in e actor/session-bound; schema e snapshot foram atualizados.
- **Files modified:** `packages/database/src/schema/identity.ts`, `packages/database/migrations/0004_cute_justice.sql`, metadata Drizzle.
- **Verification:** migration journal/check e fresh apply no preflight PostgreSQL real.
- **Committed in:** `1ba5b5c`

**2. [Rule 2 - Missing Critical] Adapter runtime para o completion transacional**
- **Found during:** Task 1 (integração do novo port OTP)
- **Issue:** o adapter existente projetava apenas status/boolean e perderia actor/session e resultados duráveis.
- **Fix:** `identity.runtime.ts` passou a encaminhar binding completo, clock injetado e `completeOtpChallenge`.
- **Files modified:** `apps/api/src/identity/identity.runtime.ts`.
- **Verification:** build API e specs runtime/controller 14/14.
- **Committed in:** `1ba5b5c`

**3. [Rule 1 - Bug] Matcher inexistente no teste concorrente**
- **Found during:** primeiro gate PostgreSQL GREEN
- **Issue:** Vitest/Chai não oferece `toHaveSize` para `Set`.
- **Fix:** a asserção passou a comparar `Set.size` com `toBe(1)`.
- **Files modified:** `packages/database/test/identity-organizations.integration.spec.ts`.
- **Verification:** concorrência first-sign-in e suite 33/33 verdes.
- **Committed in:** `1ba5b5c`

**4. [Rule 1 - Bug] Unique violation encapsulada pelo Drizzle**
- **Found during:** negativo real de colisão do replacement token
- **Issue:** o código PostgreSQL `23505` estava em `error.cause`, e não no wrapper superior.
- **Fix:** classificação percorre uma cadeia limitada de causes e devolve rejeição estável após rollback.
- **Files modified:** `packages/database/src/repositories/identity.ts`.
- **Verification:** token-collision rejeitado; challenge, identity, trust, token e sessões permanecem anteriores.
- **Committed in:** `1ba5b5c`

**5. [Rule 3 - Blocking] Provisionamento local dos serviços reais**
- **Found during:** gate de integração
- **Issue:** não havia `DATABASE_URL` nem PostgreSQL local disponível.
- **Fix:** archive oficial PostgreSQL 16.15 foi baixado por HTTPS em diretório temporário, validado por tamanho/SHA-256 e executado loopback-only com Redis 8.10 temporário.
- **Files modified:** nenhum arquivo do repositório.
- **Verification:** preflight real e suite 33/33; ports encerrados e diretório run-scoped removido.
- **Committed in:** n/a (infraestrutura efêmera)

---

**Total deviations:** 5 auto-fixed (2 missing critical, 2 bugs, 1 blocking issue).
**Impact on plan:** ajustes estritamente necessários para persistência, isolamento e prova real dos contratos 02-30; nenhum redesign de controller/UI foi antecipado.

## Issues Encountered

- O Redis Windows não encerrou o processo no primeiro `shutdown nosave`; o listener exato da porta run-scoped foi identificado como o processo iniciado pelo gate e encerrado antes do cleanup.
- Arquivos read-only do archive PostgreSQL exigiram remoção de atributos antes do delete; o diretório temporário foi removido e ambos os ports terminaram com zero listeners.
- O aviso existente do Vite sobre `configLoader: native` permaneceu informativo e não afetou os testes.

## Known Stubs

None — o scan dos arquivos de produção modificados não encontrou TODO, FIXME, placeholders nem data sources vazios.

## Verification

- `rtk pnpm --filter @pubg-camp/api exec vitest run src/identity/otp.service.spec.ts` — PASS; 8/8.
- Specs OTP/runtime/controller — PASS; 3 arquivos e 14/14 testes.
- `rtk pnpm phase2:integration` — PASS contra PostgreSQL 16.15 e Redis 8.10 reais; 4 arquivos e 33/33 testes.
- `rtk pnpm verify:migrations` — PASS; 5 migrations e `drizzle-kit check` verde.
- `rtk pnpm --filter @pubg-camp/database build` — PASS; ESM e declarações geradas.
- `rtk pnpm --filter @pubg-camp/api build` — PASS; TypeScript sem erros.
- Biome nos seis arquivos TypeScript de produção/teste alterados — PASS.
- Cleanup — PASS; zero listeners nas portas temporárias e nenhum diretório run-scoped restante.

## TDD Gate Compliance

- RED `844ea77` registrou 6 falhas por ausência de binding/completion purpose-specific.
- GREEN `1ba5b5c` veio depois do RED e passou unidade, PostgreSQL real, migrations e builds.

## Authentication Gates

None.

## User Setup Required

None — nenhuma credencial, URL de serviço ou configuração externa foi persistida.

## Next Phase Readiness

- O 02-31 pode reutilizar binding/proofs duráveis para OAuth.
- O 02-36 pode emitir sessão/cookie a partir do resultado privado sign-in e publicar o replacement token provisional somente depois do commit.
- O 02-42 pode consumir `identity_link_proofs` email no comando único D-08 para link/change ordinários.

## Self-Check: PASSED

- Migration 0004, snapshot e todos os arquivos-chave existem no working tree.
- Commits TDD `844ea77` e `1ba5b5c` existem no histórico na ordem RED→GREEN.
- Nenhuma deleção rastreada, segredo, stub, arquivo temporário ou processo de gate permaneceu.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
