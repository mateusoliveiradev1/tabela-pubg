---
phase: 02
slug: identidade-organizacoes-e-autorizacao
status: validated-automated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-20
validated: 2026-08-23
---

# Fase 02 — Estratégia de validação

> Matriz fail-closed da cobertura automatizada. A disponibilidade inicial real e o gate CI final são evidências distintas; integrações externas e experiência assistiva continuam reservadas ao plano 02-15.

## Estado dos planos

| Plano | Evidência | Estado |
|---|---|---|
| 02-01 | `02-01-SUMMARY.md` | concluído |
| 02-02 | `02-02-SUMMARY.md` | concluído |
| 02-03 | `02-03-SUMMARY.md` | concluído |
| 02-04 | `02-04-SUMMARY.md` | concluído |
| 02-05 | `02-05-SUMMARY.md` | concluído |
| 02-06 | `02-06-SUMMARY.md` | concluído |
| 02-07 | `02-07-SUMMARY.md` | concluído |
| 02-08 | `02-08-SUMMARY.md` | concluído |
| 02-09 | `02-09-SUMMARY.md` | concluído |
| 02-10 | `02-10-SUMMARY.md` | concluído |
| 02-11 | `02-11-SUMMARY.md` | concluído |
| 02-12 | `02-12-SUMMARY.md` | concluído |
| 02-13 | `02-13-SUMMARY.md` | concluído |
| 02-14 | `02-14-SUMMARY.md` | concluído |
| 02-15 | `02-15-PLAN.md` | manual pendente; não possui SUMMARY |
| 02-16 | `02-16-SUMMARY.md` | concluído |
| 02-17 | `02-17-SUMMARY.md` | concluído; gate inicial real |
| 02-18 | `02-18-SUMMARY.md` | concluído; harness E2E |
| 02-19 | `02-19-SUMMARY.md` | concluído |
| 02-20 | `02-20-PLAN.md` | validador atual; flags só após promoção |
| 02-21 | `02-21-SUMMARY.md` | concluído |
| 02-22 | `02-22-SUMMARY.md` | concluído |
| 02-23 | `02-23-SUMMARY.md` | concluído |
| 02-24 | `02-24-SUMMARY.md` | concluído; gate CI final |

## Cobertura por requisito

| Requisito | Cobertura automatizada principal |
|---|---|
| AUTH-001 | OAuth state/PKCE, adapter HTTP, BFF e smoke Chromium |
| AUTH-002 | OTP HMAC, limiter Redis, worker e fluxo Chromium |
| AUTH-003 | sessão opaca, rotação, revogação e CSRF |
| AUTH-004 | onboarding e seleção explícita de organização |
| AUTH-005 | RBAC default-deny com contexto explícito |
| AUTH-006 | redaction, BFF e secret scan |
| ORG-001 | criação transacional e múltiplas organizações |
| ORG-002 | convite one-use e concorrência real |
| ORG-003 | roles globais owner/admin/member |
| ORG-004 | união estrita de cargos operacionais |
| ORG-005 | lock/recheck do último proprietário |
| AUD-001 | auditoria transacional e visibilidade filtrada |
| NFR-005 | CSRF, limits, validação, redaction, PostgreSQL/Redis e browser |

## Decisões D-01–D-17

| Decisão | Planos que provam o contrato |
|---|---|
| D-01 | 02-06, 02-07, 02-12 |
| D-02 | 02-02, 02-06, 02-12 |
| D-03 | 02-04, 02-06, 02-13 |
| D-04 | 02-09, 02-13 |
| D-05 | 02-03, 02-04, 02-06, 02-13 |
| D-06 | 02-03, 02-04, 02-06 |
| D-07 | 02-04, 02-06, 02-08, 02-13, 02-16 |
| D-08 | 02-04, 02-06, 02-09, 02-13, 02-14 |
| D-09 | 02-03, 02-05, 02-09 |
| D-10 | 02-05, 02-08, 02-09, 02-14 |
| D-11 | 02-05, 02-09, 02-12 |
| D-12 | 02-01, 02-05, 02-09, 02-14 |
| D-13 | 02-01, 02-09, 02-14 |
| D-14 | 02-01, 02-09, 02-14 |
| D-15 | 02-01, 02-09, 02-16 |
| D-16 | 02-06, 02-09, 02-14 |
| D-17 | 02-05, 02-09, 02-14 |

## Matriz de comandos e arquivos

Todos os comandos são one-shot, começam por RTK e resolvem scripts/arquivos existentes.

| Grupo | Comando automatizado | Arquivo principal |
|---|---|---|
| Autorização | `rtk pnpm --filter @pubg-camp/authorization test` | `packages/authorization/src/authorization.spec.ts` |
| OAuth | `rtk pnpm --filter @pubg-camp/api test -- identity/oauth` | `apps/api/src/identity/identity.service.spec.ts` |
| OTP | `rtk pnpm --filter @pubg-camp/api test -- identity/otp` | `apps/api/src/identity/identity.service.spec.ts` |
| Sessões | `rtk pnpm --filter @pubg-camp/api test -- identity/session` | `apps/api/src/identity/identity.service.spec.ts` |
| Organizações | `rtk pnpm --filter @pubg-camp/api test -- organizations` | `packages/database/test/identity-organizations.integration.spec.ts` |
| Auditoria | `rtk pnpm --filter @pubg-camp/api test -- audit` | `apps/api/test/security.integration.spec.ts` |
| Segurança | `rtk pnpm --filter @pubg-camp/api test -- security` | `apps/api/test/security.integration.spec.ts` |
| Último owner | `rtk pnpm --filter @pubg-camp/database test -- last-owner.concurrent` | `packages/database/test/last-owner.concurrent.spec.ts` |
| Convite concorrente | `rtk pnpm --filter @pubg-camp/database test -- invitation.concurrent` | `packages/database/test/invitation.concurrent.spec.ts` |
| Preflight real | `rtk pnpm phase2:integration:preflight` | `scripts/run-phase2-integration.mjs` |
| Integração real | `rtk pnpm phase2:integration` | `scripts/run-phase2-integration.mjs` |
| Concorrência real | `rtk pnpm phase2:concurrent` | `scripts/run-phase2-integration.mjs` |
| Smoke Chromium | `rtk pnpm --filter @pubg-camp/web test:e2e:smoke` | `scripts/run-phase2-e2e.mjs` |
| E2E completo | `rtk pnpm --filter @pubg-camp/web test:e2e` | `apps/web/e2e/phase2-accessibility.spec.ts` |
| Segredos | `rtk pnpm verify:secrets` | `scripts/validate-phase2-validation.mjs` |
| Boundaries | `rtk pnpm lint:boundaries` | `.github/workflows/ci.yml` |
| Testes globais | `rtk pnpm test` | `.github/workflows/ci.yml` |
| Build global | `rtk pnpm build` | `.github/workflows/ci.yml` |
| Validador final | `rtk node scripts/validate-phase2-validation.mjs --check .planning/phases/02-identidade-organizacoes-e-autorizacao/02-VALIDATION.md` | `scripts/validate-phase2-validation.mjs` |

## Evidências automatizadas distintas

| Gate | Fonte imutável | Resultado |
|---|---|---|
| Disponibilidade inicial 02-17 | `.planning/phases/02-identidade-organizacoes-e-autorizacao/02-17-SUMMARY.md` | PostgreSQL Neon isolado + Redis loopback + migrations desde schema vazio; preflight exit code 0 |
| CI final 02-24 | `.planning/phases/02-identidade-organizacoes-e-autorizacao/02-24-SUMMARY.md` | run `32676449341`, event push, HEAD autorizado, 8/8 jobs success |

O gate inicial 02-17 comprova disponibilidade real local e não substitui a CI. O gate 02-24 comprova separadamente o run https://github.com/mateusoliveiradev1/tabela-pubg/actions/runs/32676449341, com integration + concurrent + smoke + E2E completo e nenhuma suíte obrigatória skipped. Falha, conclusão ausente, job obrigatório skipped ou evidência ambígua bloqueia as flags.

## Runtimes medidos

| Execução | Resultado registrado |
|---|---|
| Preflight 02-17 | 8 min para provisionamento/validação; runner concluiu com exit code 0 |
| Harness E2E 02-18 | 34 min de implementação e gates locais; smoke 2/2 |
| CI final 02-24 | run `32676449341` attempt 1, 8/8 jobs success; 2 smoke e 32 cenários completos (26 passados, 6 condicionais não obrigatórios) |
| Gate global local 02-24 | testes 22/22, build 13/13, secret scan 313 arquivos e boundaries 237 módulos/539 dependências |

## Checkpoints exclusivamente manuais

| ID | Plano/tarefa | Escopo | Estado |
|---|---|---|---|
| MANUAL-01 | 02-15 / Task 1 | Discord/PKCE sandbox | pendente |
| MANUAL-02 | 02-15 / Task 2 | acessibilidade assistiva | pendente |
| MANUAL-03 | 02-15 / Task 3 | Resend/TLS | pendente |

Nyquist automatizado não aprova os checkpoints manuais do plano 02-15.

## Assinatura automatizada

- Todos os IDs 02-01–02-24, requirements, decisões, arquivos e comandos foram resolvidos.
- A cópia candidata deve passar com as duas flags falsas.
- Somente o modo de promoção do validador pode aplicar as duas flags; ele valida o conteúdo promovido antes do rename atômico e revalida o arquivo final.
- Checkpoints Discord, acessibilidade assistiva e Resend/TLS permanecem pendentes para o plano 02-15.

**Aprovação automatizada:** candidata pronta para promoção fail-closed.
