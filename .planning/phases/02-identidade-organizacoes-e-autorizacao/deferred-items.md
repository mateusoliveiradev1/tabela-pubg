# Itens adiados da Fase 2

## Plano 02-06

- O `apps/api/tsconfig.build.json` existente inclui arquivos `*.spec.ts` no output `dist/`, fazendo o Vitest executar as novas specs uma vez em TypeScript e outra em JavaScript depois de um build local. Os testes permanecem verdes e o problema não altera o código de produção, mas a configuração de build/test deve excluir specs em um plano de tooling dedicado.

## Plano 02-24

- O run CI final passou smoke e E2E completo, porém o console do Chromium registrou um hydration mismatch não bloqueante em `apps/web/src/components/identity/device-session-card.tsx`: o servidor formatou datas em UTC e o cliente em America/Sao_Paulo. Corrigir em um plano de UI/tooling dedicado com formatação determinística entre SSR e hidratação.

## Plano 02-27

- O gate completo `pnpm phase2:integration` passou 3/4 arquivos e 19 testes contra Neon direto + Redis loopback, mas `runtime-security-migration.integration.spec.ts` excedeu o `hookTimeout` preexistente de 30 segundos durante o setup de múltiplos schemas (4 casos ficaram skipped). A suíte lifecycle do plano passou isoladamente com 7/7 casos; ajustar o orçamento do harness/migrations pertence a um plano de tooling e não ao lifecycle de sessões.
