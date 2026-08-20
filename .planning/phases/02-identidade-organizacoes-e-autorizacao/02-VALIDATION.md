---
phase: 02
slug: identidade-organizacoes-e-autorizacao
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-20
---

# Fase 02 — Estratégia de validação

> Contrato de validação da fase para manter feedback rápido e provar controles de identidade, isolamento multi-tenant e concorrência.

## Infraestrutura de testes

| Propriedade | Valor |
|---|---|
| **Framework** | Vitest 4.1.11 |
| **Configuração** | Configurações existentes por workspace; Wave 0 adicionará setup de integração PostgreSQL/Redis |
| **Comando rápido** | `pnpm --filter @pubg-camp/api test` |
| **Suite completa** | `pnpm ci:verify` mais integração PostgreSQL/Redis da fase |
| **Runtime estimado** | até 30 segundos para alvo unitário; integração completa medida na Wave 0 |

## Frequência de amostragem

- **Após cada commit de tarefa:** executar o teste filtrado do módulo alterado.
- **Após cada wave:** executar testes unitários e integração PostgreSQL/Redis da fase.
- **Antes de `$gsd-verify-work`:** `pnpm ci:verify`, migrações do zero e suites de abuso/concorrência devem estar verdes.
- **Latência máxima desejada:** 30 segundos para feedback unitário por tarefa.

## Mapa de verificação por requisito

| Grupo provisório | Requisitos | Ameaças | Comportamento seguro | Tipo | Comando automatizado | Arquivo |
|---|---|---|---|---|---|---|
| OAuth Discord | AUTH-001, AUTH-006 | OAuth CSRF, token leak | `state` one-use, callback vinculado ao browser e nenhum token no cliente/log | unit + API integration | `pnpm --filter @pubg-camp/api test -- identity/oauth` | ❌ Wave 0 |
| OTP por e-mail | AUTH-002, NFR-005 | enumeração, brute force, mail bombing | resposta uniforme, HMAC, limites Redis, expiração e consumo único | unit + Redis integration | `pnpm --filter @pubg-camp/api test -- identity/otp` | ❌ Wave 0 |
| Sessões | AUTH-003 | fixation, replay, hijack | token opaco, digest, cookie seguro, rotação e revogação imediata | API + DB integration | `pnpm --filter @pubg-camp/api test -- identity/session` | ❌ Wave 0 |
| Multi-organização | AUTH-004, ORG-001 | confusão de tenant | criação atômica com owner e contexto organizacional explícito | DB + API integration | `pnpm --filter @pubg-camp/api test -- organizations` | ❌ Wave 0 |
| Autorização | AUTH-005, ORG-003, ORG-004 | BOLA, elevação de privilégio | default deny, escopo org/campeonato e união estrita de cargos | matriz unitária + API | `pnpm --filter @pubg-camp/authorization test` | ❌ Wave 0 |
| Convites | ORG-002 | encaminhamento, replay, corrida | e-mail vinculado, uso único, expiração em 7 dias e consumo atômico | DB/API + concorrência | `pnpm --filter @pubg-camp/api test -- organizations/invitation` | ❌ Wave 0 |
| Último proprietário | ORG-005 | takeover, perda de controle, corrida | lock/recheck transacional impede remoção sem transferência | PostgreSQL concorrente | `pnpm --filter @pubg-camp/database test -- last-owner.concurrent` | ❌ Wave 0 |
| Auditoria | AUD-001 | repúdio, adulteração | actor/data/motivo/before/after na mesma transação e visibilidade filtrada | DB + API integration | `pnpm --filter @pubg-camp/api test -- audit` | ❌ Wave 0 |
| Segurança web | NFR-005 | CSRF, input abusivo, segredo exposto | CSRF/Origin, Zod, rate limits, redaction e menor privilégio | security integration | `pnpm --filter @pubg-camp/api test -- security` | ❌ Wave 0 |

Os IDs de tarefa serão substituídos pelos IDs reais após a geração dos planos.

## Requisitos da Wave 0

- [ ] `packages/authorization/src/authorization.spec.ts` — matriz completa de papéis, permissões e default deny.
- [ ] `apps/api/src/identity/**/*.spec.ts` — fakes determinísticos de relógio, RNG, Discord, e-mail e limiter.
- [ ] `apps/api/test/security.integration.spec.ts` — cookies, CSRF, Origin, redaction e boundary de segredos.
- [ ] `packages/database/test/identity-organizations.integration.spec.ts` — migrações, transações, FKs e outbox.
- [ ] `packages/database/test/last-owner.concurrent.spec.ts` — duas conexões PostgreSQL reais.
- [ ] `packages/database/test/invitation.concurrent.spec.ts` — consumo concorrente do mesmo convite.
- [ ] Serviço PostgreSQL/Redis em CI para integração; Docker/psql/redis-cli não estão disponíveis no host atual.

## Verificações exclusivamente manuais

| Comportamento | Requisito | Motivo | Instruções |
|---|---|---|---|
| Redirect/callback e eventual PKCE Discord | AUTH-001 | exige aplicação e credenciais sandbox | entrar pelo Discord sandbox, validar redirect exato, callback, sessão e ausência de token no browser |
| Entrega real de código/aviso por e-mail | AUTH-002, AUTH-003 | exige domínio e chave do provedor | enviar para endereço de teste, verificar código/aviso, expiração, uso único e ausência de segredo em URLs/logs |
| Cookie `Secure` atrás do proxy TLS | AUTH-003, NFR-005 | depende do ingress real | acessar por HTTPS, inspecionar `__Host-` cookie e confirmar rejeição por HTTP/origem externa |

## Assinatura da validação

- [ ] Todas as tarefas possuem verificação automatizada ou dependência explícita da Wave 0.
- [ ] Não existem três tarefas consecutivas sem feedback automatizado.
- [ ] A Wave 0 cobre todas as referências ausentes.
- [ ] Nenhum comando usa watch mode.
- [ ] A latência real foi medida e registrada.
- [ ] `nyquist_compliant: true` definido após os planos e a Wave 0.

**Aprovação:** pendente da geração e checagem dos planos.

