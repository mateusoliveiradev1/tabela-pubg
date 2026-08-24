# Itens adiados da Fase 2

## Plano 02-06

- O `apps/api/tsconfig.build.json` existente inclui arquivos `*.spec.ts` no output `dist/`, fazendo o Vitest executar as novas specs uma vez em TypeScript e outra em JavaScript depois de um build local. Os testes permanecem verdes e o problema não altera o código de produção, mas a configuração de build/test deve excluir specs em um plano de tooling dedicado.

## Plano 02-24

- O run CI final passou smoke e E2E completo, porém o console do Chromium registrou um hydration mismatch não bloqueante em `apps/web/src/components/identity/device-session-card.tsx`: o servidor formatou datas em UTC e o cliente em America/Sao_Paulo. Corrigir em um plano de UI/tooling dedicado com formatação determinística entre SSR e hidratação.

## Plano 02-29

- O lint web permanece verde com três avisos preexistentes de `noImportantStyles` no bloco `prefers-reduced-motion` de `apps/web/src/app/globals.css`. O plano não alterou CSS; revisar a exceção de acessibilidade ou a configuração Biome pertence ao plano visual/tooling correspondente.

## Plano 02-27

- O gate completo `pnpm phase2:integration` passou 3/4 arquivos e 19 testes contra Neon direto + Redis loopback, mas `runtime-security-migration.integration.spec.ts` excedeu o `hookTimeout` preexistente de 30 segundos durante o setup de múltiplos schemas (4 casos ficaram skipped). A suíte lifecycle do plano passou isoladamente com 7/7 casos; ajustar o orçamento do harness/migrations pertence a um plano de tooling e não ao lifecycle de sessões.

## Plano 02-36

- O gate focal real de 02-36 passou 25/25 casos contra branch Neon isolada e Redis loopback. A suíte ampla `phase2:integration` manteve 43 casos verdes, mas `identity-security-change.integration.spec.ts` excedeu o `testTimeout` preexistente de 15 segundos e `runtime-security-migration.integration.spec.ts` excedeu o `hookTimeout` preexistente de 30 segundos sob a latência Neon. Uma repetição com conexão direta eliminou as falhas de isolamento vistas no endpoint pooled, mas preservou esses dois timeouts; ajustar orçamentos do harness permanece fora do escopo dos endpoints OTP.

## Plano 02-33

- O gate amplo `pnpm phase2:integration` passou o preflight e 38 casos, mas manteve falhas fora do escopo dos providers: `runtime-security-migration.integration.spec.ts` excedeu o `hookTimeout` de 30 segundos, `identity-security-change.integration.spec.ts` excedeu o `testTimeout` de 15 segundos e quatro casos concorrentes tentaram consultar relações depois que seus hooks/schemas falharam. Os 11 testes focais de 02-33, o seed real e o cleanup exato passaram em branch Neon isolada e Redis loopback.
