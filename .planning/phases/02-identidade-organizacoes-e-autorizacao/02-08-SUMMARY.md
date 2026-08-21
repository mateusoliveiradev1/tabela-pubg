---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 08
subsystem: worker-notifications
tags: [resend, bullmq, aes-256-gcm, idempotency, transactional-email, zod]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 04
    provides: envelopes AES-256-GCM, notification deliveries e outbox contendo somente deliveryId
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 07
    provides: borda HTTP de identidade desacoplada de provedores de e-mail
provides:
  - processor BullMQ deliveryId-only com descriptografia exclusiva no worker
  - templates tipados de OTP, convite e novo dispositivo em português
  - adapter Resend idempotente com erros redigidos e contract test HTTP sem rede real
  - cleanup terminal de ciphertext e lifecycle completo de PostgreSQL, Redis e telemetria
affects: [identity-production-wiring, organization-invitations, session-alerts, worker-deployment]
tech-stack:
  added: [resend@6.21.0]
  patterns: [delivery-id-only-job, decrypt-at-last-moment, provider-idempotency, redacted-provider-errors]
key-files:
  created:
    - apps/worker/src/notifications/email-sender.ts
    - apps/worker/src/notifications/templates.ts
    - apps/worker/src/notifications/processor.ts
    - apps/worker/src/notifications/resend-email-sender.ts
    - apps/worker/src/notifications/processor.spec.ts
    - apps/worker/src/notifications/resend-email-sender.contract.spec.ts
  modified:
    - apps/worker/src/main.ts
    - apps/worker/src/health.ts
    - apps/worker/package.json
    - pnpm-lock.yaml
    - pnpm-workspace.yaml
key-decisions:
  - "Jobs de notificação aceitam um objeto estrito contendo somente deliveryId; recipient, tokens e conteúdo permanecem no envelope AES-GCM até o último momento no worker."
  - "Retries reutilizam a idempotency key persistida por delivery; resend de convite exige novo delivery, nova chave e novo token."
  - "O adapter usa o SDK Resend 6.21.0 com transporte que descarta corpos de erro externos e expõe somente código estável, impedindo vazamento em logs."
  - "Convites levam o token no fragmento; alertas de dispositivo usam contexto opaco read-only e nunca incluem sessionId, IP completo ou user-agent no e-mail."
patterns-established:
  - "Decrypt-at-last-moment: carregar delivery, validar estado/TTL, descriptografar, renderizar, enviar e limpar o envelope terminal."
  - "Provider error redaction: nunca propagar mensagem, body, recipient ou request retornados pelo provedor externo."
requirements-completed: [AUTH-002, AUTH-003, AUTH-006, ORG-002, NFR-005]
duration: 9min
completed: 2026-08-21
---

# Phase 2 Plan 08: Entrega transacional de notificações Summary

**E-mails de OTP, convite e novo dispositivo são entregues por um worker deliveryId-only com AES-256-GCM, idempotência Resend e limpeza terminal do ciphertext**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-21T06:22:15.000Z
- **Completed:** 2026-08-21T06:31:15.608Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Implementou processor estrito que recebe somente `deliveryId`, ignora deliveries terminais, expira envelopes vencidos e descriptografa AES-GCM apenas imediatamente antes de renderizar e enviar.
- Implementou templates seguros de OTP, convite e novo dispositivo, com copy do UI-SPEC, HTML escapado, e-mail mascarado, localização aproximada e CTA de sessão estritamente read-only.
- Implementou adapter `resend@6.21.0` com idempotency key estável e transporte redigido, provado por captura do request HTTP sem API key válida ou rede externa.
- Conectou PostgreSQL, Redis/BullMQ, chaves de criptografia, Resend, health checks e shutdown seguro no worker, sem acoplar o provedor à API.

## Task Commits

1. **Task 1: Criar processor idempotente e templates seguros**
   - `8427cd8` — RED: specifications de deliveryId-only, retry, duplicidade, expiração, cleanup, convite reenviado e contrato Resend.
   - `e0c9507` — GREEN: processor, templates, adapter redigido e dependências exatas aprovadas.
2. **Task 2: Conectar adapter Resend e lifecycle do worker**
   - `3ed3300` — composição do worker, readiness PostgreSQL/Redis e encerramento completo de recursos.

## Files Created/Modified

- `apps/worker/src/notifications/email-sender.ts` — port mínimo de e-mail transacional e resultado provider-safe.
- `apps/worker/src/notifications/processor.ts` — valida job, carrega delivery, descriptografa, envia e limpa estado terminal.
- `apps/worker/src/notifications/templates.ts` — schemas e templates em texto/HTML com escaping e privacidade.
- `apps/worker/src/notifications/resend-email-sender.ts` — adapter SDK com idempotência e erro redigido.
- `apps/worker/src/notifications/processor.spec.ts` — 8 cenários de lifecycle, segurança e convite create/resend.
- `apps/worker/src/notifications/resend-email-sender.contract.spec.ts` — captura request Resend e prova headers/body sem rede real.
- `apps/worker/src/main.ts` — composição real de database, queue, processor e lifecycle.
- `apps/worker/src/health.ts` — readiness independente de PostgreSQL e Redis.
- `apps/worker/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` — dependências exatas e exceção supply-chain já auditada.

## Decisions Made

- O processor usa diretamente o helper de descriptografia do package database, enquanto lookup e finalização ficam atrás de um store injetável para testes determinísticos.
- A chave de idempotência vem da linha da delivery; o processor jamais a deriva de recipient/token, garantindo estabilidade no retry e separação no resend.
- O SDK Resend continua responsável por serialização e headers, mas seu fetch é sobrescrito por transporte redigido para impedir que respostas externas contendo PII sejam logadas em desenvolvimento.
- O horário dos e-mails é formatado em português com fuso UTC explícito; nenhuma localização é tratada como prova de identidade.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Readiness passou a verificar PostgreSQL além de Redis**
- **Found during:** Task 2 (lifecycle do worker)
- **Issue:** O worker passou a depender do banco, mas o health check anterior reportava apenas Redis e poderia declarar readiness com PostgreSQL indisponível.
- **Fix:** Adicionadas probes independentes e fail-closed para PostgreSQL e Redis.
- **Files modified:** `apps/worker/src/health.ts`, `apps/worker/src/health.test.ts`, `apps/worker/src/main.ts`
- **Verification:** 12 testes do worker, lint, typecheck e build passaram.
- **Committed in:** `3ed3300`

**2. [Rule 2 - Missing Critical] Shutdown fecha todos os recursos mesmo após falha intermediária**
- **Found during:** Task 2 (lifecycle do worker)
- **Issue:** Um erro ao fechar worker/server poderia impedir o encerramento do banco, Redis ou telemetria.
- **Fix:** Cada recurso é fechado de forma independente, failures são contadas sem registrar seus payloads e o processo recebe exit code de falha.
- **Files modified:** `apps/worker/src/main.ts`
- **Verification:** lint, typecheck e build do worker passaram.
- **Committed in:** `3ed3300`

**3. [Rule 3 - Blocking] Supply-chain gate registrou a versão recém-auditada**
- **Found during:** Task 1 (instalação exata de `resend@6.21.0`)
- **Issue:** A política de minimum release age exige exclusão explícita para uma versão recém-lançada, embora já aprovada pela auditoria 02-10/RESEARCH.
- **Fix:** O pnpm adicionou somente `resend@6.21.0` a `minimumReleaseAgeExclude`; nenhum pacote alternativo foi instalado.
- **Files modified:** `pnpm-workspace.yaml`
- **Verification:** lockfile supply-chain policy, versão exata e secret scan passaram.
- **Committed in:** `e0c9507`

---

**Total deviations:** 3 auto-fixed (2 Rule 2, 1 Rule 3).
**Impact on plan:** Ajustes necessários para operação segura e fail-closed; nenhuma feature adicional ou mudança arquitetural.

## Issues Encountered

None.

## Authentication Gates

None — testes do Resend usam captura HTTP local e nenhuma credencial real.

## User Setup Required

O código e os testes estão completos. A entrega externa exige domínio/remetente verificado e segredo do Resend; as instruções foram acrescentadas a [02-USER-SETUP.md](./02-USER-SETUP.md).

## Verification Results

- `rtk pnpm --filter @pubg-camp/worker test` — PASS, 12/12 testes.
- `rtk pnpm turbo run lint typecheck build --filter=@pubg-camp/worker` — PASS, 10/10 tasks.
- `rtk pnpm lint:boundaries` — PASS, 135 módulos e 266 dependências sem violações.
- `rtk pnpm verify:secrets` — PASS, 216 arquivos.
- `rtk gsd-sdk.cmd query verify.key-links .../02-08-PLAN.md` — PASS, 1/1 link.
- Scan da API por `resend`, `new Resend` e `emails.send` — vazio; nenhum e-mail inline.

## Known Stubs

None.

## Next Phase Readiness

- Processor e adapter estão prontos para os adapters de persistência/produção enfileirarem deliveries de OTP, convite e alertas.
- Deploy real requer `RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`, banco, Redis e chave AES configurados no ambiente seguro.

## Self-Check: PASSED

- Todos os key files declarados existem.
- Os commits `8427cd8`, `e0c9507` e `3ed3300` existem no histórico.
- Verification, key-link, stub scan e API inline-email scan passaram.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
