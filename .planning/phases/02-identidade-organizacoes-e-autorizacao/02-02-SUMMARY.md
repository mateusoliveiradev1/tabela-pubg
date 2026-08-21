---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 02
subsystem: identity-contracts-config
tags: [zod, contracts, oauth, otp, sessions, organizations, audit, redaction, tdd]
requires:
  - phase: 02-identidade-organizacoes-e-autorizacao
    plan: 01
    provides: IDs nominais, políticas temporais e vocabulário de autorização default-deny
provides:
  - contratos HTTP estritos para identidade, sessões, organizações, convites e auditoria
  - projeções discriminadas sem tokens, digests, códigos ou payloads cifrados
  - configuração de boot segura para OAuth, PKCE, cookies, CSRF, OTP, criptografia, Redis e e-mail
affects: [api, web, worker, organizations, audit, security]
tech-stack:
  added: []
  patterns: [strict-zod-boundaries, credential-free-dtos, fail-closed-config, field-name-only-errors]
key-files:
  created:
    - packages/contracts/src/identity.ts
    - packages/contracts/src/organizations.ts
    - packages/contracts/src/audit.ts
    - packages/contracts/src/identity.test.ts
    - packages/contracts/src/organizations.test.ts
    - packages/contracts/src/audit.test.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/config/src/index.ts
    - packages/config/src/index.test.ts
    - .env.example
key-decisions:
  - "Schemas HTTP usam objetos strict e respostas allowlisted para rejeitar campos secretos por construção."
  - "O contexto opaco de alerta de sessão existe somente no request server-side; a resposta revela apenas active, revoked, expired ou not-found."
  - "PKCE é required por padrão; documented-exception exige identificador interno, mas warnings nunca o exibem."
patterns-established:
  - "Entradas e saídas HTTP possuem schemas distintos; credenciais transitórias nunca pertencem aos DTOs de resposta."
  - "Configuração inválida informa somente nomes de campos e aplica redaction por chave antes de qualquer log."
requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-006, ORG-001, ORG-002, AUD-001, NFR-005]
duration: 8min
completed: 2026-08-21
---

# Phase 2 Plan 2: Contratos HTTP e configuração segura Summary

**Schemas Zod estritos e DTOs sem credenciais, com boot fail-closed para OAuth, sessão, OTP, PKCE e criptografia**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-21T02:56:10Z
- **Completed:** 2026-08-21T03:04:10Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Identidade, OAuth, OTP, vinculação, step-up e sessões agora possuem contratos compartilhados e discriminados, incluindo o fluxo de alerta de novo dispositivo sem expor identificadores internos.
- Organizações, membros, assignments, convites e transferência de ownership usam formas explícitas e estritas compatíveis com os estados completos do UI-SPEC.
- Auditoria expõe apenas atores mascarados e mudanças allowlisted, enquanto a configuração falha no boot para segredos fracos, PKCE incoerente ou transporte inseguro em produção.

## Task Commits

1. **Definir contratos de identidade, organizações e auditoria**
   - `3827c1a` — testes RED para os contratos HTTP e projeções sem segredos
   - `e3bbaa3` — implementação GREEN dos schemas e tipos inferidos
2. **Endurecer configuração e redaction da fase**
   - `e7407de` — testes RED para PKCE, TLS, segredos e redaction
   - `75c990d` — implementação GREEN da configuração segura e catálogo de ambiente
   - `9251de9` — correção do tipo do default transformado de cookie seguro

## Files Created/Modified

- `packages/contracts/src/identity.ts` — OAuth, OTP, identidades, step-up, sessões e contexto opaco de alerta.
- `packages/contracts/src/organizations.ts` — organizações, memberships, assignments, convites e ownership.
- `packages/contracts/src/audit.ts` — consulta paginada e projeção allowlisted/mascarada da auditoria.
- `packages/contracts/src/index.ts` — reexporta os três novos módulos públicos.
- `packages/contracts/src/identity.test.ts` — resposta OTP uniforme e ausência de credenciais em sessões/identidades.
- `packages/contracts/src/organizations.test.ts` — estados de convite, papéis globais e assignments escopados.
- `packages/contracts/src/audit.test.ts` — paginação limitada, PII mascarada e rejeição de ciphertext.
- `packages/config/src/index.ts` — schema completo da fase, validações cruzadas e warnings/redaction seguros.
- `packages/config/src/index.test.ts` — matriz negativa de boot, produção, PKCE e vazamento de valores.
- `.env.example` — catálogo sem valores reais para todos os controles operacionais da fase.

## Decisions Made

- Contextos opacos de alertas e convites são aceitos somente em requests server-side; respostas usam estados discriminados e não ecoam contexto ou IDs internos.
- Auditoria não aceita JSON livre em `before/after`: campos e valores de apresentação são allowlisted, limitados e PII permanece mascarada.
- Produção exige origem e redirect HTTPS, cookie `Secure`, segredos fortes e distintos e chave AES-256-GCM versionada como `v1`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrigido o tipo do default de cookie seguro após transformação Zod**
- **Found during:** verificação geral após Task 2
- **Issue:** `StringBooleanSchema` transforma string em boolean, mas o default inicial foi declarado como string; os testes de runtime passavam, porém o typecheck combinado falhava.
- **Fix:** alterado o default para o booleano `false`, preservando a entrada textual de ambiente e o tipo inferido correto.
- **Files modified:** `packages/config/src/index.ts`
- **Verification:** `pnpm turbo run test typecheck lint` passou nos dois pacotes.
- **Committed in:** `9251de9`

**Total deviations:** 1 auto-fixed (1 bug). **Impact:** correção estritamente necessária para consistência de tipos; nenhum aumento de escopo.

## Issues Encountered

None.

## Known Stubs

None. A varredura dos arquivos criados/modificados não encontrou placeholders, TODOs ou dados mockados fluindo para respostas.

## User Setup Required

None para este plano. O `.env.example` documenta os campos que os planos de integração preencherão com segredos reais fora do repositório.

## Next Phase Readiness

- API, worker e web podem importar contratos estáveis sem duplicar formas ou transportar credenciais para o navegador.
- Planos seguintes podem estender `Phase2EnvSchema` no composition root e receber a configuração já validada, sem ler `process.env` nos casos de uso.
- Nenhum endpoint, schema de banco ou nova dependência externa foi introduzido.

## Self-Check: PASSED

- Os 6 arquivos de contrato/teste criados e o SUMMARY existem no disco; os commits `3827c1a`, `e3bbaa3`, `e7407de`, `75c990d` e `9251de9` existem no histórico.
- 20 testes passaram; lint e typecheck passaram para `@pubg-camp/contracts` e `@pubg-camp/config`.
- `pnpm verify:secrets` passou para 148 arquivos rastreados/não ignorados.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
