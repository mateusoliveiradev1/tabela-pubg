---
phase: 02-identidade-organizacoes-e-autorizacao
verified: 2026-08-24T05:23:54Z
status: gaps_found
score: 2/6 must-haves verified
requirements_score: 6/13 requirements verified
overrides_applied: 0
gaps:
  - truth: "A alternativa por e-mail autentica e o step-up persiste na sessão atual"
    status: failed
    reason: "O OTP válido é consumido, mas o fluxo devolve apenas um status; não cria identidade/sessão no sign-in nem chama confirmStepUp no propósito step-up."
    artifacts:
      - path: "apps/api/src/identity/otp.service.ts"
        issue: "verify() encerra em authenticated/step-up-confirmed sem um caso de uso autenticado persistente."
      - path: "apps/api/src/identity/identity.controller.ts"
        issue: "O controller responde authenticated e engole a ausência da sessão; step-up não recebe actor/session nem persiste reauthenticated_at."
    missing:
      - "Vincular challenges não-sign-in a actorId/sessionId e validar esse vínculo no consumo."
      - "Criar/resolver a identidade de e-mail e emitir cookie de sessão no sign-in."
      - "Chamar SessionService.confirmStepUp para a sessão autenticada antes de rotacionar CSRF."
  - truth: "Outbox transacional entrega OTP, convite, alerta de dispositivo e limpeza ao worker"
    status: failed
    reason: "As mutações gravam outbox_events pending, mas nenhum código de produção reivindica esses registros, publica nas filas BullMQ ou marca o evento como publicado."
    artifacts:
      - path: "packages/database/src/outbox.ts"
        issue: "Implementa somente append de eventos pending."
      - path: "apps/worker/src/main.ts"
        issue: "Inicializa apenas consumidores de outbox-delivery e storage-logo-cleanup; não há publisher."
    missing:
      - "Publisher durável que claim/retry/publica eventos pending e usa outbox id como jobId."
      - "Integração PostgreSQL -> Redis/BullMQ -> processor -> estado published/cleared."
  - truth: "OAuth autenticado de vínculo e step-up é alcançável e usa prova durável vinculada à sessão"
    status: failed
    reason: "IdentityController é público no nível da classe e startDiscord não encaminha actor/session; OAuthService rejeita link-identity e step-up. currentMethodConfirmed não existe no schema/repositório e é descartado na projeção runtime."
    artifacts:
      - path: "apps/api/src/identity/identity.controller.ts"
        issue: "startDiscord fornece apenas purpose/browserBinding/returnPath."
      - path: "packages/database/src/repositories/identity.ts"
        issue: "CreateOAuthTransactionInput e persistência omitem currentMethodConfirmed."
      - path: "apps/api/src/identity/identity.runtime.ts"
        issue: "consume() não projeta currentMethodConfirmed."
    missing:
      - "Separar endpoints públicos e protegidos e derivar actor/session exclusivamente de request.auth."
      - "Persistir e consumir prova durável vinculada a actor/session para o método atual."
  - truth: "Sessões opacas emitidas são resolvíveis, revogáveis e gerenciáveis pelos endpoints publicados"
    status: failed
    reason: "O adapter de device session ignora o token recebido e o repositório gera outro; além disso, as rotas de sessões e identidades presentes no BFF/UI não existem em controllers Nest."
    artifacts:
      - path: "apps/api/src/identity/session.service.ts"
        issue: "startDeviceSession retorna o token gerado pelo serviço."
      - path: "apps/api/src/identity/identity.runtime.ts"
        issue: "issueForDevice ignora input.token e também descarta issued.token."
      - path: "apps/api/src/identity/identity.module.ts"
        issue: "Registra apenas IdentityController e SessionAlertContextController."
    missing:
      - "Uma única origem de token e teste de contrato que resolve o token retornado contra a linha persistida."
      - "Controllers protegidos para list/revoke/revoke-others/logout de sessões e list/link/remove de identidades."
      - "Teste de inventário BFF -> rotas Nest reais."
  - truth: "Usuários autorizados conseguem operar sua organização enquanto acessos entre tenants são negados e auditados"
    status: failed
    reason: "O PermissionGuard exige x-organization-id, mas o BFF não deriva nem encaminha esse contexto; mutações autorizadas falham com 403. A negação do guard também não grava evento de auditoria."
    artifacts:
      - path: "apps/web/src/app/api/platform/[...path]/route.ts"
        issue: "A allowlist e a montagem upstream não definem x-organization-id a partir da rota validada."
      - path: "apps/api/src/authorization/permission.guard.ts"
        issue: "Exige o header de tenant e lança ForbiddenException sem registro de negação."
    missing:
      - "Derivar tenant/scope server-side do path/contrato validado e definir headers internos no BFF."
      - "Testes BFF -> Nest para same-tenant permitido e cross-tenant negado."
      - "Auditoria estruturada de tentativas cross-tenant negadas conforme critério do ROADMAP."
  - truth: "Sessões e recursos visuais preservam as garantias de segurança declaradas"
    status: failed
    reason: "A autenticação não usa touchSession, a confiança provisional não é persistida/aplicada, falha de revogação Discord pode mascarar commit local, e a CSP bloqueia as URLs assinadas externas de logo."
    artifacts:
      - path: "apps/api/src/main.ts"
        issue: "authenticate usa resolveSession, não touchSession, e retorna actor/session sem trust."
      - path: "packages/database/src/schema/identity.ts"
        issue: "sessions não possui estado de trust."
      - path: "apps/api/src/identity/oauth.service.ts"
        issue: "revoke no finally pode substituir o resultado após mutação local confirmada."
      - path: "apps/web/next.config.ts"
        issue: "img-src restringe a self/data/blob apesar de logos externos configuráveis."
    missing:
      - "Resolve-and-touch no autenticador com coalescing e limite absoluto."
      - "Persistir trust e limitar sessões provisionais a onboarding explícito."
      - "Ordenar ou tornar durável a revogação do token Discord sem resposta enganosa pós-commit."
      - "Adicionar à CSP apenas origens de logo validadas e HTTPS em produção."
deferred:
  - truth: "AUTH-004 inclui participação em vários campeonatos além de várias organizações"
    addressed_in: "Phase 3"
    evidence: "A Fase 3 cria campeonato, participantes e escopos; a Fase 2 já entrega memberships multi-organização e assignments scope-ready."
---

# Phase 2: Identidade, organizações e autorização — Verification Report

**Phase Goal:** usuários entram com segurança e colaboram sem compartilhar credenciais.
**Verified:** 2026-08-24T05:23:54Z
**Status:** gaps_found
**Re-verification:** No — initial verification
**HEAD verificado:** `f30bd695e9dbd998e44f2db1babd44f4246c8fa1`

## Verdict

A fase não atingiu a meta. O login Discord real, a matriz de menor privilégio, o isolamento no domínio, a proteção do último owner e a auditoria transacional existem. Porém, os caminhos de produção que transformariam essas peças em colaboração utilizável estão desconectados: e-mails não saem do outbox, OTP não autentica, OAuth de vínculo/step-up não inicia, um caminho de sessão devolve token não persistido, o BFF não fornece contexto de tenant e várias rotas consumidas pela UI não existem no Nest.

As evidências humanas fornecidas foram aceitas: callback/sessão Discord com PKCE; NVDA/teclado/zoom/contraste/reduced-motion; e entregas/visuais de OTP, convite e novo dispositivo pelo Resend. Elas validam o provider, a experiência e os templates, mas não substituem as conexões runtime ausentes entre mutação, outbox, fila, controller, sessão e guard.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---:|---|---|---|
| 1 | Usuário entra via Discord OAuth2/PKCE e recebe sessão opaca sem token do provider no payload público. | ✓ VERIFIED | Evidência humana aprovada; `DiscordOAuthAdapter` faz Authorization Code + PKCE e `OAuthService` usa `IdentityService.signInWithDiscord`; controller entrega cookie via CSRF service e DTO público omite tokens. |
| 2 | Usuário entra alternativamente por e-mail e step-up por e-mail habilita mutações sensíveis. | ✗ FAILED | `OtpService.verify` apenas retorna status; `IdentityController.verifyEmailOtp` não emite sessão nem chama `confirmStepUp`. |
| 3 | Cada função completa somente as ações autorizadas. | ✗ FAILED | Matriz unitária está correta (14/14), mas o BFF não fornece `x-organization-id`; inclusive ações same-tenant autorizadas chegam ao guard sem contexto e falham. |
| 4 | Tentativas entre organizações são negadas e registradas. | ✗ FAILED | `can()` e guard negam contexto divergente, mas não existe writer/log de auditoria na negação do guard. |
| 5 | Revogação encerra somente o acesso-alvo e preserva outros membros/sessões. | ✗ FAILED | Repositórios implementam isolamento e proteção concorrente, mas a UI não alcança as mutações de tenant e os endpoints reais de sessão/revogação estão ausentes. |
| 6 | Segredos de provider e tokens opacos não aparecem em DOM, URLs de retorno, JSON público ou logs persistidos. | ✓ VERIFIED | Contratos públicos, BFF, envelopes AES-GCM e redaction preservam o limite; OAuth usa token Discord apenas server-side. |

**Must-have score:** 2/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/authorization/src/index.ts` | Matriz completa default-deny por org/scope | ✓ VERIFIED | Substantivo; importado pelo `AuthorizationService`; 14 testes unitários passaram. |
| `apps/api/src/authorization/permission.guard.ts` | Guard global com tenant/scope | ⚠ PARTIAL | Substantivo e registrado globalmente, mas depende de headers que o BFF real não deriva. |
| `apps/api/src/identity/identity.controller.ts` | Entradas OAuth/OTP e gestão de sessão/identidade | ✗ INCOMPLETE | OAuth sign-in existe; OTP é status-only e controllers de gestão estão ausentes. |
| `apps/api/src/identity/identity.runtime.ts` | Composição DB/Redis/provider/session | ✗ INCOMPLETE | Runtime é inicializado em produção, mas descarta prova OAuth e token persistido de device session. |
| `packages/database/src/repositories/sessions.ts` | Sessões opacas, expiração, revogação e step-up | ⚠ PARTIAL | Repositório é substantivo; `touchSession` não é usado pela autenticação e o adapter de device não preserva o token. |
| `packages/database/src/outbox.ts` | Outbox transacional confiável | ⚠ ORPHANED | Eventos são gravados como pending; não há claim/publish/mark em produção. |
| `apps/worker/src/main.ts` | Publicação e consumo dos eventos | ✗ INCOMPLETE | Há consumers, mas não publisher do outbox. |
| `packages/database/src/repositories/organizations.ts` | Organizações, convites, membros, último owner e atomicidade | ✓ VERIFIED | Lógica tenant-scoped, locks, audit e outbox são substantivos e testados; a entrega HTTP/BFF continua quebrada. |
| `packages/database/src/repositories/audit.ts` | Autor/data/motivo/before/after | ✓ VERIFIED | Writer sanitiza snapshots e grava os campos obrigatórios dentro das transações de mutação. |
| `apps/web/src/app/api/platform/[...path]/route.ts` | BFF estrito conectado ao Nest | ✗ INCOMPLETE | Allowlist é restrita, porém falta tenant derivado e há rotas sem correspondente Nest. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Discord callback | Identity/session repository | `OAuthService.completeCallback` | ✓ WIRED | Sign-in chama identidade e emite token persistido; evidência Discord/PKCE real foi aprovada. |
| OTP verify | Identity/session/step-up persistence | purpose-specific use case | ✗ NOT WIRED | O fluxo termina em status no service/controller. |
| Organization/notification mutation | `outbox_events` | mesma transação DB | ✓ WIRED | Repositórios inserem audit/outbox junto da mutação. |
| `outbox_events` | BullMQ queues | publisher claim/enqueue/mark | ✗ NOT WIRED | Nenhum publisher encontrado; worker só registra consumers. |
| OAuth link/step-up start | sessão autenticada | `request.auth` + transação durável | ✗ NOT WIRED | Endpoint público não fornece actor/session e prova atual não é persistida. |
| `SessionService.startDeviceSession` | sessão persistida | mesmo token opaco | ✗ NOT WIRED | O adapter ignora `input.token`; repository gera outro e `issued.token` é descartado. |
| Web organization mutations | Nest `PermissionGuard` | contexto tenant derivado no BFF | ✗ NOT WIRED | Falta `x-organization-id` interno. |
| Web session/identity management | Nest controllers | BFF allowlist + controller route | ✗ NOT WIRED | BFF/UI publicam endpoints que nenhum controller registra. |
| Session cookie | sliding expiry/trust enforcement | production authenticator | ⚠ PARTIAL | Resolve sessão, mas não toca idle expiry e não carrega trust. |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|---|---|---|---|---|
| Email worker | `deliveryId` | DB delivery -> outbox -> BullMQ | DB cria delivery real, mas outbox não publica | ✗ DISCONNECTED |
| OTP sign-in | challenge consumido | PostgreSQL challenge | Challenge é real; identidade/sessão não recebe o resultado | ✗ DISCONNECTED |
| Organization mutation UI | organization ID no path | BFF route -> Nest guard | ID está no path, mas não vira contexto interno | ✗ DISCONNECTED |
| Session/identity account pages | sessions/identities | API endpoints | Endpoints upstream não existem | ✗ DISCONNECTED |
| Audit page/service | audit rows | PostgreSQL query tenant-scoped | Sim | ✓ FLOWING |
| Organization list/create | memberships/organization | PostgreSQL repositories | Sim | ✓ FLOWING |

## Code-review blocker disposition

| Blocker requested | Verdict | Independent evidence |
|---|---|---|
| Outbox publisher | **CONFIRMED** | `appendOutboxEvent` só insere; `apps/worker/src/main.ts:72-86` só cria workers consumidores; não há claim/publish/mark. |
| OTP session/step-up persistence | **CONFIRMED** | `otp.service.ts:172-183` retorna status; `identity.controller.ts:167-180` não persiste sessão nem `reauthenticated_at`. |
| OAuth link/step-up reachability | **CONFIRMED** | class-level public controller chama `oauth.start` sem actor/session; runtime/repo omitem `currentMethodConfirmed`. |
| Persisted opaque device session token | **CONFIRMED** | service gera/retorna um token; adapter chama repository que gera outro e descarta `issued.token`. |
| BFF tenant context/RBAC | **CONFIRMED** | guard exige `x-organization-id`; header não está na allowlist nem é derivado da rota. |
| Missing session/identity routes | **CONFIRMED** | BFF lista as rotas, mas `IdentityModule` registra somente os controllers OAuth/OTP e session-alert. |

Os outros quatro blockers do review também permanecem observáveis: sliding idle expiry não aplicado, trust provisional descartado, falha de revogação Discord após commit mascara sucesso e CSP bloqueia logo externa.

## Requirements Coverage

| Requirement | Source plans | Status | Evidence |
|---|---|---|---|
| AUTH-001 | 02-04, 02-06, 02-07, 02-12, 02-15 | ✓ SATISFIED | OAuth Discord real/PKCE aprovado e runtime sign-in conectado a sessão opaca. Link/step-up OAuth continua gap separado. |
| AUTH-002 | 02-02, 02-04, 02-06–08, 02-12–13, 02-15 | ✗ BLOCKED | Resend/template aprovado, mas OTP sign-in não cria sessão. |
| AUTH-003 | 02-03–08, 02-11–13, 02-15–16, 02-19 | ✗ BLOCKED | Rotas ausentes, token de device divergente, step-up não persistido e idle sliding não aplicado. |
| AUTH-004 | 02-02–03, 02-05–06, 02-09, 02-13–14 | ✓ SATISFIED | Memberships independentes permitem várias organizações; assignments aceitam scope explícito. A entidade campeonato fica na Fase 3. |
| AUTH-005 | 02-01, 02-03, 02-05, 02-09, 02-11, 02-14, 02-16, 02-19, 02-22 | ✗ BLOCKED | Policy default-deny passa isoladamente, mas BFF não fornece contexto tenant e nega também o caminho autorizado. |
| AUTH-006 | 02-02–04, 02-06–08, 02-11–13, 02-15–16, 02-19 | ✓ SATISFIED | Tokens/provider secrets ficam server-side; DTOs e respostas públicas não os projetam. |
| ORG-001 | 02-02–03, 02-05, 02-09, 02-13, 02-21–23 | ✗ BLOCKED | Criação/persistência existe, mas CSP de produção impede a logo externa devolvida pelo API. |
| ORG-002 | 02-02–03, 02-05, 02-08–09, 02-12, 02-14, 02-22–23 | ✗ BLOCKED | BFF não alcança mutações autorizadas e o convite não sai do outbox. |
| ORG-003 | 02-01, 02-03, 02-05, 02-09, 02-14 | ✗ BLOCKED | Os seis papéis estão modelados, mas a gestão real via BFF falha sem tenant context. |
| ORG-004 | 02-01, 02-03, 02-05, 02-09, 02-14 | ✓ SATISFIED | Matriz enumera permissões sem wildcard, roles acumuláveis e default-deny; 14/14 testes passaram. |
| ORG-005 | 02-03, 02-05, 02-09, 02-14 | ✓ SATISFIED | Lock de organização e testes concorrentes preservam exatamente um owner; transferência é explícita. |
| AUD-001 | 02-02–03, 02-05, 02-09, 02-14 | ✓ SATISFIED | Audit writer grava actor membership, timestamp, reason, before e after sanitizados na transação. |
| NFR-005 | todos os planos relevantes | ✗ BLOCKED | CSRF/rate limit/cifra existem, porém trust provisional, session lifecycle, OAuth commit/revoke, BFF tenant e CSP mantêm falhas de segurança. |

**Requirements score:** 6/13 satisfied

Não foram encontrados requisitos órfãos: todos os 13 IDs atribuídos à fase aparecem em frontmatter de planos.

### Deferred Items

| Item | Addressed In | Evidence |
|---|---|---|
| Participação de AUTH-004 em vários campeonatos | Phase 3 | Roadmap da Fase 3 cria campeonato, participantes e demais entidades; Phase 2 entrega memberships multi-org e assignment scope-ready. |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Matriz RBAC determinística | `pnpm --filter @pubg-camp/authorization exec vitest run src/authorization.spec.ts` | 14 passed | ✓ PASS |
| Controller/composição identity unitária | `pnpm --filter @pubg-camp/api exec vitest run ...identity.controller.spec.ts ...identity.runtime.spec.ts` | 6 passed | ✓ PASS, cobertura parcial |
| BFF allowlist/CSRF unitário | `pnpm --filter @pubg-camp/web exec vitest run route.spec.ts` | 15 passed | ✓ PASS, não compara inventário Nest nem tenant interno |
| Processor de delivery isolado | `pnpm --filter @pubg-camp/worker exec vitest run processor.spec.ts` | 8 passed | ✓ PASS, não prova publicação do outbox |
| CI remoto declarado em 02-24 | `gh run view 32676449341 --json ...` | event=push, SHA `a41f87c...`, conclusion=success, 8 jobs success | ✓ PASS |

O CI remoto é autêntico, mas não prova as ligações quebradas: `scripts/run-phase2-e2e.mjs:49` inicia `--serve-api`, e `serveApi()` cria um servidor HTTP sintético em memória (`createServer`) em vez de iniciar Nest e worker. Assim, os fluxos browser aprovados não atravessam guards, repositories, outbox, BullMQ ou controllers reais.

### Probe Execution

Não há probes `probe-*.sh` declarados ou convencionais para esta fase. Step 7c: SKIPPED.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `apps/api/src/identity/identity.controller.ts` | 169–172 | catch que antecipa adapter futuro | 🛑 Blocker | Responde login OTP sem sessão estabelecida. |
| `scripts/run-phase2-e2e.mjs` | 49, 84–224 | fake API apresentada como E2E completo | ⚠ Warning | Mascara as conexões BFF/Nest/worker quebradas. |
| `apps/worker/src/notifications/processor.ts` | 49–76 | resultado booleano de clear ignorado | ⚠ Warning | Pode reportar terminalidade sem limpar ciphertext. |
| `apps/api/src/organizations/organizations.service.ts` | 283–306 | compensação cobre pós-commit | ⚠ Warning | Falha de projeção pode remover objeto já referenciado. |
| `apps/web/next.config.ts` | 51 | CSP incompatível com signed logo origin | 🛑 Blocker | Browser bloqueia logo real. |

O scan não encontrou marcadores `TBD`, `FIXME` ou `XXX` nos arquivos de produção da fase.

## Human Verification

Nenhum item humano permanece aberto nesta rodada. Foram aceitas como aprovadas as evidências fornecidas para Discord OAuth/PKCE real, acessibilidade assistiva e entregas/visuais Resend. O status continua `gaps_found` por falhas programaticamente observáveis que essas evidências não exercitam.

## Gaps Summary

Os gaps têm uma raiz comum: unidades bem implementadas não estão conectadas no runtime de produção. A correção deve priorizar uma fatia vertical real — BFF -> Nest guards/controllers -> PostgreSQL/outbox -> BullMQ/worker — antes de ampliar testes visuais. Em seguida, fechar o lifecycle de sessão (OTP, trust, touch, device token e routes), o OAuth autenticado e os dois problemas pós-commit/CSP.

---

_Verified: 2026-08-24T05:23:54Z_
_Verifier: the agent (gsd-verifier)_
