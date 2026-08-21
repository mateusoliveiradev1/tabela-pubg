---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 13
subsystem: ui
tags: [nextjs, react, account-security, organizations, csrf, server-components]

requires:
  - phase: 02-09
    provides: contratos e fluxos autoritativos de identidade, sessão e organizações
  - phase: 02-12
    provides: fundação visual, BFF autenticado e componentes acessíveis
provides:
  - shell privada responsiva com organização explícita na URL e navegação por capabilities
  - onboarding e criação de organização com upload validado
  - vinculação explícita de Discord/e-mail e proteção da última identidade
  - gestão autoritativa de sessões e resolução privada de alertas de novo acesso
affects: [campeonatos-privados, membros, convites, auditoria, account-security]

tech-stack:
  added: []
  patterns: [server-components-for-authenticated-reads, bff-csrf-mutations, explicit-org-url-context]

key-files:
  created:
    - apps/web/src/components/layout/app-shell.tsx
    - apps/web/src/components/layout/organization-switcher.tsx
    - apps/web/src/components/identity/device-session-card.tsx
    - apps/web/src/components/identity/identity-cards.tsx
    - apps/web/src/components/organizations/create-organization-form.tsx
  modified:
    - apps/web/src/app/(platform)/layout.tsx
    - apps/web/src/app/(platform)/conta/sessoes/page.tsx
    - apps/web/src/app/api/platform/[...path]/route.ts
    - apps/web/src/app/globals.css

key-decisions:
  - "Leituras privadas permanecem em Server Components com cookie HttpOnly encaminhado apenas ao upstream interno; mutações passam exclusivamente pelo BFF com CSRF."
  - "O contexto de alerta é resolvido no servidor e removido da URL por um Client Component sem props, evitando serializar contexto opaco no DOM."
  - "A organização ativa é derivada de /o/{slug}; o switcher nunca persiste uma organização implícita na sessão."

patterns-established:
  - "Server-authoritative account UI: ações destrutivas aguardam resposta e recarregam dados sem optimistic update."
  - "Sensitive context minimization: cards omitem IP/fingerprint e páginas não enviam tokens ou alert contexts aos Client Components."

requirements-completed: [AUTH-002, AUTH-003, AUTH-004, AUTH-006, ORG-001, NFR-005]

duration: 25min
completed: 2026-08-21
---

# Phase 02 Plan 13: Área privada, identidades e segurança da conta Summary

**Shell privada responsiva com organização explícita, onboarding completo, identidades confirmadas e sessões revogáveis por fluxos autoritativos BFF+CSRF.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-21T09:09:30Z
- **Completed:** 2026-08-21T09:34:32Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments

- Criada uma shell desktop/mobile navegável por teclado, com switcher buscável a partir de oito organizações e contexto sempre visível na URL.
- Entregues primeiro acesso, overview seguro, criação de organização e vinculação explícita de Discord/e-mail, incluindo conflito não enumerável e proteção da última identidade.
- Entregue gestão de 1–20 dispositivos com sessão atual primeiro, revogação individual/das demais sem optimistic update e alertas active/revoked/expired/not-found resolvidos por GET autenticado.
- Preservados dados sensíveis: sem IP/fingerprint e sem token/contexto de alerta serializado em props, DOM ou URL após a resolução.

## Task Commits

Cada tarefa TDD foi registrada com gates RED e GREEN separados:

1. **Task 1: Criar platform shell, switcher e onboarding** — `05cd5c4` (RED), `5c31594` (GREEN)
2. **Task 2: Implementar criação de organização e formas de acesso** — `5013863` (RED), `5180bfe` (GREEN)
3. **Task 3: Implementar sessões, revogação e alerta de novo acesso** — `68893ba` (RED), `210f5eb` (GREEN)
4. **Correção final de tipagem estrita** — `c80d5d0` (fix)

## Files Created/Modified

- `apps/web/src/components/layout/app-shell.tsx` — shell responsiva e navegação filtrada por capabilities.
- `apps/web/src/components/layout/organization-switcher.tsx` — troca explícita por URL com busca para listas grandes.
- `apps/web/src/app/(platform)/layout.tsx` — carregamento privado server-side de organizações e capabilities.
- `apps/web/src/app/(platform)/primeiro-acesso/page.tsx` — escolhas reversíveis de convite/criação.
- `apps/web/src/app/(platform)/o/[slug]/page.tsx` — overview e estados seguros de autorização/erro.
- `apps/web/src/components/organizations/create-organization-form.tsx` — nome/logo, preview, remoção e submissão multipart.
- `apps/web/src/components/identity/identity-cards.tsx` — vinculação e remoção explícitas de identidades.
- `apps/web/src/components/identity/device-session-card.tsx` — sessões, confirmações e revogação autoritativa.
- `apps/web/src/app/(platform)/conta/sessoes/page.tsx` — consultas paralelas e resolução privada de alert context.
- `apps/web/src/components/identity/account.spec.tsx` — cobertura dos estados de shell, onboarding, identidades e sessões.
- `apps/web/src/app/api/platform/[...path]/route.ts` — limite multipart compatível com logos de organização.
- `apps/web/src/app/globals.css` — estilos responsivos e estados de foco para a área privada.

## Decisions Made

- Leituras privadas usam Server Components e o upstream interno; apenas mutações atravessam o BFF público com CSRF.
- O pequeno Client Component que limpa a URL do alerta recebe zero props, mantendo o contexto sensível exclusivamente no servidor.
- Rotas de conta continuam acessíveis mesmo quando o usuário ainda não possui organização, evitando bloquear onboarding e segurança da conta.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ajustado limite do BFF para criação multipart de organização**
- **Found during:** Task 2
- **Issue:** o limite JSON padrão do catch-all BFF impediria o logo multipart previsto no formulário.
- **Fix:** a rota de organizações passou a aceitar o limite multipart aprovado, mantendo allowlist, autenticação e CSRF.
- **Files modified:** `apps/web/src/app/api/platform/[...path]/route.ts`
- **Verification:** testes do BFF e 47 testes web passaram; build de produção verde.
- **Committed in:** `5180bfe`

**2. [Rule 1 - Bug] Corrigida tipagem estrita descoberta no build de produção**
- **Found during:** verificação final após Task 3
- **Issue:** narrowing de feedback, fixtures indexadas e prop opcional exata compilavam nos testes, mas falhavam no `next build`.
- **Fix:** normalizado o estado de feedback, protegidas as fixtures e omitida a prop opcional quando ausente.
- **Files modified:** `page.tsx`, `account.spec.tsx`, `identity-cards.tsx`
- **Verification:** lint, typecheck, 47 testes web e Next production build passaram.
- **Committed in:** `c80d5d0`

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** correções necessárias para o fluxo multipart e para o gate de produção, sem ampliar o escopo funcional.

## TDD Gate Compliance

- Task 1: RED `05cd5c4` → GREEN `5c31594`.
- Task 2: RED `5013863` → GREEN `5180bfe`.
- Task 3: RED `68893ba` → GREEN `210f5eb`.

## Verification

- Web: 47/47 testes, lint, typecheck e `next build` verdes.
- Monorepo: 22/22 tasks de teste, lint+boundaries, typecheck e build verdes.
- Segurança: secret scan passou em 288 arquivos; 2/2 key-links verificados; `git diff --check` limpo.
- Acessibilidade: ações de diálogo, foco pós-alerta, estados `aria-live` e navegação por teclado cobertos na implementação/testes.

## Known Stubs

None — todos os estados renderizados possuem fonte autoritativa ou estado de erro explícito; o `placeholder` do campo de busca é apenas rótulo auxiliar de entrada.

## Issues Encountered

- O Vite reporta aviso futuro sobre `configLoader: native` para a configuração CommonJS existente; não afeta os testes e está fora do escopo deste plano.

## User Setup Required

None — nenhuma credencial ou serviço externo real foi necessário.

## Next Phase Readiness

- A área privada está pronta para receber as telas de membros, convites, auditoria e campeonatos preservando o contexto `/o/{slug}`.
- Os endpoints contratados de identidade/sessão já alimentam os estados da UI sem mocks ou dados sensíveis no cliente.

## Self-Check: PASSED

- Arquivos-chave e SUMMARY encontrados no worktree.
- Todos os sete commits RED/GREEN/fix encontrados no histórico.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
