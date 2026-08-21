---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 12
subsystem: identity-ui
tags: [nextjs, react, discord-oauth, otp, csrf, invitations, accessibility]

requires:
  - phase: 02-07
    provides: OAuth Discord, OTP e sessões server-side
  - phase: 02-11
    provides: primitivos visuais locais e ambiente jsdom
  - phase: 02-16
    provides: guards globais, CSRF e autorização server-side
  - phase: 02-19
    provides: BFF same-origin com allowlist e rotação CSRF
provides:
  - Login Discord-first e fallback por OTP de oito dígitos sem senha
  - Callback OAuth POST-only que remove code/state antes de renderizar
  - Preview e aceite de convite com contexto fora do DOM e confirmação explícita
  - Estados acessíveis de erro, cooldown, convite e concorrência
affects: [02-13, 02-14, 02-15, 02-18, identity-ui, onboarding]

tech-stack:
  added: []
  patterns:
    - Server Components nas páginas com hidratação restrita aos forms
    - mutação browser via BFF same-origin com CSRF adquirido sob demanda
    - contexto sensível removido da URL antes de renderizar dados

key-files:
  created:
    - apps/web/src/components/identity/email-otp-form.tsx
    - apps/web/src/components/identity/oauth-callback-form.tsx
    - apps/web/src/components/identity/invitation-accept-form.tsx
    - apps/web/src/app/(auth)/entrar/page.tsx
    - apps/web/src/app/(auth)/convites/aceitar/page.tsx
  modified:
    - apps/web/src/app/api/platform/[...path]/route.ts
    - apps/api/src/identity/identity.controller.ts
    - apps/web/src/app/globals.css

key-decisions:
  - "O desafio OTP permanece ausente do JSON público e atravessa somente um header opaco allowlisted pelo BFF."
  - "O callback OAuth público aceita apenas POST com CSRF; GET não processa code/state."
  - "O contexto do convite sai da URL antes do preview e fica sob custódia HttpOnly por no máximo dez minutos."

patterns-established:
  - "Sensitive URL intake: ler query/fragment no menor client boundary, executar history.replaceState e somente depois atualizar a UI."
  - "Explicit authority: preview é separado do POST de aceite e nenhuma mutação é otimista."

requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-006, ORG-002, NFR-005]

duration: 13min
completed: 2026-08-21
---

# Phase 2 Plan 12: Login, OTP, Callback e Convites Summary

**Experiência pública Discord-first com OTP acessível, callback POST-only e aceite de convite sem code, state ou token no DOM e na URL final.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-21T08:26:00Z
- **Completed:** 2026-08-21T08:39:00Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments

- Criado auth shell responsivo 40/60, login Discord prioritário e fallback por e-mail com resposta não enumerável.
- Implementado OTP em input semântico único de oito dígitos com paste filtrado, cooldown, reenvio, foco recuperado e submit exclusivamente explícito.
- Sanitizados callback e convite antes de renderizar dados, com BFF+CSRF, POST-only e custódia HttpOnly do contexto do convite.
- Cobertos teclado, foco, clique duplicado, estados terminal/concorrente de convite e ausência dos segredos no DOM.

## Task Commits

1. **Task 1 RED: Login Discord-first e OTP** - `1ff39d8` (test)
2. **Task 1 GREEN: Login Discord-first e OTP** - `41ac732` (feat)
3. **Task 2 RED: Callback e convite** - `b0fe4f2` (test)
4. **Task 2 GREEN: Callback e convite** - `64c0b81` (feat)

## Files Created/Modified

- `apps/web/src/components/identity/auth-shell.tsx` - shell público responsivo sem navegação da plataforma.
- `apps/web/src/components/identity/discord-button.tsx` - início Discord com CSRF, loading e proteção contra clique duplicado.
- `apps/web/src/components/identity/email-otp-form.tsx` - request/verify, resposta uniforme, cooldown e estados de falha.
- `apps/web/src/components/identity/otp-input.tsx` - input único acessível com apresentação segmentada.
- `apps/web/src/components/identity/oauth-callback-form.tsx` - sanitiza URL e conclui callback via POST same-origin.
- `apps/web/src/components/identity/invitation-accept-form.tsx` - preview e aceite autoritativo de todos os estados de convite.
- `apps/web/src/components/identity/auth.spec.tsx` - interação, teclado, foco, segurança de URL e estados completos.
- `apps/web/src/app/(auth)/**` - rotas Server Component, loading e error boundary do fluxo público.
- `apps/web/src/app/api/platform/[...path]/route.ts` - callback POST-only, header OTP e custódia HttpOnly do convite.
- `apps/api/src/identity/identity.controller.ts` - callback POST e desafio OTP opaco por header.
- `apps/web/src/app/globals.css` - layout auth, OTP segmentado e preview responsivo usando tokens globais.

## Decisions Made

- O identificador opaco do desafio OTP usa header allowlisted, preservando a resposta JSON uniforme e sem confirmar existência de conta.
- `code` e `state` são lidos apenas em variáveis locais, removidos com `history.replaceState` e enviados ao BFF por POST com CSRF.
- O token do convite nunca entra em props, estado React ou DOM; após preview, o BFF o mantém em cookie HttpOnly `Secure`/`SameSite=Strict` por dez minutos e o remove no aceite/concorrência.
- A revisão `vercel:react-best-practices` manteve dados serializados no limite RSC em zero e moveu o formatador de data estático para escopo de módulo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Conectado desafio OTP sem alterar o JSON público**
- **Found during:** Task 1
- **Issue:** A verificação exige `challengeId`, mas o request público corretamente não o devolvia, tornando o fluxo browser impossível.
- **Fix:** O controller inclui o identificador opaco em header e o BFF encaminha somente esse header explicitamente allowlisted.
- **Files modified:** `apps/api/src/identity/identity.controller.ts`, `apps/web/src/app/api/platform/[...path]/route.ts`
- **Verification:** Testes de controller, BFF e form passaram; JSON continua sem `challengeId`.
- **Committed in:** `41ac732`

**2. [Rule 2 - Security] Convertido callback mutável de GET para POST com CSRF**
- **Found during:** Task 2
- **Issue:** O backend anterior processava `code/state` por GET, contrariando o requisito de GET read-only e mantendo os segredos na URL.
- **Fix:** Controller e BFF aceitam callback somente por POST; o form remove a query antes de executar o POST same-origin.
- **Files modified:** `apps/api/src/identity/identity.controller.ts`, `apps/web/src/app/api/platform/[...path]/route.ts`, `apps/web/src/components/identity/oauth-callback-form.tsx`
- **Verification:** Teste prova GET 405, POST com CSRF e URL/DOM sem `code/state`.
- **Committed in:** `64c0b81`

**3. [Rule 2 - Security] Adicionada custódia server-side curta do convite**
- **Found during:** Task 2
- **Issue:** Remover o token da URL impediria o aceite posterior ou exigiria guardá-lo em estado cliente.
- **Fix:** O BFF guarda o contexto em cookie HttpOnly estrito por dez minutos, remove-o do cookie encaminhado e o injeta apenas no POST explícito de aceite.
- **Files modified:** `apps/web/src/app/api/platform/[...path]/route.ts`, `apps/web/src/components/identity/invitation-accept-form.tsx`
- **Verification:** Testes provam preview, custódia HttpOnly, aceite sem token no body e limpeza após uso.
- **Committed in:** `64c0b81`

---

**Total deviations:** 3 auto-fixed (3 missing critical/security).
**Impact on plan:** Ajustes indispensáveis para o fluxo real e para as mitigações T-02-25/T-02-26; nenhuma nova dependência, tabela ou serviço foi criado.

## Issues Encountered

- A fixture legada do BFF usava contexto menor que o contrato mínimo de 16 caracteres; foi alinhada ao contrato e ampliada para validar o cookie HttpOnly.
- O comando typecheck filtrado pelo RTK reportou uma limitação do wrapper; a execução via `rtk proxy pnpm` confirmou TypeScript sem erros.

## User Setup Required

None - este plano não adicionou serviços ou variáveis externas. O cadastro Discord já documentado em `02-USER-SETUP.md` continua aplicável à fase.

## Verification

- Web: 33 testes, lint, typecheck e build Next.js passaram.
- API: 125 testes disponíveis, lint, typecheck e build passaram; 6 testes de infraestrutura permaneceram pulados conforme ambiente.
- Secret scan passou em 269 arquivos.
- Key-link `email-otp-form.tsx` → `/api/platform/identity/otp` passou (1/1).
- `git diff --check` passou e a varredura de stubs não encontrou TODO/FIXME/placeholder.

## Known Stubs

None.

## Next Phase Readiness

- Fluxos públicos de identidade estão prontos para onboarding e telas autenticadas.
- Pronto para o plano 02-22 e demais telas operacionais da fase.

## Self-Check: PASSED

- Todos os key files existem no disco.
- Os quatro commits RED/GREEN do plano existem no histórico.
- Nenhuma verificação final falhou.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
