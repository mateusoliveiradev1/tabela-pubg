---
phase: 02-identidade-organizacoes-e-autorizacao
verified: 2026-08-25T09:24:02Z
status: gaps_found
score: 6/7 must-haves verified
requirements_score: 12/13 requirements verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 2/6
  gaps_closed:
    - "A alternativa por e-mail autentica e o step-up persiste na sessão atual."
    - "Outbox transacional entrega OTP, convite, alerta de dispositivo e limpeza ao worker."
    - "OAuth autenticado de vínculo e step-up é alcançável e usa prova durável vinculada à sessão."
    - "Sessões opacas emitidas são resolvíveis, revogáveis e gerenciáveis pelos endpoints publicados."
    - "Sessões e recursos visuais preservam as garantias de segurança declaradas."
    - "Todas as leituras tenant-scoped de membros, logo e auditoria exigem membership/RBAC live no PermissionGuard e negam antes do downstream."
  gaps_remaining:
    - "O HEAD final ainda precisa de um único run CI remoto autorizado e promovido no SHA exato."
  regressions: []
gaps:
  - truth: "O HEAD final da fase é respaldado pelo gate CI remoto exato em stack real"
    status: failed
    reason: "O ledger autoritativo aponta o run 32798458788 no SHA 5b1555d, mas o HEAD funcional verificado é ae43308 e há 89 arquivos alterados desde a evidência, incluindo 73 arquivos de source/test/config. Gates locais e reviews posteriores não satisfazem o contrato do plano 02-34 de branch/event/headSha exatos em clean checkout."
    artifacts:
      - path: ".planning/phases/02-identidade-organizacoes-e-autorizacao/02-34-SUMMARY.md"
        issue: "Phase 2 Post-Remediation Evidence permanece em headSha 5b1555d7693b0f5678eeaa131550cedc985345ad."
      - path: ".planning/phases/02-identidade-organizacoes-e-autorizacao/02-VALIDATION.md"
        issue: "O ledger promove a mesma evidência anterior às correções finais."
    missing:
      - "Executar um único CI push autorizado sobre o SHA final após fechar o gap de autorização."
      - "Exigir 8/8 jobs, runtime real, browser, secret scan e cleanup no mesmo run/headSha."
      - "Promover novamente 02-34/02-VALIDATION somente a partir desse objeto de evidência."
deferred:
  - truth: "AUTH-004 inclui participação em vários campeonatos além de várias organizações"
    addressed_in: "Phase 3"
    evidence: "A Fase 3 cria campeonato, participantes e escopos; a Fase 2 já entrega memberships multi-organização e assignments scope-ready."
---

# Phase 2: Identidade, organizações e autorização — Verification Report

**Phase Goal:** usuários entram com segurança e colaboram sem compartilhar credenciais.
**Verified:** 2026-08-25T09:24:02Z
**Status:** gaps_found
**Re-verification:** Yes — after gap closure
**HEAD funcional verificado:** `ae43308e58cf6202933967ad1cb3c19915dc56b4`

## Verdict

A implementação fechou as seis falhas funcionais anteriores. Discord e e-mail autenticam, step-up persiste, sessões são opacas e revogáveis, o outbox chega ao BullMQ/worker, OAuth de vínculo é session-bound, o BFF deriva tenant do path e as telas operacionais consomem endpoints Nest reais.

A fase ainda não pode receber `passed` por um único motivo: o CI autoritativo foi executado no SHA `5b1555d`, antes das correções finais. O gap funcional de autorização está fechado: members/logo usam a permission explícita de baseline `organization:read`, audit usa `organization:audit:self:read`, e as três rotas consultam o snapshot live no `PermissionGuard`, retornam 403 uniforme e registram exatamente um `authorization-denied` redigido antes de handler/repository.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---:|---|---|---|
| 1 | Usuário entra via Discord OAuth2/PKCE e recebe sessão opaca sem token do provider no payload público. | ✓ VERIFIED | `discord-oauth.ts` usa Authorization Code + PKCE; `OAuthService` revoga o token antes da mutação; callback unificado recupera propósito da transação; evidência humana Discord já aprovada. |
| 2 | Usuário entra alternativamente por e-mail e step-up por e-mail habilita mutações sensíveis. | ✓ VERIFIED | `IdentityController.verifyEmailSignInOtp` emite sessão real; `completeOtpChallenge` persiste step-up bound; mudança de identidade ocorre em transação única com proof/session/outbox. |
| 3 | Cada função completa somente as ações autorizadas. | ✓ VERIFIED | Matriz default-deny sem wildcard passou 16/16; `organization:read` concede somente baseline read a membership ativa, enquanto audit self permanece explícito e mutações conservam permissões próprias. |
| 4 | Tentativas entre organizações são negadas e registradas. | ✓ VERIFIED | Members/logo/audit atravessam o snapshot live com route/header tenant coerentes; não-membro recebe 403, um denial redigido e nenhum handler/repository é tocado. |
| 5 | Revogação encerra somente o acesso-alvo e preserva outros membros/sessões. | ✓ VERIFIED | Controllers reais de sessão/identidade estão registrados; revogação é owner-scoped; transferência/revogação usa locks, fresh step-up e preserva a sessão corrente conforme o caso. |
| 6 | Segredos de provider e tokens opacos não aparecem em DOM, URLs de retorno, JSON público ou logs persistidos. | ✓ VERIFIED | Callback envia apenas code/state; contratos omitem credenciais; tokens ficam server-side; payloads de notificação são AES-GCM e logs/eventos usam campos allowlisted. |
| 7 | O HEAD final é respaldado pelo gate CI remoto exato em stack real. | ✗ FAILED | Run `32798458788` passou 8/8 no SHA `5b1555d`; HEAD funcional é `ae43308`, com 89 arquivos modificados desde o run. |

**Score:** 6/7 truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---:|---|---|---|
| 1 | Participação de AUTH-004 em vários campeonatos | Phase 3 | Roadmap cria campeonato/participantes; Phase 2 já entrega multi-organização e assignments com scope explícito. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/authorization/src/index.ts` | Matriz de menor privilégio por org/scope | ✓ VERIFIED | `organization:read` é enumerada, sem wildcard, limitada a membership ativa; matriz default-deny passa 16/16. |
| `apps/api/src/authorization/permission.guard.ts` | Trust, tenant, scope, live RBAC e denial recorder | ✓ VERIFIED | Todas as rotas tenant-scoped usam permission RBAC real; `authenticated` permanece somente em rotas sem `:organizationId`. |
| `apps/api/src/identity/identity.controller.ts` | OAuth/OTP purpose-specific com cookie/CSRF | ✓ VERIFIED | Sign-in, link/change, provisional e step-up possuem rotas separadas e bindings server-side. |
| `apps/api/src/identity/identity.runtime.ts` | DB/Redis/provider/session wiring | ✓ VERIFIED | Projeta proof atual, preserva token emitido, injeta policy e prefixes run-scoped. |
| `packages/database/src/repositories/sessions.ts` | Token opaco, trust, touch, expiração e revogação | ✓ VERIFIED | Token único; resolve-and-touch coalescido; teto absoluto; provisional; step-up e revoke. |
| `packages/database/src/outbox.ts` | Claim/lease/retry/published durável | ✓ VERIFIED | `FOR UPDATE SKIP LOCKED`, claim token, lease, retry redigido e published terminal. |
| `apps/worker/src/outbox/publisher.ts` | PostgreSQL → BullMQ idempotente | ✓ VERIFIED | Allowlist estrita, `jobId=event.id`, retry/lease-loss e payload mínimo. |
| `apps/worker/src/main.ts` | Publisher, producers e consumers em produção | ✓ VERIFIED | Inicializa após readiness e fecha publisher/queues/workers em ordem. |
| `packages/database/src/repositories/organizations.ts` | Org, convite, membros, last-owner e audit transacional | ✓ VERIFIED | Repositório tenant-scoped com locks, audit/outbox na mesma transação. |
| `packages/database/src/repositories/audit.ts` | Autor/data/motivo/before/after redigidos | ✓ VERIFIED | Writer sanitiza snapshots e consulta respeita visibilidade all/self. |
| `packages/contracts/src/platform-route-inventory.ts` | Inventário único BFF→Nest | ✓ VERIFIED | Métodos, templates, limites, tenant extractor, CSRF e samples são canônicos. |
| `apps/web/src/app/api/platform/[...path]/route.ts` | BFF estrito e tenant server-derived | ✓ VERIFIED | Browser não controla tenant; captures UUID viram headers internos; body/headers/CSRF são limitados. |
| `apps/web/next.config.ts` + `organization-logo-origins.ts` | CSP exata para logos | ✓ VERIFIED | `img-src` recebe somente origins exatas HTTPS; wildcard/path/query/credentials falham. |
| `02-34-SUMMARY.md` + `02-VALIDATION.md` | Evidência CI do HEAD final | ✗ STALE | Estruturalmente válidos, mas apontam para SHA anterior às correções finais. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Discord callback | identity/session repository | `OAuthService.completeCallback` | ✓ WIRED | Propósito vem da transação one-shot; sign-in emite sessão; step-up persiste; link cria proof pendente. |
| OTP verify | identity/session/step-up | completion purpose-specific transacional | ✓ WIRED | Sign-in resolve/cria identidade; step-up e mudanças são actor/session-bound. |
| `outbox_events` | BullMQ | claim → `queue.add(jobId=id)` → mark/retry | ✓ WIRED | Publisher de produção registrado no worker. |
| BullMQ delivery | Resend/file provider | processor carrega/decripta/limpa delivery | ✓ WIRED | Terminalidade só é reportada após persistir clear ou reconhecer vencedor concorrente. |
| BFF organization route | Nest guard | UUID capturado → headers internos | ✓ WIRED | Tenant spoofado do browser é descartado. |
| Nest guard | PostgreSQL authorization snapshot | `AuthorizationService.can` | ✓ WIRED | Members/logo/audit carregam snapshot live antes do handler e usam permission org-wide explícita. |
| Session cookie | sliding expiry/trust | `main.ts` → `resolveAndTouchSession` | ✓ WIRED | Policy configurada é injetada e teto absoluto preservado. |
| Session/identity UI | Nest controllers | inventário BFF + controllers registrados | ✓ WIRED | Inventário e `hasRoute` cobrem sessions, identities e fluxos protegidos. |
| Organization UI | org/member/invite/audit APIs | server fetch/BFF e schemas de contrato | ✓ WIRED | Páginas carregam dados reais, exibem estados e enviam mutações para rotas canônicas. |
| CI remoto | HEAD final | branch + push + exact headSha | ✗ NOT WIRED | Evidência cobre `5b1555d`, não `ae43308`. |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|---|---|---|---|---|
| OTP sign-in/step-up | challenge/completion | PostgreSQL challenge + identity/session transaction | Yes | ✓ FLOWING |
| E-mail worker | `deliveryId` | DB delivery → outbox → BullMQ → processor | Yes | ✓ FLOWING |
| Organização/membros/convites | contract DTOs | Next/BFF → Nest → PostgreSQL | Yes | ✓ FLOWING |
| Sessões/identidades | account page state | Nest controllers → repositories | Yes | ✓ FLOWING |
| Auditoria | `AuditEventPage` | PostgreSQL tenant query → projection redigida | Yes; non-member é negado pelo guard antes da query | ✓ FLOWING |
| Logo | signed URL | storage metadata → signed URL → CSP exact origin | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Matriz RBAC determinística | `pnpm --filter @pubg-camp/authorization exec vitest run src/authorization.spec.ts` | 16/16 | ✓ PASS |
| API unitária completa, incluindo guard tenant | `pnpm --filter @pubg-camp/api test` | 143/143 | ✓ PASS |
| Non-member/positive members/logo/audit | `vitest run src/authorization/tenant-read.authorization.spec.ts` | 6/6 | ✓ PASS |
| PostgreSQL/Redis integration | `pnpm phase2:integration` + `pnpm phase2:concurrent` | 60/60 + 4/4 | ✓ PASS |
| BFF + UI identity/org | `pnpm --filter @pubg-camp/web exec vitest run ...` | 83/83 | ✓ PASS |
| Inventário BFF→Nest | `pnpm --filter @pubg-camp/contracts exec vitest run src/platform-route-inventory.spec.ts` | 3/3 | ✓ PASS |
| Controllers session/identity management | `pnpm --filter @pubg-camp/api exec vitest run ...` | 20/20 | ✓ PASS |
| Browser/runtime local | `pnpm test:e2e:runtime` | Infra real iniciou; 1/7 passou e a suíte parou num timeout pré-existente de projeção de identidade antes dos casos tenant | ⚠ INCONCLUSIVE — coberto pelo gap CI final |

O caso disconfirmatório agora é explícito para members/logo/audit: route/header iguais, ator sem membership, 403, uma telemetria allowlisted e zero chamadas de handler/repository. Os positivos provam passagem de membro live nas mesmas três rotas.

### Probe Execution

Não há probes `probe-*.sh` declarados ou convencionais para esta fase. Step 7c: SKIPPED.

### Requirements Coverage

| Requirement | Source plans | Status | Evidence |
|---|---|---|---|
| AUTH-001 | 02-04, 06, 07, 12, 15, 31, 37, 39, 41 | ✓ SATISFIED | Discord OAuth2/PKCE e sessão opaca ligados ao runtime. |
| AUTH-002 | 02-02, 04, 06–08, 12–13, 25–26, 30, 36, 39, 42 | ✓ SATISFIED | E-mail sign-in/recuperação, entrega e session/step-up persistente. |
| AUTH-003 | 02-03–08, 11–13, 16, 19, 27, 30, 32, 35, 39, 41, 42 | ✓ SATISFIED | Sessões revogáveis, trust, expiração, touch e anti-replay. |
| AUTH-004 | 02-02–03, 05–06, 09, 13–14, 29, 39 | ✓ SATISFIED | Multi-organização e assignments scope-ready; campeonato deferido à Fase 3. |
| AUTH-005 | 02-01, 03, 05, 09, 11, 14, 16, 19, 22, 29, 32, 35, 38, 39 | ✓ SATISFIED | Toda rota tenant-scoped usa permission explícita, snapshot live, 403 uniforme e denial redigido antes do downstream. |
| AUTH-006 | 02-02–04, 06–08, 11–13, 15–16, 19, 31, 37, 39, 42 | ✓ SATISFIED | Credenciais permanecem server-side e contratos/logs são redigidos. |
| ORG-001 | 02-02–03, 05, 09, 13, 21–23, 28, 39 | ✓ SATISFIED | Criação, logo, membros e CSP alinhados. |
| ORG-002 | 02-02–03, 05, 08–09, 12, 14, 22–23, 26, 29, 32, 38, 39 | ✓ SATISFIED | Convite, reenvio, aceite e revogação ligados ao outbox/BFF. |
| ORG-003 | 02-01, 03, 05, 09, 14, 29, 38, 39 | ✓ SATISFIED | Seis funções modeladas e gerenciáveis. |
| ORG-004 | 02-01, 03, 05, 09, 14, 29, 39 | ✓ SATISFIED | Matriz explícita de menor privilégio, sem wildcard. |
| ORG-005 | 02-03, 05, 09, 14, 33, 39 | ✓ SATISFIED | Last-owner protegido por lock e transferência explícita. |
| AUD-001 | 02-02–03, 05, 09, 14, 29, 39 | ✓ SATISFIED | Mutações sensíveis gravam autor, tempo, razão, before/after sanitizados. |
| NFR-005 | 02-25–42 | ✗ BLOCKED | Código possui controles, mas o gate remoto exato do HEAD final ainda não existe. |

**Requirements score:** 12/13 satisfied

Todos os 13 requisitos da Fase 2 aparecem em pelo menos um plano; não há requisito órfão.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `02-VALIDATION.md` | evidence object | SHA autoritativo anterior ao source final | 🛑 Blocker | Clean-checkout CI não prova o HEAD entregue. |

O scan não encontrou marcadores `TBD`, `FIXME` ou `XXX` em source da fase. Ocorrências de `placeholder` são placeholders de formulário/teste e não stubs.

### Human Verification Required

Nenhum item humano permanece aberto. A evidência humana anterior para Discord real, Resend e acessibilidade foi aceita e não sofreu regressão observável nos checks focais. O acabamento visual completo está explicitamente contratado para a Fase 2.1 e não é usado como gap desta fase.

### Gaps Summary

Resta somente o gate remoto: o SHA final precisa de um único run CI autorizado com os 8 jobs, runtime real, browser, secret scan e cleanup; 02-34/02-VALIDATION devem ser promovidos novamente a partir desse objeto. Todos os gaps funcionais estão fechados.

---

_Verified: 2026-08-25T09:24:02Z_
_Verifier: the agent (gsd-verifier)_
