---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 16
subsystem: api-security-authorization
tags: [nestjs, fastify, csrf, cookies, rbac, postgres, default-deny]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 07
    provides: adapters OAuth/Redis e packages Fastify aprovados
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 06
    provides: services de identidade, sessão e alert context read-only
provides:
  - lifecycle CSRF pre-auth e session-bound com rotação e invalidação
  - guards globais de sessão, CSRF e permissão default-deny
  - autorização tenant-aware baseada em snapshot PostgreSQL ao vivo
  - endpoint autenticado read-only para resolver alert context
  - erros HTTP uniformes com support code e redaction
affects: [02-09, 02-11, 02-12, 02-19, identity-http, organization-api, bff]
tech-stack:
  added: ["@fastify/cookie@11.1.2", "@fastify/csrf-protection@8.0.1"]
  patterns: [public-explicit-only, app-guard-chain, csrf-context-binding, live-authorization-snapshot]
key-files:
  created:
    - apps/api/src/security/csrf.service.ts
    - apps/api/src/security/csrf.controller.ts
    - apps/api/src/security/http-exception.filter.ts
    - apps/api/src/authorization/authorization.module.ts
    - apps/api/src/authorization/session.guard.ts
    - apps/api/src/authorization/permission.guard.ts
    - apps/api/test/security.integration.spec.ts
  modified:
    - apps/api/src/identity/identity.controller.ts
    - apps/api/src/identity/identity.module.ts
    - apps/api/src/main.ts
    - apps/api/src/app.module.ts
key-decisions:
  - "CSRF usa segredo HttpOnly do plugin e HMAC ligado ao digest do preauthId ou sessionId; Origin/Referer same-origin é obrigatório em método unsafe."
  - "SessionGuard, CsrfGuard e PermissionGuard são APP_GUARD nesta ordem; somente @Public pula sessão e nenhuma rota protegida sem metadata é permitida."
  - "Permissões nunca entram no cookie: cada request carrega o snapshot PostgreSQL atual por organização e scope explícitos."
  - "O alerta de sessão possui permission metadata self-only e recebe actorId exclusivamente do SessionGuard."
patterns-established:
  - "Toda rota de produto declara @RequirePermission; omissão resulta em 403."
  - "401/403/404/5xx retornam apenas statusCode, code e supportCode, sem mensagem interna ou stack."
requirements-completed: [AUTH-003, AUTH-005, AUTH-006, NFR-005]
duration: 17min
completed: 2026-08-21
---

# Phase 2 Plan 16: CSRF e autorização global Summary

**Fastify CSRF ligado a pre-auth/sessão, guards Nest default-deny e snapshot RBAC PostgreSQL atualizado em toda request**

## Performance

- **Duration:** 17 min
- **Started:** 2026-08-21T06:41:39Z
- **Completed:** 2026-08-21T06:58:16Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments

- Implementou aquisição explícita de CSRF sem criar sessão, cookie pre-auth opaco HttpOnly e binding HMAC que muda em login, rotação e logout.
- Rejeitou token ausente, stale, cross-session, Origin externo, `Origin:null` e ausência de Origin/Referer antes do use case por meio de Fastify inject.
- Registrou SessionGuard, CsrfGuard e PermissionGuard globalmente; `@Public` é a única exceção e metadata de permissão ausente nega.
- Ligou autenticação opaca e autorização ao PostgreSQL real: sessão é resolvida por digest e o snapshot de membership/assignments é recarregado em cada request.
- Expôs resolução de alerta active/revoked/expired/not-found user-bound, com input estrito e testes que provam zero mutações.
- Padronizou falhas 401/403/404/infraestrutura com support code, sem stack, mensagem interna, role ou segredo.

## Task Commits

1. **Task 1: Implementar lifecycle CSRF pre-auth e autenticado**
   - `447bc6e` — RED: lifecycle CSRF e alert context read-only.
   - `a15df1f` — GREEN: plugins Fastify, rotação/invalidação e controller autenticado.
2. **Task 2: Registrar autorização global default-deny e erros uniformes**
   - `bdd118c` — RED: bypass público, metadata obrigatória, scope, revogação e erros.
   - `d79a2ea` — GREEN: APP_GUARD, snapshot live, bootstrap seguro e filter redigido.

## Files Created/Modified

- `apps/api/src/security/csrf.service.ts` — binding, aquisição, rotação, invalidação, Origin e CsrfGuard.
- `apps/api/src/security/csrf.controller.ts` — GET público/no-store para adquirir CSRF pre-auth ou autenticado.
- `apps/api/src/security/http-exception.filter.ts` — envelope uniforme e support code sem informação interna.
- `apps/api/src/authorization/decorators.ts` — `@Public` e `@RequirePermission` com chaves canônicas.
- `apps/api/src/authorization/session.guard.ts` — resolve cookie opaco configurável e injeta actor/session server-side.
- `apps/api/src/authorization/permission.guard.ts` — exige metadata, organização/scope e decisão live.
- `apps/api/src/authorization/authorization.service.ts` — carrega snapshot atual e delega à policy pura `can`.
- `apps/api/src/authorization/authorization.module.ts` — cadeia global de guards via `APP_GUARD`.
- `apps/api/src/identity/identity.controller.ts` — rotação CSRF em auth/link/step-up e GET de alert context.
- `apps/api/src/main.ts` — configuração fail-closed, CORS exato, body limit, proxy allowlist e adapters PostgreSQL reais.
- `apps/api/test/security.integration.spec.ts` — Fastify inject negativo para CSRF, BOLA, revogação e secret boundary.

## Decisions Made

- A proteção CSRF usa o plugin oficial com cookie de segredo assinado e `userInfo` HMAC ligado ao contexto; o identificador pre-auth separado continua opaco e HttpOnly.
- Métodos unsafe exigem Origin exata ou Referer com a mesma origem; ausência, `null` e origem externa falham antes de controller/service.
- A permissão especial do alert context é self-only: ela ainda exige `@RequirePermission`, mas não exige organização porque o repository aplica actorId diretamente.
- Ausência de membership vira snapshot revogado uniforme, impedindo que a autorização revele se organização, membro ou scope existem.
- `TRUSTED_PROXY` é convertido em allowlist explícita (`none`, loopback ou redes privadas) e nunca usa `trustProxy: true` irrestrito.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Mantido o health endpoint acessível após default-deny global**
- **Found during:** Task 2
- **Issue:** registrar SessionGuard global tornaria liveness/readiness autenticados e quebraria probes operacionais.
- **Fix:** marcou o HealthController explicitamente com `@Public`, preservando a regra de exceção única.
- **Files modified:** `apps/api/src/health/health.controller.ts`
- **Verification:** lint/typecheck/build e suites API passaram com os guards registrados.
- **Committed in:** `d79a2ea`

**2. [Rule 2 - Missing Critical] Ligados guards a adapters PostgreSQL reais no bootstrap**
- **Found during:** Task 2
- **Issue:** defaults fail-closed garantiriam segurança, mas deixariam toda rota protegida indisponível e o snapshot não seria atualizado na execução real.
- **Fix:** bootstrap cria a conexão, resolve sessão por token digest e carrega membership/assignments em cada request sem cache.
- **Files modified:** `apps/api/src/main.ts`
- **Verification:** typecheck/build, testes de revoke-next-request e preflight Neon/Redis real passaram.
- **Committed in:** `d79a2ea`

**3. [Rule 3 - Blocking] Corrigido pattern inválido no key-link da policy**
- **Found during:** verificação consolidada
- **Issue:** o regex serializado `can\\(` era recusado pelo verificador antes de inspecionar o arquivo.
- **Fix:** usou a forma equivalente e portátil `can[(]`, mantendo o mesmo vínculo semântico.
- **Files modified:** `.planning/phases/02-identidade-organizacoes-e-autorizacao/02-16-PLAN.md`
- **Verification:** `verify.key-links` retornou 4/4 e `all_verified: true`.
- **Committed in:** plan metadata commit.

---

**Total deviations:** 3 auto-fixed (2 missing critical, 1 blocking). **Impact:** segurança e operação real completas, sem ampliar o escopo funcional.

## Issues Encountered

- Context7 CLI não está instalado; assinaturas exatas e compatibilidade Fastify 5 foram conferidas nos README e tipos distribuídos pelos dois packages Approved instalados.
- PowerShell desta máquina remove expansão `$env` em shells aninhados; o preflight usou `Set-Item Env:` e manteve a URI Neon somente em memória e redigida da saída.

## Known Stubs

None. Sessão e autorização do bootstrap usam repositories PostgreSQL reais; os valores vazios restantes aparecem somente em estados deny legítimos ou fakes de teste.

## User Setup Required

None. A verificação usou a branch Neon isolada e Redis loopback já preparados, sem persistir connection strings.

## Next Phase Readiness

- APIs de organizações/auditoria podem declarar permissions explícitas e receber actor/tenant context dos guards.
- O BFF pode adquirir `/security/csrf`, substituir o token retornado após rotação e limpar seu estado no logout.
- Não há bloqueador restante deste plano; a aprovação de CI final continua reservada ao plano 02-24.

## Self-Check: PASSED

- Todos os sete artifacts principais existem; os commits `447bc6e`, `a15df1f`, `bdd118c` e `d79a2ea` existem no histórico.
- `verify.key-links` confirmou 4/4 vínculos e `all_verified: true`.
- Preflight PostgreSQL Neon/Redis real passou sem imprimir ou gravar a connection string.
- Fastify inject/API concluiu 85 testes passados e 6 skips de integração externa; CSRF e autorização não possuem falha/skip.
- Turbo lint/typecheck/build da API, secret scan e `git diff --check` passaram.
- Varredura não encontrou TODO/FIXME/placeholder nem fonte de dados mockada em produção.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
