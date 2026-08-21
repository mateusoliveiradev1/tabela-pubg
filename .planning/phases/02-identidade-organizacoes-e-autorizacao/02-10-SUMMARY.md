---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 10
subsystem: supply-chain-security
tags: [npm, slopcheck, provenance, radix-ui, lucide, testing-library, playwright, axe]
requires:
  - phase: 01-fundacao-modular-e-ambientes
    provides: verificacao de segredos, hooks e politica fail-closed para dependencias
provides:
  - allowlist imutavel com os 12 nomes exatos de pacotes UI e teste
  - auditoria automatizada de proveniencia npm, integridade, scripts, idade e downloads
  - aprovacao humana bloqueante vinculada as versoes auditadas
affects: [02-11, web, ui, testing, accessibility, supply-chain]
tech-stack:
  added: []
  patterns: [exact-package-allowlist, fail-closed-provenance-audit, human-package-legitimacy-gate]
key-files:
  created:
    - scripts/audit-phase2-packages.mjs
  modified: []
key-decisions:
  - "A aprovacao humana libera somente os 12 nomes, versoes e proveniencias auditados; qualquer substituicao exige nova auditoria."
  - "Nenhum pacote e instalado pelo plano de legitimidade; a instalacao fica autorizada apenas para o plano 02-11."
patterns-established:
  - "Dependencias de UI e teste devem provar igualdade exata da allowlist antes de qualquer consulta de rede."
  - "Metadados do npm view e registry search precisam concordar, e slopcheck deve retornar OK sem flags."
requirements-completed: [NFR-005]
duration: 14min
completed: 2026-08-21
---

# Phase 2 Plan 10: Package Legitimacy Gate Summary

**Allowlist exata de 12 pacotes Radix, Lucide e testes aprovada apos auditoria fail-closed de proveniencia npm e slopcheck**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-21T03:14:25Z
- **Completed:** 2026-08-21T03:28:25Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- O auditor recusa nomes ausentes, extras ou duplicados antes de acessar a rede e cobre exatamente os 12 pacotes do checkpoint.
- Cada pacote teve versao, publisher, repositorio oficial, datas, downloads semanais, integridade, maintainers e scripts comparados entre fontes oficiais do npm.
- Os 12 resultados receberam verdict `OK` do slopcheck, sem flags e sem `postinstall`; nenhum pacote foi instalado neste plano.
- O usuario respondeu exatamente **"aprovado"**, liberando somente a lista e as versoes abaixo para o plano 02-11.

## Approved Package Set

| Pacote | Versao auditada | Repositorio oficial | postinstall | slopcheck |
|---|---:|---|---|---|
| `@radix-ui/react-alert-dialog` | `1.1.23` | `radix-ui/primitives` | ausente | OK |
| `@radix-ui/react-dialog` | `1.1.23` | `radix-ui/primitives` | ausente | OK |
| `@radix-ui/react-dropdown-menu` | `2.1.24` | `radix-ui/primitives` | ausente | OK |
| `@radix-ui/react-tabs` | `1.1.21` | `radix-ui/primitives` | ausente | OK |
| `@radix-ui/react-tooltip` | `1.2.16` | `radix-ui/primitives` | ausente | OK |
| `@radix-ui/react-toast` | `1.2.23` | `radix-ui/primitives` | ausente | OK |
| `lucide-react` | `1.33.0` | `lucide-icons/lucide` | ausente | OK |
| `@testing-library/react` | `16.3.2` | `testing-library/react-testing-library` | ausente | OK |
| `@testing-library/user-event` | `14.6.5` | `testing-library/user-event` | ausente | OK |
| `jsdom` | `30.0.1` | `jsdom/jsdom` | ausente | OK |
| `@playwright/test` | `1.62.1` | `microsoft/playwright` | ausente | OK |
| `@axe-core/playwright` | `4.13.0` | `dequelabs/axe-core-npm` | ausente | OK |

Esta aprovacao nao autoriza nomes alternativos, versoes diferentes nem pacotes adicionais. Qualquer alteracao reabre o gate de legitimidade.

## Task Commits

1. **Task 1: Automatizar metadados e slopcheck da lista exata**
   - `1069a06` - auditor fail-closed da allowlist de 12 pacotes
   - `2b3fab3` - coleta de proveniencia com retry limitado e verificacao cruzada
   - `25d5056` - agrupamento de consultas oficiais preservando validacao por nome exato
2. **Task 2: Aprovar pacotes oficiais Radix, Lucide e testes de interface**
   - Checkpoint humano concluido com a resposta `aprovado`; nenhum arquivo de producao foi modificado e nenhum pacote foi instalado.

## Files Created/Modified

- `scripts/audit-phase2-packages.mjs` - valida a allowlist exata e coleta metadados npm e verdicts slopcheck sem instalar dependencias.

## Decisions Made

- A aprovacao e restrita ao conjunto e as versoes apresentados na tabela; ela nao se estende automaticamente a atualizacoes futuras.
- Scripts `prepare` observados em `jsdom` e `@axe-core/playwright` foram registrados, mas nao constituem `postinstall`; a execucao de instalacao continua fora deste plano.
- O plano 02-11 pode instalar somente esses 12 pacotes aprovados e deve reabrir o gate diante de qualquer divergencia.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Estabilizada a coleta de proveniencia sob throttling do registry**
- **Found during:** Task 1
- **Issue:** consultas individuais ao endpoint de downloads sofriam throttling e impediam a auditoria completa dos 12 nomes.
- **Fix:** adotados retry limitado e o endpoint oficial de busca do registry, com verificacao cruzada de versao, publisher, repositorio e data contra `npm view`.
- **Files modified:** `scripts/audit-phase2-packages.mjs`
- **Verification:** auditoria completa retornou 12 resultados exatos, todos `OK`.
- **Committed in:** `2b3fab3`

**2. [Rule 3 - Blocking] Agrupadas consultas de pacotes com publisher oficial comum**
- **Found during:** Task 1
- **Issue:** o volume de consultas ainda podia exceder o limite do registry para pacotes Radix e Testing Library.
- **Fix:** consultas foram agrupadas por maintainer oficial, mantendo match unico por nome exato e cardinalidade 12.
- **Files modified:** `scripts/audit-phase2-packages.mjs`
- **Verification:** `--verify-exact-list` e `--json` passaram sem reduzir a cobertura.
- **Committed in:** `25d5056`

**Total deviations:** 2 auto-fixed (2 blocking). **Impact:** robustez operacional da mesma auditoria planejada, sem pacote adicional nem ampliacao de escopo.

## Issues Encountered

- O registry npm aplicou throttling durante a coleta inicial; retries limitados e agrupamento por proveniencia oficial resolveram o problema sem relaxar validacoes.

## Known Stubs

None. O unico arquivo de implementacao possui fontes reais conectadas (`npm view`, registry npm e slopcheck) e nao contem dados mockados ou placeholders funcionais.

## User Setup Required

None. A aprovacao humana ja foi fornecida e nenhuma credencial ou instalacao externa e necessaria neste plano.

## Next Phase Readiness

- O plano 02-11 esta autorizado a instalar exatamente as 12 dependencias e versoes registradas neste resumo.
- Qualquer divergencia no lockfile pretendido deve interromper a instalacao e repetir a auditoria humana.
- Nao ha bloqueadores remanescentes para o Package Legitimacy Gate.

## Self-Check: PASSED

- `scripts/audit-phase2-packages.mjs` e este SUMMARY existem no disco; os commits `1069a06`, `2b3fab3` e `25d5056` existem no historico.
- `rtk node scripts/audit-phase2-packages.mjs --verify-exact-list` confirmou cardinalidade 12 e igualdade exata de conjuntos.
- `rtk node scripts/audit-phase2-packages.mjs --json` retornou 12 proveniencias completas, sem `postinstall`, todas com slopcheck `OK` e sem flags.
- `package.json` e `pnpm-lock.yaml` permaneceram inalterados; nenhum pacote foi instalado.
- A varredura do arquivo de implementacao nao encontrou TODO, FIXME, placeholder ou dados mockados.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-21*
