---
phase: 02-identidade-organizacoes-e-autorizacao
reviewed: 2026-08-25T04:40:19Z
depth: deep
files_reviewed: 62
files_reviewed_list:
  - .env.example
  - apps/api/src/e2e/provider-mode.spec.ts
  - apps/api/src/identity/adapters/redis-auth-rate-limiter.ts
  - apps/api/src/identity/identity-management.controller.spec.ts
  - apps/api/src/identity/identity-management.controller.ts
  - apps/api/src/identity/identity.controller.ts
  - apps/api/src/identity/identity.runtime.spec.ts
  - apps/api/src/identity/identity.runtime.ts
  - apps/api/src/identity/identity.service.spec.ts
  - apps/api/src/identity/identity.service.ts
  - apps/api/src/identity/oauth.service.ts
  - apps/api/src/identity/otp.service.spec.ts
  - apps/api/src/identity/otp.service.ts
  - apps/api/src/identity/session.service.ts
  - apps/api/src/main.ts
  - apps/api/src/organizations/adapters/e2e-organization-logo-storage.ts
  - apps/api/src/organizations/organizations.module.ts
  - apps/api/src/organizations/provisional-promotion.integration.spec.ts
  - apps/api/src/security/csrf.service.ts
  - apps/api/test/security.integration.spec.ts
  - apps/web/e2e/phase2-runtime.spec.ts
  - apps/web/src/app/(platform)/conta/identidades/page.tsx
  - apps/web/src/app/api/platform/[...path]/route.spec.ts
  - apps/web/src/app/api/platform/[...path]/route.ts
  - apps/web/src/components/authorization/confirm-sensitive-action-dialog.tsx
  - apps/web/src/components/authorization/sensitive-action-continuation.spec.ts
  - apps/web/src/components/authorization/sensitive-action-continuation.ts
  - apps/web/src/components/identity/account.spec.tsx
  - apps/web/src/components/identity/auth.spec.tsx
  - apps/web/src/components/identity/identity-cards.tsx
  - apps/web/src/components/identity/oauth-callback-form.tsx
  - apps/web/src/components/organizations/member-list.tsx
  - apps/web/src/components/organizations/organization-management.spec.tsx
  - apps/web/src/lib/platform-client-routes.spec.ts
  - apps/worker/src/e2e/file-email-sender.ts
  - apps/worker/src/e2e/file-logo-storage.ts
  - apps/worker/src/main.ts
  - apps/worker/src/outbox/publisher.ts
  - apps/worker/src/storage/logo-cleanup.processor.spec.ts
  - apps/worker/src/storage/logo-cleanup.processor.ts
  - packages/config/src/index.test.ts
  - packages/config/src/index.ts
  - packages/contracts/src/identity.test.ts
  - packages/contracts/src/identity.ts
  - packages/contracts/src/platform-route-inventory.ts
  - packages/database/src/identity-security-change.test.ts
  - packages/database/src/outbox.test.ts
  - packages/database/src/outbox.ts
  - packages/database/src/repositories/identity-security-change.ts
  - packages/database/src/repositories/identity.ts
  - packages/database/src/repositories/notifications.ts
  - packages/database/src/repositories/organizations.ts
  - packages/database/src/repositories/sessions.ts
  - packages/database/test/identity-organizations.integration.spec.ts
  - packages/database/test/identity-security-change.integration.spec.ts
  - packages/database/test/invitation.concurrent.spec.ts
  - packages/database/test/last-owner.concurrent.spec.ts
  - packages/database/test/organization-logo.integration.spec.ts
  - packages/database/test/runtime-security-migration.integration.spec.ts
  - packages/database/test/session-alert-context.integration.spec.ts
  - packages/queue/src/index.ts
  - scripts/run-phase2-e2e.mjs
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 02: Final Independent Code Review

**Reviewed:** 2026-08-25T04:40:19Z  
**Depth:** deep  
**Diff:** `3176a76..290e5a9`  
**Files reviewed:** 62  
**Status:** issues_found

## Summary

Esta revisão releu os artefatos de review/fix/validation, os 17 commits do intervalo solicitado, os 47 arquivos alterados fora de `.planning/` e os módulos adjacentes que executam as fronteiras de identidade, sessão, outbox, filas e providers E2E. Os fixes corrigem o núcleo de backend dos 11 findings originais, mas não entregam uma jornada utilizável de vínculo/remoção de identidade: a UI nunca obtém a prova do método atual que os repositórios agora exigem. Restam ainda uma combinação inválida de políticas de sessão aceita pela configuração e uma asserção de rollback que não consegue detectar o órfão que pretende impedir.

As evidências já registradas (`PG 58/58`, concorrência `4/4`, runtime `6/6`, smoke `2/2`, browser `26 pass + 6 condicionais`) foram consideradas, mas não cobrem o bloqueio de jornada descrito abaixo. Em reruns focados desta revisão, passaram 34 testes web, 10 testes unitários de database, 16 testes de worker e 52 testes de API; o conjunto de API exigiu primeiro o build de `@pubg-camp/contracts`, conforme a dependência `^build` do pipeline. Nenhum desses testes percorre o vínculo real partindo de uma sessão sem `reauthenticated_at` fresco.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-FINAL-01: A conta não oferece a reautenticação exigida para vincular ou remover identidades

**Files:** `apps/web/src/components/identity/identity-cards.tsx:28-96,198-306`; `packages/database/src/repositories/sessions.ts:155-168,270-282`; `packages/database/src/repositories/identity.ts:144-161`; `packages/database/src/repositories/identity-security-change.ts:232-244`; `apps/web/src/components/identity/account.spec.tsx:189-235`

**Issue:** O backend passou corretamente a exigir prova recente do método atual, mas a página de identidades chama diretamente `link-identity`, `link-email/request`, `link-email/verify`, confirmação de pending link e remoção. Ela não inicia `step-up` nem oferece uma continuação depois dele. Sessões emitidas por Discord deixam `reauthenticated_at` nulo; sessões promovidas por e-mail só ficam frescas por dez minutos. Assim:

- um usuário autenticado por Discord não consegue iniciar o vínculo do Discord nem concluir vínculo/remoção por e-mail;
- qualquer sessão com mais de dez minutos falha nas mesmas operações;
- no vínculo de e-mail, o usuário pode gastar o OTP do candidato para somente então receber a rejeição transacional por falta de prova atual;
- a UI converte essa rejeição em “código inválido ou expirado”, induzindo nova tentativa que não pode resolver a precondição.

O teste de componente é falso positivo para essa jornada: ele fabrica uma resposta `200 { status: "identity-link-ready" }` para `/link-email/verify` e nunca modela o estado de reautenticação da sessão. Os testes de integração positivos semeiam `reauthenticatedAt` fresco por padrão, enquanto os casos negativos confirmam que `null`, stale, boundary e future são rejeitados. Não há teste browser de `link-email` ou `link-identity` no diretório E2E.

**Risk:** As operações centrais da tela “Formas de acesso” falham para sessões normais/amadurecidas apesar de a UI anunciá-las como disponíveis. Isso bloqueia onboarding de um segundo método, recuperação futura de acesso e gerenciamento seguro da conta.

**Fix:** Antes de iniciar qualquer prova do método candidato ou remover uma identidade, executar step-up do método já vinculado na sessão atual. Persistir uma continuação tipada e curta para a ação de identidade, retomar somente após callback/OTP de `step-up`, e então iniciar/confirmar a prova candidata. No erro de freshness, não rotular como OTP inválido: redirecionar para o step-up preservando somente dados não secretos. Adicionar E2E real para (1) sessão Discord com `reauthenticated_at = null`, (2) sessão e-mail com prova expirada, (3) vínculo Discord, (4) vínculo e-mail e (5) remoção, verificando mutação, rotação/revogação e replay.

## Warnings

### WR-FINAL-01: Configuração aceita intervalo de touch maior ou igual ao idle TTL

**Files:** `packages/config/src/index.ts:75-94`; `packages/database/src/repositories/sessions.ts:493-515`

**Issue:** `SESSION_IDLE_TTL_SECONDS` aceita a partir de 300 segundos e `SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS` aceita até 3600 segundos, sem uma validação relacional. Se o intervalo de escrita for igual ou maior que o idle TTL, `resolveAndTouchSession` só considera a sessão elegível para touch quando `lastSeenAt <= now - interval`; nesse instante `idleExpiresAt > now` já é falso (na igualdade também, pois a consulta usa `gt`). Uma configuração aceita e aparentemente válida transforma o idle deslizante em expiração fixa e encerra sessões ativas.

**Risk:** Um erro operacional permitido pelo schema causa logout inesperado de todos os usuários ativos e torna a política injetada semanticamente incoerente.

**Fix:** Adicionar `superRefine` exigindo `SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS < SESSION_IDLE_TTL_SECONDS`. Cobrir igualdade e intervalo maior no teste de config, além de um teste de repositório que demonstre que uma sessão ativa é tocada antes do idle deadline.

### WR-FINAL-02: O teste de atomicidade new-device não consegue detectar outbox órfão

**File:** `packages/database/test/session-alert-context.integration.spec.ts:424-483`

**Issue:** Após forçar rollback em cada estágio, o teste conta eventos de outbox por `aggregate_id in (select id from notification_deliveries ...)`. Como ele acabou de afirmar que nenhuma delivery sobreviveu, o subselect é vazio e `outbox = 0` será verdadeiro mesmo se um evento órfão tiver escapado. O retry subsequente apenas verifica que existe um `notificationDeliveryId`; apesar do título dizer “exactly one alert”, ele não conta deliveries/outbox após o retry. A implementação atual usa uma transação única, mas este teste não impediria a regressão cross-transaction que CR-07 pretendia fechar.

**Risk:** Uma futura separação acidental entre delivery e outbox pode passar no CI e produzir e-mails duplicados ou eventos impossíveis de reconciliar.

**Fix:** Fornecer IDs determinísticos conhecidos ao teste e consultar `outbox_events` diretamente pelo ID/aggregate esperado, sem depender da linha de delivery revertida. Após o retry, afirmar exatamente uma delivery e exatamente um evento de outbox para a chave/correlação, além de validar o payload.

## Goal-backward verification of original findings

| Original | Resultado no código atual | Evidência principal |
|---|---|---|
| CR-01 outbox allowlist | Corrigido | O claim filtra `eventTypes` antes de marcar/contabilizar; o teste PG misto preserva o tipo alheio como pending, `attempts=0`, sem claim token. |
| CR-02 BullMQ/ledger | Corrigido | Resultado discriminado (`claimed/completed/missing/delayed`); delayed usa `moveToDelayed(..., token)` e `DelayedError`; somente completed/missing é reconhecido. |
| CR-03 rotas link-email/step-up | Parcial no produto | Literais, inventário e proxy foram adicionados corretamente, mas a jornada link-email continua bloqueada por CR-FINAL-01. |
| CR-04 step-up e continuação Discord | Corrigido para ações sensíveis de organização | Continuação é tipada por ação/reason, curta e one-shot no cliente; servidor vincula step-up à sessão. Não resolve as ações de identidade, que não usam esse fluxo. |
| CR-05 pending OAuth proof | Corrigido | Busca exige actor, session, purpose/provider, não consumido e não expirado; contrato retorna projeção redigida e inclui o ID pending. |
| CR-06 fresh reauth transacional | Corrigido no boundary | Lock e validação de freshness ocorrem dentro da transação antes do consumo/mutação; null/stale/boundary/future/wrong-session são cobertos. A integração UI ausente é CR-FINAL-01. |
| CR-07 new-device atomic | Implementação corrigida; gate incompleto | Device, session, alert context, delivery e outbox compartilham a transação. A prova de rollback do outbox é inválida conforme WR-FINAL-02. |
| CR-08 policies config | Corrigido com ressalva | Valores entram pelo `main` e chegam a session/OTP/rate limiter; falta a invariância relacional de WR-FINAL-01. |
| WR-01 OTP/outbox atomic | Corrigido | Consumo do challenge, efeito e outbox usam uma transação; testes consultam os IDs/eventos efetivos. |
| WR-02 cookies Secure/Host | Corrigido no escopo original | Session, preauth e CSRF derivam nome/`Secure` da política e produção exige HTTPS + Secure. |
| WR-03 APP_ORIGIN | Corrigido | Schema exige origem canônica, rejeita componentes adicionais e produção exige HTTPS; CSRF recebe a origem validada. |

## Adjacent cross-file checks

- **Providers E2E:** produção não depende funcionalmente dos fakes. API e worker só selecionam adaptadores de arquivo quando `NODE_ENV=test`, modo explicitamente `fake`, run ID e temp root controlado estão presentes; combinação parcial é rejeitada. Os imports existem no bundle, mas o caminho de execução production permanece nos providers reais.
- **Outbox/cleanup:** a allowlist do publisher não reivindica eventos de cleanup; falhas de enqueue/ledger não marcam sucesso indevido, e o processor posterga com token BullMQ válido.
- **Pending proof:** a projeção exposta não contém subject/provider token bruto e a confirmação revalida proof, sessão e expiração no banco.
- **Fresh reauth/OTP:** as mutações de segurança e o consumo OTP/outbox são transacionais no código atual. O defeito crítico é a ausência da etapa que satisfaz essa precondição na jornada do usuário, não um relaxamento do boundary.

---

_Reviewed: 2026-08-25T04:40:19Z_  
_Reviewer: independent gsd-code-reviewer_  
_Depth: deep_
