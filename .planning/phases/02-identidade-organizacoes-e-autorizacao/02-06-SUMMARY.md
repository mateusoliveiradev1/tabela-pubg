---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 06
subsystem: api-identity-services
tags: [nestjs, oauth, discord, otp, hmac, rate-limiting, opaque-sessions, step-up]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 01
    provides: políticas puras de identidade e autorização
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 02
    provides: contratos HTTP estritos e configuração fail-closed
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 04
    provides: repositories transacionais de identidade, OTP e sessões
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 05
    provides: repositories tenant-aware e invariantes de organização
provides:
  - OAuth Discord one-use ligado ao browser e purpose, com revogação de token em finally
  - resolução de conta exclusivamente pelo subject estável do Discord e linking explícito dual
  - OTP HMAC não enumerável com limites por email, IP, combinação e cooldown
  - lifecycle multi-dispositivo, step-up de dez minutos e rotação de sessão sensível
  - resolução de alerta user-bound, digest-backed e estritamente read-only
affects: [identity-http-adapters, session-guards, discord-adapter, email-worker, organization-use-cases]
tech-stack:
  added: []
  patterns: [ports-and-adapters, injected-clock-rng, fail-closed-limiter, read-only-alert-context]
key-files:
  created:
    - apps/api/src/identity/ports/discord-identity-provider.ts
    - apps/api/src/identity/ports/auth-rate-limiter.ts
    - apps/api/src/identity/ports/token-generator.ts
    - apps/api/src/identity/identity.service.ts
    - apps/api/src/identity/oauth.service.ts
    - apps/api/src/identity/otp.service.ts
    - apps/api/src/identity/session.service.ts
  modified: []
key-decisions:
  - "Services recebem Clock, RNG, repositories e providers por injeção; nenhum service lê process.env, abre rede ou importa SDK externo."
  - "Discord login consulta somente provider subject; e-mail do perfil jamais procura ou une uma conta existente."
  - "OTP aplica HMAC-SHA-256 com pepper injetado e limita somente digests de email/IP, mantendo resposta pública uniforme."
  - "Alert context é resolvido por digest e actorId em um port read-only; wrong-user permanece indistinguível de not-found."
patterns-established:
  - "OAuth consume state/browser/purpose antes de qualquer exchange e revoga access token em finally."
  - "Mudança sensível exige step-up fresco, rotaciona a sessão corrente e só então revoga as demais."
  - "Sinais de device, IP, localização e user-agent servem apenas para apresentação/alerta, nunca como autoridade."
requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-006, NFR-005]
duration: 13min
completed: 2026-08-21
---

# Phase 2 Plan 06: Serviços modulares de identidade e sessões Summary

**OAuth Discord browser-bound, OTP HMAC não enumerável e sessões multi-dispositivo implementados como services Nest determinísticos sobre ports injetáveis**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-21T05:08:56.502Z
- **Completed:** 2026-08-21T05:22:10.326Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Implementou início/callback Discord com state one-use, browser binding, purpose, expiry, subject estável e revogação garantida do access token sem expô-lo no resultado.
- Implementou conta provisória de 15 minutos quando Discord não oferece e-mail utilizável, além de linking explícito com confirmação dos dois métodos, step-up e conflito genérico.
- Implementou OTP de oito dígitos, dez minutos, cinco tentativas, supersessão, replay protection, HMAC-SHA-256 e limiter multidimensional fail-closed com logs redigidos.
- Implementou listagem redigida de devices, revogação individual/demais/logout, alerta de novo device, step-up de dez minutos e rotação/revogação para mudanças sensíveis.
- Provou que resolução de alerta é user-bound, usa somente digest e chama zero métodos de mutação.

## Task Commits

1. **Task 1: Orquestrar Discord OAuth e vinculação explícita**
   - `d10e5ea` — RED: specifications de OAuth one-use, stable subject, sessão provisória e linking dual.
   - `054f6e0` — GREEN: services OAuth/Identity e ports Discord/TokenGenerator.
2. **Task 2: Implementar OTP não enumerável e rate limits multidimensionais**
   - `ed09515` — RED: abuse matrix de enumeração, limiter, expiry, tentativas, supersessão e replay.
   - `d5ccd18` — GREEN: OTP HMAC, limiter digest-only, entrega segura e security log redigido.
3. **Task 3: Implementar lifecycle multi-dispositivo e step-up**
   - `2632382` — RED: lifecycle, step-up, rotação e alert context read-only.
   - `fc8393f` — GREEN: SessionService multi-dispositivo e user-bound.
   - `1ae4414` — correção: discriminante literal do fake no build TypeScript.

## Files Created/Modified

- `apps/api/src/identity/ports/discord-identity-provider.ts` — contrato mínimo start/exchange/fetchUser/revoke sem tipos de SDK.
- `apps/api/src/identity/ports/auth-rate-limiter.ts` — limites request/verify por dimensões digest-backed.
- `apps/api/src/identity/ports/token-generator.ts` — IDs, tokens opacos, códigos numéricos e digests determinísticos em teste.
- `apps/api/src/identity/identity.service.ts` — subject lookup, conta provisória, linking dual e step-up Discord.
- `apps/api/src/identity/oauth.service.ts` — transação OAuth, consumo one-use e revogação do token externo.
- `apps/api/src/identity/otp.service.ts` — HMAC, resposta uniforme, limiter, delivery e consumo single-use.
- `apps/api/src/identity/session.service.ts` — devices, revogações, step-up, rotação e alerta read-only.
- `apps/api/src/identity/*.service.spec.ts` — 27 testes fonte determinísticos, sem rede ou infraestrutura.

## Decisions Made

- A camada de service trabalha somente com ports semânticos. Adapters futuros traduzirão esses ports para os repositories Drizzle e providers externos, mantendo testes sem I/O.
- E-mail utilizável do Discord permite sessão confiável, mas nunca vira lookup nem identidade e-mail implícita; ausência/invalidez gera sessão provisória de 15 minutos.
- Linking exige duas confirmações booleanas explícitas e sessão com step-up inferior a dez minutos antes de persistir o vínculo.
- O limiter retorna decisão interna, porém bloqueio e indisponibilidade preservam o mesmo body público e impedem challenge/delivery.
- A comparação de HMAC usa `timingSafeEqual`; o consumo final continua condicional no repository para impedir duas verificações vencedoras.
- O alerta de novo device resolve somente contexto; revogação continua uma operação autenticada separada.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preservado discriminante do fake de alert context no build**
- **Found during:** gate consolidado após Task 3.
- **Issue:** o retorno default do fake foi ampliado para `status: string`; Vitest/typecheck passavam, mas `tsc -p tsconfig.build.json` recusava a implementação do port discriminado.
- **Fix:** tipado o valor default com o retorno exato de `resolveAlertContextReadOnly`.
- **Files modified:** `apps/api/src/identity/session.service.spec.ts`.
- **Verification:** build API, typecheck, lint, suite identity e build raiz passaram.
- **Committed in:** `1ae4414`

---

**Total deviations:** 1 auto-fixed (1 bug). **Impact:** correção apenas de tipagem do fake; nenhuma mudança de arquitetura ou escopo.

## Issues Encountered

- O build API existente emite specs para `dist`, e um teste raiz posterior ao build executa specs fonte e emitidas. O comportamento está documentado em `deferred-items.md`; não foi corrigido por estar fora dos arquivos e objetivo deste plano.

## Known Stubs

None. Todos os métodos públicos dos services estão implementados e ligados a ports injetáveis; adapters externos pertencem aos planos seguintes.

## Threat Flags

None. Os services não criam endpoint, acesso a arquivo, rede ou schema; os boundaries provider→service e browser signals→session estão cobertos por T-02-12, T-02-13 e T-02-14.

## User Setup Required

None. Este plano usa apenas fakes determinísticos e não requer credenciais, PostgreSQL, Redis ou providers externos.

## Next Phase Readiness

- Adapters Discord, Redis limiter, repositories e HTTP podem implementar os ports sem alterar regras de negócio.
- Guards e casos de organização podem exigir step-up e rotação por meio de `SessionService`.
- A integração HTTP deve manter respostas contratuais estritas e cookies seguros já definidos no plano 02-02.

## Self-Check: PASSED

- Os quatro services principais, os três ports, quatro specs e este SUMMARY existem no worktree.
- Os sete commits RED/GREEN/correção do plano existem no histórico.
- Key-link `identity.service.ts` → repository persistente foi verificado pelo SDK (1/1).
- 27 testes fonte de identidade, secret scan, lint/boundaries, typecheck, suite raiz e build completo passaram.
- Nenhum stub, SDK externo, acesso de rede ou `process.env` existe em `apps/api/src/identity`.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
