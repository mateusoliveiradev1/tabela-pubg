# Itens adiados da Fase 2

## Plano 02-06

- O `apps/api/tsconfig.build.json` existente inclui arquivos `*.spec.ts` no output `dist/`, fazendo o Vitest executar as novas specs uma vez em TypeScript e outra em JavaScript depois de um build local. Os testes permanecem verdes e o problema não altera o código de produção, mas a configuração de build/test deve excluir specs em um plano de tooling dedicado.
