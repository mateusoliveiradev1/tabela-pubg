---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 28
subsystem: security
tags: [csp, signed-urls, object-storage, compensation, vitest]

# Dependency graph
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    provides: metadata de logo ativa, URLs assinadas, cleanup transacional e convite com fallback local
provides:
  - Parser canônico de origens exatas para CSP e validação de logos assinadas
  - CSP de produção sem wildcard com origens HTTPS normalizadas e fail-closed
  - Fronteira de compensação que nunca remove objeto após commit de metadata ativa
affects: [branding, invitations, organization-logo, phase-2.1-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [exact-origin allowlist, post-commit projection boundary, safe signed-url fallback]

key-files:
  created:
    - apps/web/src/lib/organization-logo-origins.ts
    - apps/web/src/lib/organization-logo-origins.spec.ts
  modified:
    - apps/web/next.config.ts
    - apps/web/src/app/security-headers.spec.ts
    - apps/web/src/components/identity/invitation-accept-form.tsx
    - apps/web/src/components/identity/auth.spec.tsx
    - apps/api/src/organizations/organizations.service.ts
    - apps/api/src/organizations/organization-logo.integration.spec.ts

key-decisions:
  - "CSP e convite consomem o mesmo parser: produção aceita somente origens HTTPS exatas e desenvolvimento adiciona HTTP apenas para loopback exato."
  - "Compensação termina quando o repository commit retorna; assinatura e schema de resposta são projeções pós-commit sem autoridade para apagar o objeto ativo."

patterns-established:
  - "Exact origin policy: normalizar com URL, rejeitar atomicamente credenciais/path/query/fragment/wildcard e serializar somente origin exata."
  - "Committed result boundary: materializar o resultado persistido antes de qualquer projeção externa ou validação de resposta."

requirements-completed: [ORG-001, NFR-005]

# Metrics
duration: 38 min
completed: 2026-08-24
---

# Phase 02 Plan 28: Signed Logo Origin and Compensation Boundaries Summary

**Logos assinadas agora usam a mesma allowlist exata na CSP e no convite, enquanto falhas de projeção pós-commit preservam o objeto ativo e retornam fallback seguro.**

## Performance

- **Duration:** 38 min
- **Started:** 2026-08-24T09:09:44Z
- **Completed:** 2026-08-24T09:48:03Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Criado parser puro e compartilhado que normaliza origens HTTPS/IPv6/portas, deduplica e rejeita atomicamente qualquer entrada insegura.
- `img-src` preserva `'self' data: blob:` e adiciona somente origins exatas configuradas, sem `https:`, wildcard, subdomínio amplo ou origem de provider.
- Convite aceita a segunda origin aprovada após normalização, mantém `referrerPolicy="no-referrer"` e cai para iniciais locais quando a origin não é aprovada.
- Create/replace de logo mantêm compensação somente antes do commit; assinatura ou projeção posterior nunca agenda nem executa exclusão da key ativa.

## Task Commits

Cada ciclo TDD foi comprometido atomicamente:

1. **Task 1 RED: contratos de origin/CSP/logo assinada** - `f65a4e5` (test)
2. **Task 1 GREEN: parser canônico e CSP exata** - `a86eb74` (feat)
3. **Task 2 RED: contrato de compensação pós-commit** - `3cf54d7` (test)
4. **Task 2 GREEN: fronteira explícita de commit/projeção** - `564e750` (fix)

## Files Created/Modified

- `apps/web/src/lib/organization-logo-origins.ts` - parser canônico e diretiva `img-src` exata.
- `apps/web/src/lib/organization-logo-origins.spec.ts` - matriz HTTPS, IPv6, portas, HTTP loopback e entradas rejeitadas.
- `apps/web/next.config.ts` - compõe a CSP com as origins aprovadas sem ampliar a diretiva.
- `apps/web/src/app/security-headers.spec.ts` - regressão de CSP production-safe e falha atômica da configuração.
- `apps/web/src/components/identity/invitation-accept-form.tsx` - reutiliza o parser canônico para URLs assinadas efêmeras.
- `apps/web/src/components/identity/auth.spec.tsx` - segunda origin, no-referrer e fallback local.
- `apps/api/src/organizations/organizations.service.ts` - separa upload/commit de assinatura/schema de resposta.
- `apps/api/src/organizations/organization-logo.integration.spec.ts` - prova preservação pós-commit e compensação pré-commit.

## Decisions Made

- Origens configuradas são normalizadas antes da comparação; `https://host:443` e `https://host` representam uma única origin.
- Configuração vazia continua válida e produz apenas fontes locais; qualquer entrada presente e inválida rejeita o conjunto inteiro.
- Falha de assinatura retorna o fallback same-origin configurado; falha posterior de schema permanece erro estável de leitura/projeção, sem cleanup do objeto comprometido.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test bug] Corrigida asserção de scheme-wide source**
- **Found during:** Task 1 GREEN.
- **Issue:** a primeira asserção procurava a substring `https:` e confundia origins HTTPS exatas com o token CSP amplo `https:`.
- **Fix:** a regressão passou a comparar tokens independentes da diretiva.
- **Files modified:** `apps/web/src/app/security-headers.spec.ts`.
- **Verification:** 85 testes web e build Next de produção verdes.
- **Committed in:** `a86eb74`.

**2. [Rule 3 - Blocking] Provisionados PostgreSQL e Redis descartáveis para o gate real**
- **Found during:** verificação da Task 2.
- **Issue:** o processo não tinha `DATABASE_URL` e a máquina não possuía PostgreSQL instalado.
- **Fix:** archive oficial PostgreSQL 16.15 foi baixado por HTTPS, validado por tamanho/SHA-256 e iniciado loopback-only com Redis 8.10 loopback-only; o runner recebeu URLs apenas em memória.
- **Files modified:** nenhum arquivo persistente; bootstrap temporário foi removido.
- **Verification:** `rtk pnpm phase2:integration` passou com 4 arquivos e 21 testes; processos, data root e archive foram removidos.
- **Committed in:** não aplicável (infraestrutura efêmera).

---

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 3). **Impact on plan:** somente correções necessárias para provar os contratos de segurança e executar o gate real; nenhuma ampliação de UI, copy, estilo ou arquitetura.

## Issues Encountered

- O PowerShell local não expõe `Get-FileHash`; a validação temporária usou a implementação SHA-256 do .NET.
- `Expand-Archive` foi substituído por `tar.exe` durante o bootstrap efêmero por desempenho; nenhum script temporário permaneceu no repositório.
- Lint global preserva três warnings preexistentes de `!important` no bloco reduced-motion de `globals.css`; estão fora do escopo estrito desta remediação visual-free.

## Known Stubs

None. Os matches de valores vazios pertencem a acumuladores/test fixtures ou validação explícita; não há dados mockados fluindo para UI de produção.

## TDD Gate Compliance

- Task 1: RED `f65a4e5` antes de GREEN `a86eb74`.
- Task 2: RED `3cf54d7` antes de GREEN `564e750`.

## Verification

- `rtk pnpm --filter @pubg-camp/web test -- organization-logo-origins security-headers identity/auth` - PASS, 85 testes.
- `rtk pnpm --filter @pubg-camp/web build` - PASS, build Next 16 de produção.
- `rtk pnpm --filter @pubg-camp/api test -- organization-logo` - PASS, 151 testes executados e 6 integrações externas corretamente separadas.
- `rtk pnpm phase2:integration` - PASS contra PostgreSQL/Redis reais, 4 arquivos e 21 testes.
- `rtk pnpm lint` - PASS, 22 tasks e dependency boundaries verdes; 3 warnings preexistentes.
- `rtk pnpm typecheck` - PASS.
- `rtk pnpm test` - PASS, 22 tasks do monorepo.
- `rtk pnpm verify:secrets` - PASS, 364 arquivos verificados.

## User Setup Required

None - nenhuma nova configuração externa ou credencial é necessária.

## Next Phase Readiness

- ORG-001 e NFR-005 têm regressões para o contrato de origin assinada e para a fronteira de compensação.
- Pronto para o próximo plano de gap closure da Fase 2; redesign visual continua reservado à Fase 2.1.

## Self-Check: PASSED

- Parser/spec/summary existem no disco.
- Commits `f65a4e5`, `a86eb74`, `3cf54d7` e `564e750` existem no histórico.
- Critérios de aceitação e verificação do plano foram reexecutados com sucesso.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
