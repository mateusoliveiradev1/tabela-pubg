---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 36
subsystem: identity
tags: [nestjs, otp, session, csrf, postgresql, redis, authorization, tdd]

requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    provides: OTP bound e promoção provisional atômica de 02-30, sessões de dispositivo de 02-27 e comando D-08 de 02-42
provides:
  - Endpoints OTP Nest explícitos para sign-in público e finalidades autenticadas protegidas
  - Sessão trusted de dispositivo persistida antes de cookie/CSRF e alerta de novo dispositivo
  - Step-up email persistido para a sessão bound antes da rotação CSRF
  - Link/change delegados ao único comando D-08 e promoção provisional publicada somente após commit
affects: [02-32, 02-37, identity-bff, organization-onboarding]

tech-stack:
  added: []
  patterns:
    - Guard selection por path/método, nunca por purpose fornecido no body
    - Cookie de sessão opaco e CSRF publicados somente depois da fronteira durável
    - Adapter de aplicação estreito para o comando transacional IdentitySecurityChangePort

key-files:
  created:
    - apps/api/src/organizations/provisional-promotion.integration.spec.ts
  modified:
    - apps/api/src/identity/identity.controller.ts
    - apps/api/src/identity/identity.service.ts
    - apps/api/src/identity/identity.runtime.ts
    - apps/api/src/identity/identity.module.ts
    - apps/api/src/app.module.spec.ts

key-decisions:
  - "Rotas OTP públicas e protegidas usam paths purpose-specific; actorId/sessionId são sempre derivados de request.auth nas rotas protegidas."
  - "Sign-in por e-mail usa o binding HttpOnly pré-auth como fingerprint server-owned, persiste a sessão/device/outbox e só então publica cookie e CSRF."
  - "Link/change recebem o proof ainda não consumido e delegam toda a mutação ao comando D-08; promoção provisional usa exclusivamente o completion atômico de OTP."

patterns-established:
  - "Credential publication order: durable commit -> opaque session cookie -> session-bound CSRF."
  - "Protected OTP binding: purpose fixo na rota + actor/session de request.auth + igualdade defensiva do resultado persistido."

requirements-completed: [AUTH-002, AUTH-003, AUTH-004, ORG-002, NFR-005]

duration: 40min
completed: 2026-08-24
---

# Phase 2 Plan 36: Durable OTP Identity Endpoints Summary

**Sign-in OTP cria sessão trusted resolvível com alerta de novo dispositivo, enquanto step-up, link/change e promoção provisional publicam credenciais somente após suas transações bound.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-08-24T12:27:27Z
- **Completed:** 2026-08-24T13:07:34Z
- **Tasks:** 1 TDD
- **Files modified:** 9

## Accomplishments

- Substituiu o endpoint OTP público genérico por paths explícitos de sign-in e paths protegidos para link-email, change-email, step-up e verify-provisional-email.
- Ligou o resultado de identidade email de 02-30 a `startDeviceSession`, persistindo token opaco, device e delivery/outbox de novo dispositivo antes de cookie e CSRF.
- Persistiu step-up email apenas para o actor/session bound e bloqueou saída cross-session antes da rotação CSRF.
- Encaminhou proofs link/change ainda não consumidos uma única vez ao comando atômico D-08, sem fallback de writers independentes.
- Publicou o replacement token da promoção provisional somente depois do commit que liga o e-mail exato, eleva trust, substitui o digest e revoga todas as outras sessões.
- Provou em PostgreSQL Neon e Redis reais que o token antigo é negado, o replacement trusted cria organização e aceita somente convite para o e-mail confirmado.

## Task Commits

1. **Task 1 RED: contratos OTP persistentes e promoção end-to-end** — `9fac565` (test)
2. **Task 1 GREEN: endpoints Nest, runtime e ordering durável** — `9a3cce0` (feat)

## Files Created/Modified

- `apps/api/src/identity/identity.controller.ts` — rotas OTP purpose-specific, autoridade request.auth e ordering de cookie/CSRF.
- `apps/api/src/identity/identity.service.ts` — use cases de sessão email e delegação estreita ao comando D-08.
- `apps/api/src/identity/identity.runtime.ts` — adapter real do comando 02-42 e exposição do IdentityService ao módulo.
- `apps/api/src/identity/identity.module.ts` — registra o IdentityService consumido pelo controller.
- `apps/api/src/identity/identity.controller.spec.ts` — matriz pública/protegida, mismatch, replay/failure e ordering.
- `apps/api/src/identity/identity.runtime.spec.ts` — prova a montagem server-owned do comando D-08.
- `apps/api/src/identity/identity.service.spec.ts` — sessão de dispositivo e ausência de fallback writers.
- `apps/api/src/organizations/provisional-promotion.integration.spec.ts` — fluxo real PostgreSQL/Redis de sign-in, promoção, organização e convite.
- `apps/api/src/app.module.spec.ts` — composição DI e presença das rotas Nest reais.

## Decisions Made

- O body das rotas purpose-specific não contém `purpose`; o path fixa a finalidade e impede selecionar um guard mais fraco.
- O fingerprint de device de sign-in vem do binding HttpOnly pré-auth calculado pelo CSRF service; user-agent serve apenas como metadata resumida.
- `@AllowProvisional()` aparece somente nos handlers de request/verify da promoção de e-mail provisional; organização e convite permanecem sem allowlist.
- O adapter de aplicação fornece database, clock e generators ao comando 02-42, mas devolve ao controller somente o token já committed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Registro do IdentityService na composição Nest**
- **Found during:** Task 1 GREEN, ao ligar o controller ao use case de sessão email e ao comando D-08.
- **Issue:** o plano listava controller/runtime/service, mas o controller real não poderia receber o novo use case sem registro no `IdentityModule`.
- **Fix:** adicionou `IDENTITY_SERVICE` a services/providers/exports e atualizou o fixture de composição do app.
- **Files modified:** `apps/api/src/identity/identity.module.ts`, `apps/api/src/app.module.spec.ts`.
- **Verification:** build API verde e spec de composição confirma os paths registrados.
- **Committed in:** `9a3cce0`.

**2. [Rule 3 - Blocking] Isolamento real no nível de branch Neon**
- **Found during:** execução do spec end-to-end em `apps/api`, que não possui dependências diretas de driver/migration para criar schemas próprios.
- **Issue:** adicionar imports transientes de `postgres`/`drizzle-orm` ao package API quebraria seus limites de dependência.
- **Fix:** o teste usou uma branch Neon copy-on-write dedicada, migrations públicas apenas nela e Redis loopback efêmero; a branch foi destruída após os gates.
- **Files modified:** `apps/api/src/organizations/provisional-promotion.integration.spec.ts`.
- **Verification:** 25/25 casos focais passaram com conexão Neon direta e Redis 8.10 real; branch e Redis foram removidos.
- **Committed in:** `9a3cce0`.

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** ambos foram necessários para publicar endpoints Nest reais e manter o teste de integração isolado sem ampliar dependências de produção.

## Issues Encountered

- O endpoint Neon pooled quebrou `search_path` connection-local em specs amplos preexistentes; a repetição com endpoint direto removeu essas falhas de isolamento.
- `phase2:integration` terminou com 43 casos verdes, mas um teste preexistente excedeu 15 s e o setup de runtime migration excedeu 30 s sob latência Neon. O gate focal 02-36 passou 25/25; os timeouts fora do escopo foram registrados em `deferred-items.md`.

## Known Stubs

None — nenhum TODO/FIXME, placeholder, mock data ou credential path sem wiring foi encontrado nos arquivos de produção modificados.

## User Setup Required

None — PostgreSQL/Redis temporários foram usados somente durante a execução e removidos no cleanup.

## Next Phase Readiness

- 02-37 pode compilar a allowlist BFF diretamente dos paths OTP purpose-specific publicados neste plano.
- 02-32 pode reutilizar o mesmo adapter D-08 para confirmação final de identidade, preservando a ordem commit → cookie → CSRF.
- O gate amplo ainda possui dois timeouts de harness preexistentes documentados; não bloqueiam o contrato focal validado de 02-36.

## Self-Check: PASSED

- Todos os 9 arquivos de implementação/teste listados existem.
- Os commits `9fac565` e `9a3cce0` existem no histórico Git.
- O gate focal real passou 25/25 casos e o cleanup da branch Neon/Redis foi concluído.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
