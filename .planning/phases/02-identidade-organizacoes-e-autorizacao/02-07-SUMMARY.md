---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 07
subsystem: api-auth-adapters
tags: [oauth4webapi, discord, pkce, redis, rate-limiter-flexible, nestjs]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 06
    provides: services OAuth, OTP e sessão desacoplados por ports
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 17
    provides: PostgreSQL Neon e Redis reais aprovados no preflight inicial
provides:
  - adapter Discord Authorization Code com state, PKCE S256 e revogação obrigatória
  - verifier PKCE one-use persistido no Redis por chave derivada do digest do state
  - rate limiting OTP distribuído, multidimensional e fail-closed
  - endpoints Nest finos com contratos públicos estritos e respostas redigidas
affects: [session-guards, csrf-bootstrap, identity-http, production-wiring]
tech-stack:
  added: [oauth4webapi@3.8.7, rate-limiter-flexible@11.2.0]
  patterns: [captured-provider-http, redis-one-use-secret, dynamic-nest-module, stable-public-errors]
key-files:
  created:
    - apps/api/src/identity/adapters/discord-oauth.ts
    - apps/api/src/identity/adapters/redis-auth-rate-limiter.ts
    - apps/api/src/identity/identity.controller.ts
    - apps/api/src/identity/identity.module.ts
  modified:
    - apps/api/src/identity/oauth.service.ts
    - apps/api/src/identity/ports/discord-identity-provider.ts
    - packages/contracts/src/identity.ts
    - biome.json
key-decisions:
  - "O verifier PKCE é consumido por state em Redis e o state aparece apenas como digest na chave, permitindo múltiplas instâncias sem persistir o valor bruto."
  - "O modo documented-exception exige evidence ID no boot, mantém state/browser binding e pode voltar a required sem alteração de schema."
  - "O controller nunca devolve authorization URL, challengeId, sessionId ou token no JSON; Location é emitido somente no redirect de início."
patterns-established:
  - "HTTP externo é injetável via customFetch de oauth4webapi e testado por captura sem rede real."
  - "Falha operacional Redis lança erro estável para OtpService aplicar resposta uniforme fail-closed."
requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-006, NFR-005]
duration: 15min
completed: 2026-08-21
---

# Phase 2 Plan 07: Adapters Discord/Redis e borda HTTP de identidade Summary

**OAuth Discord server-side com PKCE S256 one-use, limites OTP distribuídos em Redis e endpoints Nest sem vazamento de tokens ou identificadores internos**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-21T05:58:00.000Z
- **Completed:** 2026-08-21T06:13:37.049Z
- **Tasks:** 1
- **Files modified:** 14

## Accomplishments

- Implementou Authorization Code Discord com redirect exato, scopes `identify email`, state, PKCE S256 e revogação do access token depois de `/users/@me`.
- Implementou exceção PKCE somente com evidência explícita e repair path direto para `required`, mantendo state/browser binding e warning redigido.
- Implementou store Redis one-use do verifier, com TTL e state transformado em SHA-256 na chave.
- Implementou rate limits OTP por email, IP, combinação e cooldown, compartilhados entre instâncias e sem insurance limiter em memória.
- Implementou controller/module Nest com validação Zod, redirect via `Location` e bodies públicos que omitem state, challenge, sessão e provider token.
- Comprovou migrations do zero e disponibilidade contra a branch Neon isolada e o Redis loopback real, sem persistir as URLs.

## Task Commits

1. **Task 1: Implementar adapters OAuth/Redis e endpoints de identidade**
   - `e37a50e` — RED: specs PKCE, provider HTTP capturado, Redis distribuído e controller redigido.
   - `1e03bce` — GREEN: adapters Discord/Redis, controller/module, dependências auditadas e correções contratuais.

## Files Created/Modified

- `apps/api/src/identity/adapters/discord-oauth.ts` — protocolo OAuth por `oauth4webapi`, S256, perfil validado e revogação.
- `apps/api/src/identity/adapters/redis-auth-rate-limiter.ts` — limiter distribuído e store one-use de verifier PKCE.
- `apps/api/src/identity/identity.controller.ts` — endpoints OAuth/OTP finos e respostas públicas estritas.
- `apps/api/src/identity/identity.module.ts` — dynamic module com services injetados por tokens explícitos.
- `apps/api/src/identity/ports/discord-identity-provider.ts` — exchange agora recebe state para consumir o verifier correto.
- `apps/api/src/identity/oauth.service.ts` — propaga state validado ao provider.
- `packages/contracts/src/identity.ts` — verificação OTP inclui o e-mail necessário ao binding HMAC já implementado.
- `biome.json` — parser habilitado para parameter decorators usados pelos controllers Nest.
- `apps/api/package.json` e `pnpm-lock.yaml` — somente os dois pacotes Approved, em versões exatas.

## Decisions Made

- O adapter não mantém verifier em memória de processo: Redis permite callback em outra instância e consumo atômico por `GETDEL`.
- A chave Redis recebe apenas SHA-256 do state; verifier e metadata têm TTL de dez minutos e nunca entram em resposta/log.
- `oauth4webapi` realiza token exchange/revocation form-urlencoded; o teste injeta `customFetch` e bloqueia qualquer rede não prevista.
- O module é dinâmico porque os repositories e cookies de produção são finalizados nos planos de bootstrap/guards; os endpoints já podem ser testados com services reais ou fakes sem criar providers incompletos.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Ligado o state ao exchange do provider**
- **Found during:** RED de PKCE.
- **Issue:** o port anterior recebia somente `code`, impossibilitando resolver e consumir o verifier correspondente com segurança.
- **Fix:** `DiscordIdentityProvider.exchange` recebe `state` e `OAuthService` propaga o state já validado/consumido.
- **Files modified:** `discord-identity-provider.ts`, `oauth.service.ts`.
- **Verification:** replay não faz segundo request HTTP e a key-link PKCE passou.
- **Committed in:** `1e03bce`.

**2. [Rule 1 - Bug] Completado o contrato de verificação OTP com email**
- **Found during:** ligação do controller ao `OtpService`.
- **Issue:** o service exige email para recomputar o digest/HMAC, mas o request contract não o transportava.
- **Fix:** campo `email` estrito adicionado ao schema e coberto por teste contratual.
- **Files modified:** `packages/contracts/src/identity.ts`, `identity.test.ts`.
- **Verification:** 15 testes de contrato e build de contracts passaram.
- **Committed in:** `1e03bce`.

**3. [Rule 3 - Blocking] Habilitado parser de parameter decorators Nest no Biome**
- **Found during:** lint pós-GREEN.
- **Issue:** Biome recusava os decorators de parâmetros necessários para Body/Query/Headers/IP/Res.
- **Fix:** ativado `javascript.parser.unsafeParameterDecoratorsEnabled`, preservando as regras recomendadas.
- **Files modified:** `biome.json`.
- **Verification:** lint API passou sem warnings de código.
- **Committed in:** `1e03bce`.

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 bug, 1 blocking). **Impact:** todos os ajustes são necessários para PKCE real, OTP verificável e controllers Nest compiláveis; nenhuma regra CSRF/guard do plano 02-16 foi antecipada.

## Issues Encountered

- Context7 CLI não está instalado; a API exata foi confirmada diretamente nos tipos/documentação distribuídos pelos pacotes Approved instalados.
- O package `@pubg-camp/contracts` precisou ser recompilado antes do build isolado da API para atualizar seu export `dist`; o Turbo executa essa dependência automaticamente no gate consolidado.

## Known Stubs

None. Os adapters, store, limiter e métodos do controller possuem fontes reais; o wiring de repositories/cookies permanece deliberadamente no bootstrap do plano 02-16, por contrato de fase.

## User Setup Required

O cadastro real do aplicativo Discord e seus três valores secretos ainda exige acesso humano ao portal. Ver [02-USER-SETUP.md](./02-USER-SETUP.md).

## Verification

- Preflight PostgreSQL Neon + Redis: passou com migrations do zero e serviços reais.
- API: 73 testes passaram com `TEST_REDIS_URL`, incluindo duas instâncias, cooldown, TTL, fail-closed e verifier one-use.
- Contracts: 15 testes passaram.
- Turbo API lint/typecheck/build: 10/10 tasks passaram.
- Dependency boundaries: 128 módulos e 253 dependências sem violações.
- Secret scan: 208 arquivos, nenhuma ocorrência.
- Key-link `discord-oauth.ts` → `oauth4webapi`: 1/1 verificada.

## Next Phase Readiness

- O plano 02-16 pode registrar cookies/CSRF/guards e importar `IdentityModule.register(...)` sem alterar o protocolo Discord ou limiter.
- Credenciais Discord reais não são necessárias para os próximos gates automatizados; o provider continua totalmente comprovado por HTTP capturado.

## Self-Check: PASSED

- Os quatro artifacts principais, três specs, USER-SETUP e este SUMMARY existem.
- Commits `e37a50e` e `1e03bce` existem no histórico e não removem arquivos.
- Preflight real, suites, lint, typecheck, build, boundaries, secret scan e key-link passaram.
- Nenhum stub bloqueia o objetivo e nenhum segredo foi gravado ou impresso.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
