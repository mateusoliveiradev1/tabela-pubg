---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 15
subsystem: external-verification
tags: [discord-oauth, pkce, accessibility, nvda, resend, tls, transactional-email, impeccable]

requires:
  - phase: 02-20
    provides: matriz Nyquist promovida e todos os gates automatizados da Fase 2
  - phase: 02-24
    provides: CI remoto verde e imutável em checkout limpo
provides:
  - Discord OAuth real com PKCE S256 required, state/browser binding e callback limpo aprovado
  - fluxo crítico aprovado manualmente com teclado, NVDA, zoom 200%, contraste AA e reduced motion
  - entrega Resend real de OTP, convite e alerta de novo dispositivo com payload apagado
  - sistema transacional DROP MANIFEST aprovado visualmente e documentado pelo Impeccable
  - cookie TLS, CSRF, idempotência e ausência de segredos em browser, URL e logs validados no sandbox
affects: [02.1-impeccable, identity-runtime, transactional-email, phase-03]

tech-stack:
  added: []
  patterns:
    - OAuth iniciado por navegação POST do browser sem serializar authorization URL ou state no cliente
    - e-mail transacional table-based com shell híbrido 640px, estilos inline e contrato visual Impeccable
    - checkpoints externos exigem evidência humana; testes fake nunca autoaprovam integração real

key-files:
  created:
    - .planning/phases/02-identidade-organizacoes-e-autorizacao/02-15-SUMMARY.md
    - apps/web/src/components/identity/discord-navigation.ts
    - apps/worker/src/notifications/generate-previews.ts
    - apps/worker/previews/notifications/long-content.html
    - DESIGN.md
  modified:
    - apps/api/src/app.module.ts
    - apps/api/src/main.ts
    - apps/api/src/identity/identity.runtime.ts
    - apps/web/src/components/identity/discord-button.tsx
    - apps/web/next.config.ts
    - apps/worker/src/notifications/templates.ts
    - apps/worker/src/notifications/templates.spec.ts

key-decisions:
  - "Discord permanece em PKCE S256 required: o provider aceitou o fluxo real e nenhuma exceção documentada foi necessária."
  - "Navegação OAuth usa POST de formulário e allowlist CSP exata para discord.com; state, challenge e authorization URL continuam ausentes do DOM e do JSON."
  - "Impeccable é obrigatório para toda superfície visual do produto; e-mails adotam DROP MANIFEST e a Fase 2.1 fará o redesign integral."
  - "Credenciais externas permanecem somente no Environment User; branches e dados sandbox são destruídos ao concluir o checkpoint."

patterns-established:
  - "External proof: automação segura até o limite, inspeção humana explícita e cleanup redigido depois da aprovação."
  - "Transactional email: preheader, HTML table-based 640px, plain text equivalente, CTA com fallback e payload cifrado apagado após acknowledgement."
  - "Visual done: direção, fixtures extremas, screenshots, finish review PASS e documentação são parte da definição de pronto."

requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-006, NFR-005]

duration: 3h 36m
completed: 2026-08-24
---

# Phase 2 Plan 15: Verificação externa e assistiva Summary

**Discord OAuth/PKCE, acessibilidade assistiva e entrega Resend/TLS foram comprovados em ambientes reais, com e-mails DROP MANIFEST aprovados e todos os dados sandbox removidos.**

## Performance

- **Duration:** 3h 36m, incluindo checkpoints humanos, correções TDD e inspeção visual
- **Started:** 2026-08-23T22:23:38-03:00
- **Completed:** 2026-08-24T02:00:00-03:00
- **Tasks:** 3 checkpoints humanos aprovados
- **Files modified:** 40 arquivos e artefatos rastreados entre runtime, testes, previews e documentação visual

## Accomplishments

- O login Discord real concluiu Authorization Code com PKCE S256, redirect exato, scopes `identify`/`email`, callback sem parâmetros persistidos e sessão confirmada; replay/mismatch continuaram negados.
- O fluxo crítico foi aprovado no Windows com NVDA 2026.1.1, teclado, zoom 200%, contraste e reduced motion após smoke automatizado.
- OTP, convite e alerta de novo dispositivo chegaram pelo Resend; a rodada visual final teve 3/3 acknowledgements, zero pending/failed e 3/3 envelopes cifrados apagados.
- Os e-mails deixaram o card SaaS genérico e nasceram como DROP MANIFEST: carbono, marfim, laranja sinal, vermelho restrito à segurança, manifesto industrial responsivo e compatível com clientes de e-mail.
- A branch Neon `phase2-resend-tls-sandbox` foi excluída; web, API, worker, Redis e tunnel ficaram com zero processos/listeners, enquanto a chave Resend rotacionada e as variáveis User foram preservadas.

## Task Commits

1. **Task 1: Verificar Discord OAuth e gate PKCE no sandbox** — `2401cc2`, `e45c597`, `36037c0`, `55d9336`, `2090a55`, `c8816bd`
2. **Task 2: Verificar leitor de tela, zoom, contraste e motion** — checkpoint humano aprovado; nenhuma alteração de código foi necessária no gate
3. **Task 3: Verificar entrega real de e-mail e cookie TLS** — `f06523e`, `16ce488`, `ba2f5ab`, `bf1acc7`, `7f98dfe`, `fa3554f`

**Finish visual e governança:** `63f1cf4` (DESIGN/Impeccable) e `7350831` (Fase 2.1 oficial).

## Files Created/Modified

- `apps/api/src/app.module.ts` e `apps/api/src/main.ts` — compõem o IdentityModule real no runtime Nest/Fastify.
- `apps/web/src/components/identity/discord-navigation.ts` e `discord-button.tsx` — entregam o POST OAuth à navegação real do browser.
- `apps/web/next.config.ts` — autoriza somente o destino final exato do formulário Discord na CSP.
- `apps/api/src/identity/identity.runtime.ts` — alinha o envelope OTP ao contrato seguro consumido pelo worker.
- `apps/worker/src/notifications/templates.ts` — implementa os templates DROP MANIFEST com plain text, escaping e compatibilidade de clientes.
- `apps/worker/src/notifications/templates.spec.ts` — cobre contrato visual, conteúdo extremo, contraste, shell híbrido e ausência de vazamentos.
- `apps/worker/previews/notifications/*.html` — fixtures seguras para OTP, convite, novo dispositivo e conteúdo longo.
- `DESIGN.md`, `.impeccable/design.json` e `.impeccable/review/email/*` — contrato, decisão e evidência visual do finish review PASS.

## Decisions Made

- PKCE S256 permanece obrigatório porque o Discord aceitou o fluxo real; o fallback `documented-exception` não foi ativado.
- A UI inicia OAuth por form navigation POST. O BFF continua sem devolver state, challenge ou authorization URL no DOM/JSON.
- O visual aprovado dos e-mails é DROP MANIFEST; o mandato Impeccable foi elevado a regra transversal e será aplicado ao produto inteiro na Fase 2.1.
- A rodada final de e-mails executou uma unidade por template, sem retry/duplicata, porque idempotência e resend funcional já tinham sido comprovados antes do julgamento visual.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Composto o IdentityModule no runtime real**
- **Found during:** Task 1, primeiro smoke Discord.
- **Issue:** a aplicação composta respondia 404 nas rotas OAuth embora o módulo isolado estivesse implementado.
- **Fix:** teste Fastify/Nest RED e composição do módulo com providers reais, sem duplicar RBAC ou enfraquecer guards/CSRF.
- **Verification:** rotas start/callback registradas; testes globais, typecheck e build verdes.
- **Committed in:** `2401cc2`, `e45c597`

**2. [Rule 1 - Bug] Transferida a navegação OAuth para o browser**
- **Found during:** Task 1, clique real em “Continuar com Discord”.
- **Issue:** `fetch` com redirect manual recebia `opaqueredirect` cross-origin e deixava a página presa em `/entrar`.
- **Fix:** navegação POST via formulário, sem expor parâmetros OAuth no cliente.
- **Verification:** browser alcançou o consentimento Discord e retornou pela callback limpa.
- **Committed in:** `36037c0`, `55d9336`

**3. [Rule 2 - Security] Allowlist CSP exata para o destino do formulário Discord**
- **Found during:** Task 1, navegação real bloqueada pelo `form-action`.
- **Issue:** o redirect final do POST era negado pela CSP.
- **Fix:** somente `https://discord.com` foi acrescentado ao `form-action`; nenhuma origem ampla foi liberada.
- **Verification:** header testado e fluxo browser concluído.
- **Committed in:** `2090a55`, `c8816bd`

**4. [Rule 1 - Bug] Corrigido o contrato de payload OTP entre API e worker**
- **Found during:** Task 3, smoke real de entrega.
- **Issue:** o envelope produzido pela API divergia do schema consumido pelo template/worker.
- **Fix:** contrato único com `recipient`, `code` e `expiresAt`, preservando cifra e cleanup.
- **Verification:** testes RED/GREEN e entrega real aprovada.
- **Committed in:** `f06523e`, `16ce488`

**5. [Rule 2 - Missing Critical] Elevado o acabamento visual de e-mail à definição de pronto**
- **Found during:** Task 3, inspeção humana da primeira rodada entregue.
- **Issue:** a funcionalidade estava correta, mas o visual foi rejeitado como genérico e incompatível com a ambição do produto.
- **Fix:** sistema DROP MANIFEST completo, previews extremos, mobile 320px sem overflow, contraste de segurança 4.82:1, wrapper MSO e finish review Impeccable PASS.
- **Verification:** 26/26 testes worker, lint/typecheck/build, screenshots desktop/mobile e aprovação humana de três e-mails reais.
- **Committed in:** `ba2f5ab`, `bf1acc7`, `7f98dfe`, `fa3554f`, `63f1cf4`

---

**Total deviations:** 5 auto-fixed (2 bugs, 2 blocking/security, 1 missing critical). **Impact:** todas foram necessárias para provar o fluxo externo real com segurança e qualidade visual; não houve mudança da arquitetura de autenticação ou do modelo de autorização.

## Authentication and External Gates

- Discord exigiu criação/configuração manual do app sandbox e consentimento humano; scopes `identify`/`email` foram aprovados.
- NVDA 2026.1.1 foi instalado/ativado e o usuário aprovou o fluxo crítico assistivo.
- A chave Resend inicialmente usada no smoke foi rotacionada depois que um diagnóstico de shell a ecoou; a chave antiga foi revogada e a nova chave Sending Access permaneceu no Environment User sem ser persistida no repositório.
- Nenhuma credencial, code, token, cookie ou recipient real foi incluído neste resumo, nos commits ou nos previews.

## Issues Encountered

- A primeira rodada de e-mails provou entrega/idempotência, mas foi rejeitada visualmente; o gate permaneceu fechado até o redesign e a segunda aprovação humana.
- Três jobs preparados enquanto o worker ainda mantinha a chave Resend revogada em memória receberam zero acknowledgement e `validation_error`; os payloads foram apagados e os jobs removidos antes da rodada efetiva.
- No fim do checkpoint, os serviços locais e o quick tunnel já estavam encerrados. A rodada visual efetiva usou o mesmo processor/adaptador de produção diretamente contra a branch Neon sandbox, sem retry e sem persistir connection string.

## Known Stubs

None. Os previews usam somente domínios `.invalid` por segurança e não alimentam runtime; todos os fluxos de produção validados usam repositories, processor e adapters reais.

## Threat Flags

None. As correções mantêm os trust boundaries planejados e não introduzem endpoint, schema ou permissão nova.

## Final Verification

- Discord OAuth/PKCE real: aprovado pelo usuário.
- Acessibilidade assistiva com NVDA/teclado/zoom/contraste/motion: aprovada pelo usuário.
- Resend/TLS e visual DROP MANIFEST: aprovados pelo usuário.
- Rodada final Resend: 3 delivered, 3 provider acknowledgements, 0 pending, 0 failed, 3 payloads cleared.
- API: 148 testes passados, 6 skips condicionais.
- Worker: 26/26 testes passados.
- TypeScript global: sem erros.
- Dependency boundaries: 244 módulos e 571 dependências, sem violações.
- Secret scan: 337 arquivos, PASS.
- Diff check: PASS.
- Cleanup: branch Neon temporária excluída; zero listeners/processos locais do sandbox; credenciais User preservadas.

## User Setup Required

None. As credenciais atuais de Discord e Resend já permanecem configuradas no Environment User; nenhuma nova ação é necessária para encerrar a fase.

## Next Phase Readiness

- A Fase 2 está completa em 24/24 planos e libera oficialmente a Fase 2.1 — Direção visual e sistema de experiência Impeccable.
- `DESIGN.md`, o manifesto DROP MANIFEST, a decisão Impeccable e o todo transversal oferecem o contrato inicial para redesenhar autenticação, onboarding, shell e futuras superfícies.
- O único bloqueador global permanece o smoke Docker local; ele não bloqueia a Fase 2.1 porque Compose e CI remoto já passaram.

## Self-Check: PASSED

- SUMMARY, DESIGN, templates e navegação OAuth foram confirmados no disco.
- Os 14 commits de runtime, TDD, design e roadmap foram confirmados no histórico, incluindo `63f1cf4` e `7350831`.
- O GSD reconhece 24 plans, 24 summaries e zero planos incompletos na Fase 2.
- STATE aponta para a Fase 2.1; ROADMAP registra 24/24; REQUIREMENTS contém as cinco evidências do plano.
- Secret scan final passou em 338 arquivos e `git diff --check` permaneceu verde.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
