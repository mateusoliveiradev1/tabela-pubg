---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 23
subsystem: web-ui-branding
tags: [nextjs, react, multipart, csrf, organization-logo, accessibility, signed-url]

requires:
  - phase: 02-12
    provides: fluxo de convite com remoção de token e preview opaco
  - phase: 02-13
    provides: shell autenticado e projeções de organização
  - phase: 02-22
    provides: multipart seguro, metadata autoritativa e URLs assinadas/fallback
provides:
  - campo de logo acessível e reutilizável com preview local e cleanup de object URL
  - tela capability-gated para atualização autoritativa do branding
  - branding seguro no convite com allowlist, no-referrer e fallback local
affects: [organizations-ui, invitation-preview, platform-shell, deployment-storage]

tech-stack:
  added: []
  patterns:
    - multipart same-origin com CSRF e atualização somente após resposta autoritativa
    - signed URL efêmera allowlisted sem persistência no cliente e fallback por iniciais

key-files:
  created:
    - apps/web/src/components/organizations/organization-logo-field.tsx
    - apps/web/src/components/organizations/organization-logo-field.spec.tsx
    - apps/web/src/app/(platform)/o/[slug]/configuracoes/page.tsx
  modified:
    - apps/web/src/components/organizations/create-organization-form.tsx
    - apps/web/src/components/identity/invitation-accept-form.tsx
    - apps/web/src/components/layout/app-shell.tsx

key-decisions:
  - "A seleção local serve apenas como feedback; shell, switcher e URL exibida mudam somente depois da resposta autoritativa."
  - "Logos de convite aceitam origem relativa ou origem configurada, usam no-referrer e caem para iniciais sem expor falha técnica."

patterns-established:
  - "Branding mutável: FormData via BFF + CSRF → resposta validada → refresh autoritativo."
  - "Branding público: remover contexto secreto → resolver preview → validar origem → montar imagem sem referrer."

requirements-completed: [ORG-001, ORG-002, NFR-005]

duration: 8min
completed: 2026-08-21
---

# Phase 2 Plan 23: Branding persistente e seguro na UI Summary

**Criação, configurações e convites agora usam logos persistentes com multipart protegido, preview acessível, confirmação autoritativa e fallback sem vazamento.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-21T10:04:05Z
- **Completed:** 2026-08-21T10:11:53Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Extraído um campo único de logo para criação e configurações, com PNG/JPEG/WebP até 2 MiB, teclado, drop, troca, remoção e revogação de cada object URL.
- Criada a rota `/o/{slug}/configuracoes`, visível e acessível apenas com `organization:settings:manage`, enviando somente multipart same-origin com CSRF.
- Erros locais e do servidor preservam nome/arquivo; sucesso usa somente `url` pública validada e recarrega shell/switcher após confirmação.
- Preview de convite monta logo apenas depois de remover o token e concluir a leitura opaca; falha, ausência ou origem não permitida usa iniciais locais.
- Página de convite aplica `Referrer-Policy: no-referrer` e estados expirado/revogado/usado/inválido não projetam branding da organização.

## Task Commits

1. **Task 1: Criar e editar logo com feedback acessível** — `9a10dc8` (RED), `f3655fe` (GREEN)
2. **Task 2: Renderizar logo seguro no preview de convite** — `2a48d0d` (RED), `5bbccfd` (GREEN)
3. **Build repair da Task 1** — `f0131de` (fix)

## Files Created/Modified

- `apps/web/src/components/organizations/organization-logo-field.tsx` — campo controlado e formulário de settings com upload autoritativo.
- `apps/web/src/components/organizations/organization-logo-field.spec.tsx` — teclado/drop, validação, cleanup, erro recuperável e capability gate.
- `apps/web/src/app/(platform)/o/[slug]/configuracoes/page.tsx` — Server Component protegido por organização/capability.
- `apps/web/src/components/organizations/create-organization-form.tsx` — reutiliza o campo e mantém multipart já aprovado.
- `apps/web/src/components/identity/invitation-accept-form.tsx` — logo allowlisted, no-referrer e fallback por iniciais.
- `apps/web/src/app/(auth)/convites/aceitar/page.tsx` — política de referrer da rota pública.
- `apps/web/src/components/layout/app-shell.tsx` — navegação de configurações derivada exclusivamente da capability.
- `.env.example` — allowlist pública explícita de origens de imagem para desenvolvimento/produção.

## Decisions Made

- O navegador nunca interpreta preview local como arquivo aprovado; tipo, bytes, autorização e metadata continuam sob autoridade da API do plano 02-22.
- A atualização do logo não é otimista: arquivo e nome permanecem editáveis no erro, enquanto a URL persistente e o shell mudam somente após `2xx` válido.
- URL absoluta de convite precisa ser HTTPS e pertencer a `NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS`; apenas localhost pode usar HTTP em desenvolvimento.
- A URL assinada permanece somente no estado do preview renderizado, sem local/session storage, logs ou serialização estática.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Ligado o DTO de convite ao componente real e à allowlist configurável**
- **Found during:** Task 2
- **Issue:** o plano listava apenas page/spec, mas o componente que recebe `logoUrl`, o estilo do fallback e a configuração de origens precisavam mudar para entregar o fluxo seguro.
- **Fix:** implementado branding em `invitation-accept-form.tsx`, estilos locais, metadata no-referrer e `NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS` documentada.
- **Files modified:** `invitation-accept-form.tsx`, `globals.css`, `page.tsx`, `.env.example`
- **Verification:** testes provam ausência de imagem antes do preview, fallback no erro e não projeção em estados terminais; secret scan passou.
- **Committed in:** `5bbccfd`

**2. [Rule 1 - Bug] Corrigidos imports da rota dinâmica e exact optional types**
- **Found during:** gate de build
- **Issue:** a primeira build detectou um nível excedente nos imports relativos e `error?: string` incompatível com `exactOptionalPropertyTypes` ao receber `undefined`.
- **Fix:** corrigidos os paths da settings page e explicitado o contrato opcional compatível.
- **Files modified:** `configuracoes/page.tsx`, `organization-logo-field.tsx`
- **Verification:** build web e build global passaram com a rota `/o/[slug]/configuracoes` dinâmica.
- **Committed in:** `f0131de`

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug). **Impact:** ambos foram necessários para segurança e build correto, sem novo storage, endpoint ou dependência.

## Issues Encountered

- O warning conhecido do Vite sobre futura carga nativa do config permanece sem efeito nos testes.
- O build global manteve o warning conhecido de path longo no standalone do AWS SDK no Windows, com exit code 0.

## Known Stubs

None. Valores nulos encontrados representam ausência real de logo/preview, não dados fictícios enviados à UI.

## Verification

- Task 1 TDD: RED por módulo ausente; GREEN com 4/4 specs de logo e 62/62 testes web do gate focal.
- Task 2 TDD: RED por branding ausente; GREEN com 12/12 specs de auth e 64/64 testes web completos.
- Teclado, file input rotulado, aria-live/role alert, fallback e object URL cleanup: PASS.
- Web lint, typecheck e build Next: PASS.
- Lint/typecheck global: PASS.
- Testes globais: 22/22 tarefas Turbo: PASS.
- Build global: 13/13 tarefas Turbo: PASS.
- Boundaries: 228 módulos/524 dependências sem violações.
- Secret scan: 302 arquivos: PASS.
- Diff check: PASS.
- Key-links: 2/2: PASS.

## Threat Flags

None. O upload multipart e a URL assinada pertencem aos trust boundaries já registrados em T-02-51/T-02-52; nenhuma nova superfície não planejada foi criada.

## User Setup Required

Definir `NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS` no build de produção com as origens HTTPS usadas pelo provider/CDN. O `.env.example` já contém os valores loopback de desenvolvimento; nenhum segredo é necessário.

## Next Phase Readiness

- Branding da organização está pronto para as verificações finais da Fase 2 e para reutilização nas superfícies públicas posteriores.
- Storage continua exclusivamente no port/adapters do plano 02-22; a UI não conhece bucket, provider ou object key.

## Self-Check: PASSED

- Três arquivos criados e sete modificados foram confirmados no diff.
- Cinco commits RED/GREEN/fix foram confirmados no histórico.
- Nenhuma deleção inesperada, credencial persistida ou stub bloqueante foi encontrada.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
