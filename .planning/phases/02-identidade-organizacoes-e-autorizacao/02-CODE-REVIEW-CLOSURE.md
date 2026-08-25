---
phase: 02-identidade-organizacoes-e-autorizacao
reviewed: 2026-08-25T06:40:00Z
depth: deep
diff: c7ed355..061fe1a
files_reviewed: 31
files_reviewed_list:
  - apps/api/src/identity/identity.controller.spec.ts
  - apps/api/src/identity/identity.controller.ts
  - apps/api/src/identity/identity-management.controller.ts
  - apps/api/src/identity/identity.runtime.ts
  - apps/api/src/identity/identity.service.spec.ts
  - apps/api/src/identity/identity.service.ts
  - apps/api/src/identity/oauth.service.ts
  - apps/api/src/identity/otp.service.ts
  - apps/api/src/identity/session.service.ts
  - apps/api/src/main.ts
  - apps/api/src/security/csrf.service.ts
  - apps/api/src/security/http-exception.filter.ts
  - apps/web/e2e/phase2-runtime.spec.ts
  - apps/web/src/app/api/platform/[...path]/route.ts
  - apps/web/src/components/authorization/sensitive-action-continuation.ts
  - apps/web/src/components/identity/account.spec.tsx
  - apps/web/src/components/identity/auth.spec.tsx
  - apps/web/src/components/identity/discord-navigation.ts
  - apps/web/src/components/identity/identity-action-continuation.spec.ts
  - apps/web/src/components/identity/identity-action-continuation.ts
  - apps/web/src/components/identity/identity-cards.tsx
  - apps/web/src/components/identity/oauth-callback-form.tsx
  - apps/web/src/components/ui/dialog.tsx
  - packages/config/src/index.test.ts
  - packages/config/src/index.ts
  - packages/database/src/repositories/identity-security-change.ts
  - packages/database/src/repositories/identity.ts
  - packages/database/src/repositories/sessions.ts
  - packages/database/test/session-alert-context.integration.spec.ts
  - scripts/run-phase2-e2e.mjs
  - scripts/validate-phase2-ci.mjs
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 02: Closure Code Review

**Reviewed:** 2026-08-25T06:40:00Z  
**Depth:** deep  
**Diff:** `c7ed355..061fe1a`  
**Status:** issues_found

## Summary

Os três findings do relatório anterior foram implementados no caminho feliz: a UI agora inicia step-up e retoma ações tipadas; a configuração exige `activityWriteInterval < idleTtl`; e o teste de rollback consulta delivery/outbox por IDs determinísticos, com cardinalidade e payload exatos. PKCE, state one-shot, browser binding, CSRF same-origin, rotação de sessão nas mutações e os limites relacionais de configuração permanecem presentes.

O fechamento, porém, não está limpo. O fluxo recém-exposto de step-up por e-mail não prova que o e-mail informado pertence ao ator. Além disso, a confirmação de step-up é persistida duas vezes em transações distintas, o que permite resposta de falha após a sessão já ter sido elevada. Há ainda duas regressões de robustez na classificação de freshness e na promoção de continuações abandonadas.

Testes focados executados nesta revisão:

- API identity: 36/36 passaram.
- Web identity/continuation: 36/36 passaram.
- Config: 17/17 passaram.

Esses testes verdes não cobrem os cenários adversariais abaixo.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-CLOSURE-01: Step-up por e-mail aceita qualquer endereço controlado pelo portador da sessão

**Files:** `apps/api/src/identity/identity.controller.ts:284-291,427-445`; `packages/database/src/repositories/identity.ts:865-966`

**Issue:** O endpoint autenticado recebe um e-mail arbitrário e `requestProtectedOtp` encaminha esse valor para emissão do challenge sem verificar se ele corresponde a uma identidade de e-mail ativa do ator. Na conclusão, `completeOtpChallenge` valida apenas challenge, digest do e-mail, actor/session e sessão ativa; no ramo `step-up`, ele consome o código e grava `reauthenticatedAt` diretamente. Não existe join/consulta a `verified_emails` + `identities` exigindo `user_id = actorId`, identidade `verified`, não revogada e o mesmo e-mail normalizado.

Um atacante com uma sessão roubada pode informar um e-mail próprio, receber o OTP nesse endereço e elevar a sessão da vítima. A partir daí, os novos fluxos permitem vincular/remover identidades e executar outras ações protegidas por step-up. A UI pedir “e-mail já vinculado” não é uma barreira de segurança.

**Fix:** No boundary PostgreSQL, antes de consumir o challenge ou alterar `reauthenticated_at`, exigir atomicamente que o e-mail normalizado pertença a uma identidade de e-mail verificada, ativa e não revogada do mesmo ator. Na solicitação, preservar resposta não enumerável e não enfileirar entrega para endereço alheio; na verificação, rejeitar fail-closed. Adicionar integração negativa com sessão da vítima + OTP válido enviado a e-mail controlado pelo atacante e provar que challenge, sessão e outbox não sofrem mutação.

### CR-CLOSURE-02: Step-up de e-mail pode retornar falha depois de já elevar a sessão

**Files:** `packages/database/src/repositories/identity.ts:951-966`; `apps/api/src/identity/identity.controller.ts:353-392`; `apps/api/src/identity/session.service.ts:232-242`

**Issue:** `completeOtpChallenge` já consome o OTP e atualiza `sessions.reauthenticated_at` na mesma transação. Depois que essa transação confirma, o controller chama `sessions.confirmStepUp`, que executa uma segunda atualização independente, e só então rotaciona o CSRF. Se a segunda gravação falhar (indisponibilidade, corrida de expiração/revogação ou falha injetada), o `catch` devolve `cancelled`, mas a primeira transação deixou a sessão elevada e o challenge consumido; a rotação de CSRF não ocorreu.

Isso quebra a semântica de falha e o contrato de rotação: o cliente acredita que o step-up falhou, enquanto o servidor aceita a sessão como fresca usando o contexto CSRF anterior. Também impede retry legítimo porque o OTP já foi consumido.

**Fix:** Persistir o step-up exatamente uma vez. Preferencialmente, manter consumo do OTP e marcação da sessão em uma única transação/repositório e remover a segunda gravação do controller; o controller deve apenas validar o resultado committed e rotacionar o CSRF. Adicionar um teste de fault injection provando que qualquer falha antes do commit deixa challenge e `reauthenticated_at` inalterados, e um teste do controller garantindo que não existe segunda mutação falível após o resultado committed.

## Warnings

### WR-CLOSURE-01: Freshness expirada após o primeiro check volta a ser apresentada como OTP inválido

**Files:** `apps/api/src/identity/identity.controller.ts:543-587`; `apps/api/src/identity/identity.service.ts:286-316`; `packages/database/src/repositories/identity-security-change.ts:230-250`

**Issue:** `verifyEmailSecurityChange` preserva o `428` somente no check anterior a `otp.verify`. Depois que o OTP cria a proof, `applyEmailSecurityChange` verifica freshness novamente e o comando transacional também a revalida. Qualquer expiração na fronteira de dez minutos ou rejeição transacional cai no `catch` genérico das linhas 586-587 e vira `400 cancelled`. A UI então mostra “Código inválido ou expirado”, exatamente a ambiguidade que o fix pretendia remover. Como o challenge já foi consumido e a proof pode ter sido criada, repetir o código não resolve.

**Fix:** Preservar `ReauthenticationRequiredException` no catch e transportar uma rejeição tipada do comando transacional quando a causa for apenas freshness. A UI deve reiniciar o step-up sem atribuir a falha ao OTP. Adicionar teste em que o primeiro check passa e o segundo/atômico expira na boundary.

### WR-CLOSURE-02: Continuação abandonada pode ser promovida por um step-up não relacionado

**Files:** `apps/web/src/components/identity/identity-cards.tsx:300-317`; `apps/web/src/components/identity/oauth-callback-form.tsx:82-87`; `apps/web/src/components/identity/identity-action-continuation.ts:17-39`

**Issue:** A ação é gravada em `sessionStorage` antes de `form.submit()`. Se a navegação/callback falhar ou for cancelada, nenhum caminho remove o item pending. Em qualquer callback de `purpose=step-up`, `OAuthCallbackForm` promove simultaneamente as continuações de organização e identidade, sem correlação com a transação/return path. Durante quatro minutos, um step-up posterior e não relacionado pode transformar a ação abandonada em ready; ao visitar `/conta/identidades`, `IdentityCards` a consome e executa automaticamente. Para `remove-identity`, isso pode remover uma forma de acesso após o usuário ter abandonado o fluxo original.

**Fix:** Vincular a continuação a um nonce/flow ID associado à transação OAuth e promover somente o namespace/nonce correspondente ao callback confirmado. Limpar pending em falha/cancelamento e nunca promover as duas famílias indiscriminadamente. Cobrir: submit/callback falho, cancelamento, step-up de organização com pending de identidade, e ausência de execução posterior/replay.

## Resolution verification of previous findings

| Finding anterior | Veredito desta revisão |
|---|---|
| CR-FINAL-01 | O caminho feliz da UI foi implementado, mas não está resolvido como boundary de segurança por CR-CLOSURE-01 e CR-CLOSURE-02. |
| WR-FINAL-01 | Resolvido: schema rejeita igualdade e intervalo maior; teste de repositório toca antes do idle deadline. |
| WR-FINAL-02 | Resolvido: rollback e retry usam IDs conhecidos, contagens exatas e payload correlacionado. |

## Cross-file security checks

- O callback OAuth remove `code` e `state` da URL antes do POST; a continuação de identidade não armazena e-mail, OTP, provider token, state ou code.
- OAuth state é consumido one-shot e vinculado a purpose, browser binding, ator e sessão; Discord step-up valida que o perfil já pertence ao ator.
- O BFF mantém allowlist de rotas/headers, same-origin e CSRF; o POST de navegação não expõe a URL do provedor no DOM persistente.
- Vínculo e remoção revalidam sessão/proof dentro da transação e rotacionam a sessão atual/revogam as demais após commit.
- `SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS >= SESSION_IDLE_TTL_SECONDS` é rejeitado.
- A prova new-device consulta outbox diretamente por ID/aggregate e valida exatamente uma delivery/evento após retry.

---

_Reviewed: 2026-08-25T06:40:00Z_  
_Reviewer: independent closure gsd-code-reviewer_  
_Depth: deep_
