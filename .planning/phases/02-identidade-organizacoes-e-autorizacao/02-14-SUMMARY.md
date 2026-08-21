---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 14
subsystem: ui
tags: [nextjs, react, rbac, csrf, step-up, audit, accessibility]

requires:
  - phase: 02-13
    provides: área privada, shell explícito por organização e telas de conta
  - phase: 02-09
    provides: APIs tenant-aware de membros, convites e auditoria
  - phase: 02-16
    provides: guards globais, CSRF e capabilities autoritativas
provides:
  - central responsiva de membros com papéis globais e cargos escopados
  - confirmação sensível com motivo e step-up Discord/e-mail
  - convites ativos/históricos com mutações confirmadas e sem token persistido
  - auditoria redigida com visibilidade própria, filtros em URL e paginação explícita
affects: [phase-03-campeonatos, platform-shell, organization-operations, audit-ui]

tech-stack:
  added: []
  patterns:
    - Server Components carregam projeções reais; ilhas cliente cuidam somente das interações
    - mutações sensíveis passam pelo BFF com CSRF e recarregam dados autoritativos após confirmação
    - componentes recebem capabilities prontas e não mantêm matriz RBAC local

key-files:
  created:
    - apps/web/src/components/authorization/scope-role-editor.tsx
    - apps/web/src/components/authorization/confirm-sensitive-action-dialog.tsx
    - apps/web/src/components/organizations/member-list.tsx
    - apps/web/src/components/organizations/invitation-list.tsx
    - apps/web/src/components/audit/audit-event.tsx
    - apps/web/src/app/(platform)/o/[slug]/membros/page.tsx
    - apps/web/src/app/(platform)/o/[slug]/convites/page.tsx
    - apps/web/src/app/(platform)/o/[slug]/auditoria/page.tsx
  modified:
    - apps/web/src/components/organizations/organization-management.spec.tsx
    - apps/web/src/app/globals.css

key-decisions:
  - "A UI decide somente pela presença de capabilities/projeções entregues pelo servidor; papéis não viram uma segunda matriz RBAC no navegador."
  - "Mudanças de papel, revogação e ownership preservam o formulário no step-up e só atualizam a tela após resposta autoritativa."
  - "A visibilidade de auditoria vem da resposta da API; filtros do cliente nunca ampliam a visão self para all."

patterns-established:
  - "Sensitive mutation: motivo -> step-up Discord/e-mail -> POST/PATCH BFF+CSRF -> reload autoritativo."
  - "Operational tables: grade densa no desktop e cards completos abaixo de 768px."

requirements-completed: [AUTH-004, AUTH-005, ORG-002, ORG-003, ORG-004, ORG-005, AUD-001, NFR-005]

duration: 18min
completed: 2026-08-21
---

# Phase 2 Plan 14: Central operacional de organização Summary

**Central operacional responsiva para membros, convites e auditoria com step-up real, CSRF, capacidades autoritativas e nenhuma atualização otimista sensível.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-21T09:40:00Z
- **Completed:** 2026-08-21T09:57:40Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Entregou membros desktop/mobile com owner único protegido, papel global separado de cargos por campeonato e capacidades resultantes em linguagem humana.
- Implementou dialogs sensíveis com motivo obrigatório, step-up Discord ou OTP por e-mail, bloqueio de submit duplicado e refresh somente depois da confirmação do servidor.
- Entregou convites ativos/históricos, criação/revogação/reenvio via BFF+CSRF e ausência de token/link persistido na tela.
- Entregou auditoria redigida com before/after traduzido, visão “Minhas ações”, filtros preservados na URL e paginação explícita.

## Task Commits

1. **Task 1 RED: membros e step-up** - `61425d2` (test)
2. **Task 1 GREEN: operações seguras de membros** - `3d67de3` (feat)
3. **Task 2 RED: convites e auditoria** - `98cd34d` (test)
4. **Task 2 GREEN: convites e auditoria redigida** - `be0cb79` (feat)
5. **Build contract correction** - `e746d57` (fix)
6. **Authoritative refresh correction** - `b804d33` (fix)

## Files Created/Modified

- `apps/web/src/components/authorization/scope-role-editor.tsx` - separa papéis globais, atribuições por campeonato e capacidades fornecidas pelo servidor.
- `apps/web/src/components/authorization/confirm-sensitive-action-dialog.tsx` - preserva motivo e executa step-up Discord/OTP antes do commit.
- `apps/web/src/components/organizations/member-list.tsx` - membros responsivos, owner protegido, revogação e transferência sem estado otimista.
- `apps/web/src/components/organizations/invitation-list.tsx` - tabs de ativos/histórico e ações confirmadas via CSRF.
- `apps/web/src/components/audit/audit-event.tsx` - timeline, filtros, paginação e mudanças redigidas.
- `apps/web/src/app/(platform)/o/[slug]/{membros,convites,auditoria}/page.tsx` - rotas Server Component com dados reais e estados seguros cross-org.
- `apps/web/src/components/organizations/organization-management.spec.tsx` - 11 testes de interação, teclado, step-up, segredo e visibilidade.
- `apps/web/src/app/globals.css` - tabelas/cards/timeline responsivos até 320px e estilos operacionais.

## Decisions Made

- O endpoint de convites protegido funciona como projeção autoritativa de capacidade gerencial na página de membros; nenhuma role é transformada em permissão no componente.
- Recarregamento completo é o fallback de produção após mutações para invalidar simultaneamente membership, capabilities, shell e menus.
- Auditoria self mantém o filtro de ator fora da UI e o backend continua resolvendo a visibilidade efetiva em cada request.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrigido tipo de visibilidade inexistente no build Next**
- **Found during:** gate de build após Task 2
- **Issue:** o contrato exporta a visibilidade pela página auditada, não como tipo isolado.
- **Fix:** derivada a visibilidade de `AuditEventPage["visibility"]`.
- **Files modified:** `apps/web/src/components/audit/audit-event.tsx`
- **Verification:** build web e build global verdes.
- **Committed in:** `e746d57`

**2. [Rule 2 - Missing Critical] Adicionado refresh autoritativo no caminho real**
- **Found during:** revisão React/segurança final
- **Issue:** sem callback de teste injetado, uma mutação confirmada poderia fechar o dialog mantendo shell/capabilities antigos.
- **Fix:** recarga Server Component após sucesso para membros, convites, sidebar e menus refletirem a autoridade atual.
- **Files modified:** `member-list.tsx`, `invitation-list.tsx`
- **Verification:** 58 testes web e build de produção verdes.
- **Committed in:** `b804d33`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 funcionalidade crítica ausente).
**Impact on plan:** correções necessárias para compilação e consistência de autorização, sem ampliar o domínio.

## Issues Encountered

- O gate legado `verify.diff-check` não existe na versão instalada do GSD; o escopo foi conferido manualmente por `git diff --name-only d2b4e33..HEAD` e contém somente os dez arquivos do plano/estilos necessários.
- O build global concluiu 13/13 tarefas; manteve apenas o aviso Windows conhecido de caminho longo do standalone Next/AWS SDK.

## Known Stubs

- `apps/web/src/app/(platform)/o/[slug]/membros/page.tsx`: `scopes={[]}` é intencional nesta fase. O domínio de campeonatos ainda não existe; a UI mostra a copy aprovada e não cria escopo fictício. A fase de campeonatos conectará a projeção real.

## Verification

- `pnpm --filter @pubg-camp/web test`: 6 arquivos, 58 testes verdes.
- `pnpm --filter @pubg-camp/web lint`: verde, sem diagnósticos.
- `pnpm --filter @pubg-camp/web build`: verde; três rotas dinâmicas geradas.
- `pnpm test`: 22/22 tarefas globais verdes.
- `pnpm build`: 13/13 tarefas globais verdes.
- `pnpm lint:boundaries`: 225 módulos e 513 dependências, sem violações.
- `pnpm verify:secrets`: 298 arquivos, nenhum segredo.
- `verify.key-links`: 1/1 ligação `scope-role-editor` → BFF members confirmada.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- As operações de organização estão prontas para o harness E2E/abuso do plano 02-18.
- A projeção de scopes reais deve ser conectada quando o domínio de campeonatos for introduzido; até lá o estado vazio é deliberado e seguro.

## Self-Check: PASSED

- Todos os oito arquivos principais existem.
- Os seis commits 02-14 estão presentes no histórico.
- Suítes focal, web e global, build, boundaries, segredo e key-link passaram.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
