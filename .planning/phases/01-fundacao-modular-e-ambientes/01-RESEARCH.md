# Pesquisa técnica — Fase 1

## Versões e compatibilidade

- Node.js 24 LTS disponível localmente; o projeto declara Node `>=24`.
- pnpm 11 e Turborepo 2 formam a base do workspace.
- Next.js 16 App Router usa runtime Node por padrão e `output: standalone` para imagens menores.
- NestJS 11 com `FastifyAdapter` mantém a API modular e eficiente.
- Drizzle mantém schema e migrações TypeScript explícitas.

## Padrões selecionados

- Pacotes internos são módulos ESM compilados para `dist` e consumidos por `workspace:*`.
- O pacote `domain` é puro e não pode importar aplicações ou infraestrutura.
- `contracts` contém schemas Zod serializáveis; não contém acesso a banco.
- `config`, `logger` e `observability` são capacidades transversais pequenas.
- A outbox reside na mesma transação do dado de negócio e expõe status de entrega, tentativas e próximo retry.
- Serviços usam `/health/live` e `/health/ready`; a web usa rotas equivalentes sob `/api`.

## Riscos e mitigação

- **Muitas ferramentas cedo:** limitar pacotes compartilhados a responsabilidades reais e manter apps mínimos.
- **Build ESM incompatível:** padronizar `NodeNext`, exports explícitos e verificar todos os pacotes no CI.
- **Migração divergente:** versionar a primeira migração, incluir `drizzle-kit check` e teste estrutural do schema.
- **Segredos acidentais:** somente `.env.example`, ignore de `.env*` com exceção explícita e scanner no CI.
- **Docker indisponível localmente:** validar Compose por estrutura e manter healthchecks; registrar a limitação sem simular execução.

## Decisão de UI-SPEC

Não é necessária nesta fase: existe uma aplicação web técnica, mas nenhum fluxo ou tela de produto será desenhado. O contrato visual completo pertence às fases 6 e 7.
