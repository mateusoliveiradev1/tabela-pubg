---
phase: 01-fundacao-modular-e-ambientes
plan: 03
subsystem: devops
tags: [docker, compose, github-actions, ci, security, documentation]
requires:
  - phase: 01-02
    provides: aplicações, health endpoints e migração
provides:
  - ambiente Compose com PostgreSQL, Redis, MinIO e aplicações
  - imagens multi-stage não-root
  - CI afetado e gates locais de segurança/migração
affects: [all-phases, deployment, contributors]
tech-stack:
  added: [docker-compose, github-actions, buildx]
  patterns: [frozen-lockfile, least-privilege-ci, non-root-images, executable-documentation]
key-files:
  created: [compose.yaml, docker/web.Dockerfile, docker/service.Dockerfile, .github/workflows/ci.yml, README.md]
  modified: [package.json]
key-decisions:
  - "O bot Discord usa profile opcional porque não pode ficar ready sem credencial real."
  - "A validação local do Compose degrada para checagem estrutural quando Docker não está instalado."
patterns-established:
  - "CI usa lockfile congelado, permissões read-only e build afetado."
  - "Cada imagem executa com UID/GID não privilegiados."
requirements-completed: [NFR-001, NFR-004, NFR-005, NFR-007, NFR-009, NFR-010]
duration: 9min
completed: 2026-08-20
---

# Phase 1 Plan 3: Ambiente e CI Summary

**Compose local, imagens não-root, CI por pacote afetado e documentação operacional executável**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-20T21:13:00Z
- **Completed:** 2026-08-20T21:22:00Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments

- Sete serviços declarados no Compose, todos com healthcheck e bind local.
- Imagens web e serviços multi-stage, com processo final sem root.
- CI read-only com install frozen, checks de segredo/migração/arquitetura, build afetado e matriz de imagens.

## Task Commits

1. **Criar ambiente local e imagens de produção** — `1a0a613` (chore)
2. **Adicionar CI e documentação de contribuição** — `16517c4` (chore)

## Files Created/Modified

- `compose.yaml` — ambiente local completo e healthchecks.
- `docker/web.Dockerfile` — standalone Next.js não-root.
- `docker/service.Dockerfile` — imagem parametrizada para API, worker e bot.
- `.github/workflows/ci.yml` — qualidade e matriz de imagens.
- `scripts/check-secrets.mjs` — assinaturas críticas em arquivos versionáveis.
- `scripts/check-migrations.mjs` — consistência entre SQL e journal.
- `README.md` — instalação, arquitetura e operação.

## Decisions Made

- `.env` local é opcional para a validação do Compose e obrigatório somente quando o usuário precisa sobrescrever defaults.
- O profile `discord` evita tratar um token falso como serviço saudável.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Validação do Compose sem Docker local**
- **Found during:** Task 1
- **Issue:** Docker CLI não está instalado nesta máquina.
- **Fix:** o verificador checa os sete serviços/healthchecks e executa `docker compose config` automaticamente quando o CLI existe.
- **Files modified:** `scripts/verify-compose.mjs`
- **Verification:** checagem estrutural passou; CI executará a validação semântica e os builds de imagem em runner Linux.
- **Committed in:** `1a0a613`

**Total deviations:** 1 auto-fixed (blocking). **Impact:** a ausência local fica explícita; nenhuma execução Docker foi simulada.

## Issues Encountered

- O subprocesso pnpm no Windows foi substituído por composição de scripts portável no `package.json`.

## User Setup Required

- Docker Desktop ou Docker Engine/Compose é necessário para `pnpm env:up`.
- Um token de bot de desenvolvimento é necessário apenas para o profile `discord`.

## Next Phase Readiness

- Todos os planos da Fase 1 foram executados; pronta para revisão e verificação de meta.

## Self-Check: PASSED

- `pnpm ci:verify` passou integralmente.
- Scanner analisou 98 arquivos; uma migração e sete serviços foram validados.
- Docker CLI indisponível foi reportado, sem afirmar build local de imagens.

---
*Phase: 01-fundacao-modular-e-ambientes*
*Completed: 2026-08-20*
