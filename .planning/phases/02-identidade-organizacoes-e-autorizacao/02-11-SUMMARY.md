---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 11
subsystem: ui
tags: [react, radix-ui, lucide, vitest, jsdom, accessibility, wcag]
requires:
  - phase: 02-10
    provides: allowlist humana dos nomes e versões exatas de pacotes UI e teste
  - phase: 02-08
    provides: fluxos de sessão e identidade consumidos pelas próximas telas privadas
  - phase: 02-16
    provides: autorização default-deny que permanece autoritativa fora dos componentes
provides:
  - tokens grafite e teal responsivos conforme o UI-SPEC
  - primitivos acessíveis para controles, dialogs, menus, tabs, tooltips, toasts e feedback
  - runtime Vitest jsdom isolado de testes Node por projeto
affects: [02-12, 02-13, 02-14, 02-15, web, identity-ui, organizations-ui]
tech-stack:
  added:
    - Radix UI Primitives 1.x/2.x
    - lucide-react 1.33.0
    - Testing Library 16.3.2
    - user-event 14.6.5
    - jsdom 30.0.1
    - Playwright 1.62.1
    - axe-playwright 4.13.0
  patterns:
    - UI packages isolated behind local primitives
    - node and jsdom Vitest projects selected by file suffix
    - accessible state feedback with explicit text and live-region semantics
key-files:
  created:
    - apps/web/vitest.config.ts
    - apps/web/src/components/ui/dialog.tsx
    - apps/web/src/components/ui/menu.tsx
    - apps/web/src/components/ui/feedback.tsx
  modified:
    - apps/web/package.json
    - pnpm-lock.yaml
    - apps/web/src/app/globals.css
    - apps/web/src/app/layout.tsx
key-decisions:
  - "Radix e Lucide ficam isolados nos primitivos locais; componentes de domínio não precisam importar APIs de terceiros."
  - "Specs TSX executam em jsdom e testes de route continuam em Node por projetos Vitest distintos."
  - "A interface usa apenas quatro tamanhos, dois pesos e tokens globais; nenhum hexadecimal entra nos componentes TSX."
patterns-established:
  - "Primitivos interativos garantem alvo mínimo de 44px, foco teal de 2px, Escape e retorno de foco."
  - "Estados operacionais usam copy exata, ícone mais texto e role alert/status conforme urgência."
requirements-completed: [AUTH-003, AUTH-005, AUTH-006, NFR-005]
duration: 16min
completed: 2026-08-21
---

# Phase 2 Plan 11: Accessible UI Foundation Summary

**Tokens grafite/teal e primitivos Radix acessíveis com teclado, foco previsível, reduced motion e testes jsdom**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-21T07:46:00Z
- **Completed:** 2026-08-21T08:01:45Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Instalados e fixados somente os 12 nomes e versões aprovados no gate de supply chain 02-10; a allowlist exata foi verificada antes e depois.
- Criado o sistema visual do UI-SPEC com Geist Sans, quatro tamanhos, dois pesos, grafite/teal, alvos 44/48px, foco visível e movimento reduzido entre 320px e 1440px.
- Entregues Button, Input, Dialog, AlertDialog, Dropdown, Tabs, Tooltip, Toast, badges, alertas, empty state, skeleton e estados operacionais reutilizáveis.
- Cobertos teclado, Escape, retorno de foco, labels, descrições, live regions, tokens e ausência de cores hexadecimais em primitivos por 10 testes automatizados.

## Task Commits

1. **Task 1: Instalar pacotes aprovados e configurar testes de interação**
   - `88d362e` — dependências exatas, lockfile e projetos Vitest
   - `8d01355` — herança correta do transformador JSX nos projetos Vitest
2. **Task 2: Implementar tokens e primitivos acessíveis (TDD)**
   - `cdc193e` — RED com specs de interação inicialmente falhando pela ausência dos primitivos
   - `99d199d` — GREEN com tokens, layout e primitivos acessíveis

## Files Created/Modified

- `apps/web/package.json` e `pnpm-lock.yaml` — 12 pacotes legitimados com versões exatas e árvore reproduzível.
- `apps/web/vitest.config.ts` — projetos Node para `.test.ts` e jsdom para `.spec.tsx`.
- `apps/web/src/app/globals.css` — tokens, tipografia, foco, controles, camadas, estados, responsividade e reduced motion.
- `apps/web/src/app/layout.tsx` — Geist Sans, `lang="pt-BR"` e skip link funcional.
- `apps/web/src/components/ui/button.tsx` — variantes primary, secondary, ghost, destructive e Discord com loading verbal.
- `apps/web/src/components/ui/input.tsx` — label visível, helper, erro associado e foco por ref.
- `apps/web/src/components/ui/dialog.tsx` — Dialog e AlertDialog com trap, Escape, cancelamento e retorno de foco do Radix.
- `apps/web/src/components/ui/menu.tsx` — Dropdown, Tabs e Tooltip navegáveis por teclado.
- `apps/web/src/components/ui/toast.tsx` — notificação polite sem mover foco.
- `apps/web/src/components/ui/feedback.tsx` — badges, alertas, empty state, skeleton e estados globais seguros.
- `apps/web/src/components/ui/ui.spec.tsx` — testes de interação e contrato visual sem snapshots amplos.

## Decisions Made

- Mantida a API de autorização fora da UI: primitivos aceitam apenas conteúdo e capacidades já resolvidas, e a API continua autoridade.
- O projeto jsdom herda explicitamente o transformador JSX do config raiz, preservando o `jsx: preserve` necessário ao build Next.
- A revisão `vercel:react-best-practices` não encontrou hooks, efeitos, data fetching ou componentes inline desnecessários; o único finding relevante, ID fixo em `EmptyState`, foi removido em favor de nome acessível sem colisões.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Herdado o transformador JSX nos projetos Vitest**
- **Found during:** Task 2, gate RED
- **Issue:** projetos Vitest isolados não herdavam a configuração Oxc e deixavam JSX preservado até o import analysis.
- **Fix:** habilitada herança explícita e runtime JSX automático apenas no runner de testes.
- **Files modified:** `apps/web/vitest.config.ts`
- **Verification:** o RED passou a falhar pela ausência intencional dos módulos; após GREEN, 10/10 testes passaram.
- **Committed in:** `8d01355`

**2. [Rule 1 - Bug] Corrigida expectativa inicial de navegação do Dropdown**
- **Found during:** Task 2, GREEN
- **Issue:** o teste pressupunha que abrir o menu já focaria o primeiro item antes do primeiro ArrowDown, mas o contrato Radix posiciona o foco no conteúdo.
- **Fix:** o teste agora prova a sequência real: primeiro ArrowDown foca o primeiro item, segundo ArrowDown foca o próximo e Escape devolve foco ao gatilho.
- **Files modified:** `apps/web/src/components/ui/ui.spec.tsx`
- **Verification:** teste de teclado passou sem alterar o comportamento acessível do Radix.
- **Committed in:** `99d199d`

---

**Total deviations:** 2 auto-fixed (2 bugs). **Impact on plan:** correções restritas ao runtime e à prova automatizada, sem novo pacote ou ampliação funcional.

## Issues Encountered

- Vitest/Vite informa que a configuração TypeScript ESM é carregada hoje pelo loader runner em um pacote sem `type: module`; é um aviso de compatibilidade futura, não afeta execução, typecheck ou build atual.

## Known Stubs

None. Os componentes recebem dados por props e todos os estados planejados possuem conteúdo, sem mocks ou placeholders em fluxo de produção.

## User Setup Required

None - nenhuma credencial ou serviço externo é necessário para esta fundação visual.

## Next Phase Readiness

- As telas privadas podem compor os primitivos sem importar Radix/Lucide diretamente e sem duplicar tokens.
- O key-link `dialog.tsx` → `@radix-ui/react-dialog` existe e os gates de teclado/foco estão verdes.
- Playwright e axe estão instalados para os checkpoints visuais e de acessibilidade posteriores; nenhum navegador foi baixado por este plano.

## Verification

- `rtk pnpm install --frozen-lockfile` — passou.
- `rtk node scripts/audit-phase2-packages.mjs --verify-exact-list` — cardinalidade 12 e igualdade exata.
- `rtk pnpm --filter @pubg-camp/web test` — 10/10 testes passaram em 2 arquivos.
- `rtk pnpm turbo run lint typecheck build --filter=@pubg-camp/web` — 7/7 tarefas passaram.
- Revisão `vercel:react-best-practices` aplicada após as edições TSX; finding acessível corrigido.

## Self-Check: PASSED

- Os 12 arquivos declarados existem e os commits `88d362e`, `8d01355`, `cdc193e` e `99d199d` estão no histórico.
- O gate TDD possui commit RED anterior ao commit GREEN.
- A varredura de stubs não encontrou TODO, FIXME, placeholder ou dados vazios conectados à UI.
- Nenhum arquivo foi excluído pelos commits do plano e o worktree terminou limpo antes do tracking.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
