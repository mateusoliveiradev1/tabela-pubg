---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 18
subsystem: browser-e2e-ci
tags: [playwright, chromium, axe, accessibility, neon, redis, nextjs, github-actions]

requires:
  - phase: 02-13
    provides: shell autenticado, organizações, membros e sessões
  - phase: 02-17
    provides: preflight PostgreSQL/Redis e suíte de integração da fase
  - phase: 02-22
    provides: port seguro de logo e contrato de upload/preview
provides:
  - lifecycle E2E fail-closed com preflight, seed, API fake, Next e cleanup determinísticos
  - smoke Chromium de autenticação, organização, bytes PNG, convite e revogação de sessão
  - matriz Playwright 320/768/1440/reduced-motion com axe e navegação por teclado
  - job CI obrigatório com Chromium, smoke antes da suíte completa e artefatos somente em falha
affects: [phase-02-verification, browser-ci, organization-branding, accessibility]

tech-stack:
  added: []
  patterns:
    - provider E2E habilitado somente pela conjunção fake + test + run id válido
    - lifecycle browser fail-closed com preflight antes de qualquer seed ou processo
    - evidência browser por matriz explícita e artefatos retidos apenas em falha

key-files:
  created:
    - scripts/run-phase2-e2e.mjs
    - scripts/seed-phase2-e2e.mjs
    - apps/web/playwright.config.ts
    - apps/web/e2e/fixtures.ts
    - apps/web/e2e/phase2-accessibility.spec.ts
    - apps/api/src/organizations/adapters/e2e-organization-logo-storage.ts
  modified:
    - .github/workflows/ci.yml
    - apps/api/src/organizations/organizations.module.ts
    - apps/web/src/app/api/platform/[...path]/route.ts
    - apps/web/src/components/layout/app-shell.tsx
    - apps/web/src/app/globals.css

key-decisions:
  - "O runner aborta antes de seed/start sem PostgreSQL, Redis, modo fake e run id válidos; cleanup usa o mesmo escopo por execução."
  - "O provider de logo fake só existe sob E2E_PROVIDER_MODE=fake, NODE_ENV=test e E2E_RUN_ID válido; qualquer uso parcial falha no boot."
  - "A CI mantém main e pull_request, instala Chromium oficial e executa smoke antes da suíte browser completa."

patterns-established:
  - "E2E hermético: preflight → seed per-run → fake API + web → Chromium → cleanup em finally."
  - "Acessibilidade browser: axe + overflow + teclado/foco + movimento reduzido em projects explícitos."

requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, AUTH-006, ORG-001, ORG-002, ORG-003, ORG-004, ORG-005, AUD-001, NFR-005]

duration: 34min
completed: 2026-08-21
---

# Phase 2 Plan 18: Harness Chromium E2E determinístico Summary

**Harness Playwright fail-closed com Neon/Redis reais, providers externos falsos por execução, matriz acessível em quatro perfis e gate CI smoke-first.**

## Performance

- **Duration:** 34 min
- **Started:** 2026-08-21T10:14:00Z
- **Completed:** 2026-08-21T10:48:00Z
- **Tasks:** 3
- **Files modified:** 19

## Accomplishments

- O runner exige o preflight de PostgreSQL/Redis antes de criar estado, sobe API fake e Next, aguarda readiness e sempre remove DB, Redis, objetos, temporários e árvores de processos.
- O smoke Chromium prova OTP, organização seeded, upload e leitura dos bytes PNG exatos, branding do convite e revogação de sessão sem chamar S3, Discord ou Resend.
- A suíte completa cobre 320, 768, 1440 e reduced-motion com axe WCAG, overflow, teclado, restauração de foco, estados terminais opacos e isolamento cross-org.
- A CI preserva `main` e `pull_request`, inclui a branch exata da fase e executa preflight, instalação oficial do Chromium, smoke e suíte completa nessa ordem.

## Task Commits

1. **Task 1: Construir lifecycle E2E e browser smoke** — `30150a3` (RED), `3dac2d2` (GREEN)
2. **Task 2: Cobrir fluxos, viewports e acessibilidade no Chromium** — `8e8defd` (RED), `86a6d71` (GREEN), `729dd49` (fix)
3. **Task 3: Executar browser smoke e E2E completo na CI** — `e6fb669` (chore)

## Files Created/Modified

- `scripts/run-phase2-e2e.mjs` — orquestra preflight, run id, API fake, Next, Chromium e teardown determinístico.
- `scripts/seed-phase2-e2e.mjs` — cria e remove fixtures PostgreSQL/Redis vinculadas à execução.
- `apps/web/playwright.config.ts` — define Chromium e os quatro projects de viewport/movimento.
- `apps/web/e2e/fixtures.ts` — autenticação OTP e identificadores determinísticos compartilhados.
- `apps/web/e2e/phase2-smoke.spec.ts` — smoke de autenticação, organização, logo, convite e sessão.
- `apps/web/e2e/phase2-accessibility.spec.ts` — axe, clipping, teclado, privacidade, RBAC e reduced-motion.
- `apps/api/src/organizations/adapters/e2e-organization-logo-storage.ts` — storage fake isolado por run id com bytes exatos.
- `apps/api/src/organizations/organizations.module.ts` — seleção estrita e fail-closed do provider E2E.
- `apps/web/src/app/api/platform/[...path]/route.ts` — BFF same-origin e rota de bytes limitada ao harness.
- `.github/workflows/ci.yml` — job E2E final com serviços, Chromium e artefatos somente em falha.
- `scripts/validate-phase2-ci.mjs` — valida triggers, ordem e invariantes do job browser.

## Decisions Made

- Preflight é uma barreira real: falha de infraestrutura encerra o runner antes de seed, API ou web.
- O ambiente browser recebe um único `E2E_RUN_ID`; fixtures, API, storage e cleanup rejeitam escopos ausentes ou inválidos.
- `Sec-Fetch-Site: same-origin`, controlado pelo navegador, prevalece sobre diferenças de host normalizadas pelo Next; `cross-site` continua rejeitado.
- Movimento reduzido é configurado no project e reforçado explicitamente no cenário que mede a mídia e as durações computadas.
- CI usa providers locais falsos e nunca recebe credenciais de S3, Discord ou Resend.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrigida hidratação do Next no origin loopback do harness**
- **Found during:** Task 1, primeiro smoke real.
- **Issue:** chunks de desenvolvimento eram bloqueados quando o navegador usava `127.0.0.1` e o Next normalizava outro host.
- **Fix:** permitido o origin loopback no desenvolvimento e limitado `unsafe-inline`/`unsafe-eval` ao CSP de desenvolvimento; produção permanece restrita.
- **Files modified:** `apps/web/next.config.ts`
- **Verification:** smoke Chromium 2/2 e build de produção passaram.
- **Committed in:** `3dac2d2`

**2. [Rule 1 - Bug] Corrigida prova same-origin do BFF após normalização de host**
- **Found during:** Task 1, smoke com `GET /api/platform/security/csrf` 403.
- **Issue:** Origin/Referer de `127.0.0.1` divergiam do host normalizado em `request.url`, apesar do navegador enviar `Sec-Fetch-Site: same-origin`.
- **Fix:** o metadado browser-owned same-origin passou a ter precedência, mantendo rejeição explícita de cross-site, com regressão unitária.
- **Files modified:** `apps/web/src/app/api/platform/[...path]/route.ts`, `route.spec.ts`
- **Verification:** 14/14 testes do BFF e smoke real passaram.
- **Committed in:** `3dac2d2`

**3. [Rule 1 - Bug] Tornados upload, login e teardown repetíveis no Windows**
- **Found during:** Task 1, reexecuções do smoke.
- **Issue:** o diretório por run ainda não existia no primeiro upload, a sessão remota ficava revogada entre logins e processos filhos do Next podiam sobreviver ao pai.
- **Fix:** criação do diretório antes do write, reset autoritativo da fixture no OTP e encerramento da árvore pertencente ao runner.
- **Files modified:** `scripts/run-phase2-e2e.mjs`
- **Verification:** múltiplas execuções fizeram seed/cleanup e terminaram sem listeners em 3100/3101.
- **Committed in:** `3dac2d2`

**4. [Rule 1 - Bug] Corrigidos testes cross-project e a cascata de movimento reduzido**
- **Found during:** Task 2, primeira execução integral nos quatro projects.
- **Issue:** controles do Next participavam do tab order em dev, locators mudavam de nome acessível ao abrir o drawer, um heading era ambíguo e seletores de componente venciam a regra universal de reduced-motion.
- **Fix:** navegação continua exclusivamente por teclado tolerando controles de dev, locators usam identidade estável/exata, a mídia é emulada e provada, e durações reduced-motion vencem a cascata.
- **Files modified:** `apps/web/e2e/phase2-accessibility.spec.ts`, `apps/web/src/app/globals.css`
- **Verification:** suíte real final: 26 passed, 6 skips condicionais esperados, 0 failed.
- **Committed in:** `729dd49`

---

**Total deviations:** 4 auto-fixed (4 bugs). **Impact:** todos corrigem execução real, isolamento ou acessibilidade previstos; nenhuma integração externa ou escopo de produto foi acrescentado.

## Issues Encountered

- O build global mantém o warning conhecido de nome de link longo no standalone do AWS SDK no Windows, com exit code 0.
- A execução integral, embora reservada originalmente ao plano 02-24, foi antecipada como gate seguro e passou nos quatro projects.

## Known Stubs

None. O servidor API do harness é deliberadamente fake/test-only e implementa os contratos necessários com dados determinísticos, não um placeholder de produção.

## Verification

- TDD lifecycle: RED por storage/harness ausentes; GREEN com provider estrito e smoke real 2/2.
- TDD acessibilidade: RED por navegador indisponível; GREEN com quatro projects e execução integral 26 passed, 6 skips condicionais, 0 failed.
- Chromium oficial: instalado e usado pelo runner real.
- Preflight Neon `icy-dust-72776406` / branch de integração + Redis `127.0.0.1:6380`: PASS; URI mantida apenas em memória.
- Seed, readiness, bytes PNG, convite branded, revoke e cleanup: PASS.
- Axe WCAG, 320/768/1440, teclado/foco e reduced-motion: PASS.
- CI estrutural: PASS; smoke aparece antes da suíte completa e artefatos usam `if: failure()`.
- Secret scan: 313 arquivos: PASS.
- Lint e boundaries globais: 22/22 tarefas: PASS.
- Typecheck global: 22/22 tarefas: PASS.
- Testes globais: 22/22 tarefas: PASS.
- Build global: 13/13 tarefas: PASS.
- Diff check: PASS.
- Key-links: 3/3: PASS.

## Threat Flags

None. API fake, proxy de bytes e seleção de provider pertencem ao trust boundary e ao registro STRIDE do plano; o modo exige a conjunção test/fake/run-id e não abre superfície de produção.

## User Setup Required

None. O runner exige `DATABASE_URL` e `REDIS_URL` no processo de execução; a CI fornece serviços locais e nenhuma credencial de provider externo.

## Next Phase Readiness

- O gate browser final pode ser reutilizado pelo plano 02-24 e pela proteção de PR sem alterar flags de validação.
- Não há blocker funcional; o único aviso é o warning não bloqueante de path longo do standalone no Windows.

## Self-Check: PASSED

- Dezenove arquivos do plano foram confirmados no diff e os seis commits RED/GREEN/fix/CI foram confirmados no histórico.
- Smoke real, suíte integral, gate global e 3/3 key-links foram executados com exit code 0.
- Nenhuma deleção inesperada, credencial persistida ou stub bloqueante foi encontrada.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
