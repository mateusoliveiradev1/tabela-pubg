---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 19
subsystem: web-bff
tags: [nextjs, route-handler, csrf, cookies, same-origin, security]

requires:
  - phase: 02-16
    provides: CSRF pre-auth/autenticado com rotação server-side e endpoint /security/csrf
  - phase: 02-17
    provides: PostgreSQL Neon e Redis reais aprovados para o preflight da fase
provides:
  - BFF Node same-origin com allowlist fechada para identidade, organizações, convites e auditoria
  - Encaminhamento filtrado de Cookie, Set-Cookie e x-csrf-token sem autoridade RBAC no Next
  - Aquisição, reaquisição após rotação e limpeza explícita do estado CSRF do cliente
affects: [02-12, 02-13, 02-14, 02-18, 02-23, identity-ui, organization-ui]

tech-stack:
  added: []
  patterns:
    - Route Handler Node dinâmico com API_INTERNAL_ORIGIN exclusivamente server-side
    - Allowlist path/method e headers de request/response por inclusão explícita
    - CSRF entregue por response header e renovado com cookie jar efêmero após autenticação

key-files:
  created:
    - apps/web/src/app/api/platform/[...path]/route.ts
    - apps/web/src/app/api/platform/[...path]/route.spec.ts
  modified:
    - apps/web/next.config.ts
    - apps/web/vitest.config.ts

key-decisions:
  - "O BFF aceita apenas API_INTERNAL_ORIGIN http(s) sem credenciais, path, query ou fragment e nunca expõe esse valor ao cliente."
  - "O token CSRF público retorna em x-csrf-token; autenticação readquire com os novos Set-Cookie e logout sinaliza cleared sem persistência no Next."
  - "O Next encaminha decisões e corpos 401/403/404 sem interpretar capabilities, roles ou existência de recursos."

patterns-established:
  - "Proxy fechado: uma combinação path/method só alcança o Nest quando aparece na tabela ROUTES."
  - "Cookie rotation: Set-Cookie do login alimenta somente a aquisição interna de /security/csrf e todos os cookies seguros retornam ao browser."
  - "Resposta privada: todo tráfego da plataforma recebe no-store/nosniff; autenticação e convite também recebem no-referrer."

requirements-completed: [AUTH-003, AUTH-005, AUTH-006, NFR-005]

duration: 15 min
completed: 2026-08-21
---

# Phase 02 Plan 19: BFF same-origin seguro Summary

**Proxy Next.js fechado por path/method com cookies first-party preservados, CSRF rotacionado e Nest mantido como única autoridade de autorização**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-21T08:05:00Z
- **Completed:** 2026-08-21T08:19:54Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Implementou uma allowlist exata para rotas de identidade, sessões, organizações, membros, convites, auditoria e logo, incluindo rejeição de URL absoluta, traversal e método indevido antes de qualquer `fetch`.
- Preservou `Cookie`/`Set-Cookie`, encaminhou `x-csrf-token`, adquiriu CSRF pre-auth, readquiriu após rotação com cookies recém-emitidos e sinalizou limpeza no logout.
- Filtrou headers hop-by-hop, Authorization e headers de provider; limitou contagem/tamanho de headers e body; aplicou `no-store`, `nosniff` e `no-referrer` sem interpretar RBAC.
- Validou o fluxo com PostgreSQL Neon e Redis reais no preflight, sem persistir ou imprimir a connection string.

## Task Commits

1. **RED: especificar o BFF same-origin e o ciclo CSRF** - `41cb129` (test)
2. **GREEN: implementar proxy seguro e transparente** - `827ce0d` (feat)

## Files Created/Modified

- `apps/web/src/app/api/platform/[...path]/route.ts` - Proxy Node fechado, filtros, limites, cookies e ciclo CSRF.
- `apps/web/src/app/api/platform/[...path]/route.spec.ts` - 11 casos de allowlist, status transparentes, headers, cookies, CSRF, cache e erros.
- `apps/web/next.config.ts` - Headers no-store/noindex da plataforma e no-referrer de convites.
- `apps/web/vitest.config.ts` - Execução Node de specs TypeScript de Route Handlers.

## Decisions Made

- `API_INTERNAL_ORIGIN` é lida somente durante a request no runtime Node e falha fechada com resposta uniforme quando ausente ou inválida; nenhuma variável `NEXT_PUBLIC_*` foi criada.
- O BFF não armazena sessão, CSRF ou capability. O token CSRF é devolvido em header same-origin, enquanto o segredo e a sessão permanecem em cookies HttpOnly do backend.
- Respostas autoritativas, inclusive 401/403/404 e capabilities, atravessam sem tradução; erros locais usam corpo uniforme e nunca incluem config, URL ou stack.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Habilitou specs TypeScript Node no Vitest do web**
- **Found during:** Task 1, RED
- **Issue:** o projeto Node incluía somente `*.test.ts` e o transform OXC aceitava somente TSX; o artifact obrigatório `route.spec.ts` não era coletado/parseado.
- **Fix:** adicionou `src/**/*.spec.ts` ao projeto Node e ampliou o transform para arquivos TS/TSX.
- **Files modified:** `apps/web/vitest.config.ts`
- **Verification:** RED executou 11 falhas comportamentais contra o harness 501; GREEN concluiu 21/21 testes do web.
- **Committed in:** `41cb129`

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** somente a infraestrutura mínima necessária para executar o artifact de teste exigido; nenhuma ampliação funcional.

## Issues Encountered

- O primeiro comando seguro de preflight usou os aliases `TEST_DATABASE_URL`/`TEST_REDIS_URL`, mas o runner exige `DATABASE_URL`/`REDIS_URL`; a execução foi repetida com os nomes lidos do próprio script e passou. A credencial Neon permaneceu somente em memória em ambas as tentativas.
- O PowerShell bloqueia `pnpm.ps1`; o preflight chamou `pnpm.cmd` diretamente sem alterar a política do sistema.

## Known Stubs

None. Não há TODO, FIXME, placeholder, mock ou armazenamento vazio no caminho de produção do BFF.

## User Setup Required

None. O preflight reutilizou a branch Neon isolada e o Redis loopback já configurados, sem gravar connection strings.

## Verification

- `rtk pnpm phase2:integration:preflight` - passou contra PostgreSQL Neon e Redis reais.
- `rtk pnpm --filter @pubg-camp/web test -- api/platform` - 21 testes passaram em 3 arquivos.
- `rtk pnpm --filter @pubg-camp/web lint` - passou.
- `rtk pnpm --filter @pubg-camp/web typecheck` - passou.
- `rtk pnpm --filter @pubg-camp/web build` - passou; `/api/platform/[...path]` reconhecida como rota dinâmica.
- `rtk pnpm verify:secrets` - passou em 253 arquivos.
- `rtk gsd-sdk query verify.key-links .../02-19-PLAN.md` - 1/1 link verificado, incluindo `/security/csrf`.
- `rtk git diff --check` - passou.

## Next Phase Readiness

- As UIs de login, OTP, sessões, organizações, convites e auditoria podem usar `/api/platform/*` sem conhecer o host interno do Nest.
- O cliente deve manter `x-csrf-token` somente em memória, substituir pelo header de cada aquisição/rotação e descartar quando `x-csrf-token-state: cleared` chegar.
- Nenhum bloqueador restante deste plano; a validação CI remota final continua reservada ao plano 02-24.

## Self-Check: PASSED

- Os quatro arquivos principais e este SUMMARY existem no disco.
- Os commits RED `41cb129` e GREEN `827ce0d` existem no histórico e aparecem nessa ordem.
- O link para `/security/csrf` foi verificado, o preflight real passou e a varredura de segredos não encontrou ocorrências.
- Nenhum arquivo rastreado foi apagado e não há stub conhecido impedindo o objetivo do plano.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
