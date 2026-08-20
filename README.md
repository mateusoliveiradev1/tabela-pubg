# PUBG Camp Platform

Plataforma modular para organizar campeonatos comunitários de PUBG PC e, nas próximas fases, automatizar classificação, estatísticas, página pública, overlays OBS e Discord a partir de dados oficiais pós-partida.

## Estado atual

A Fase 1 entrega a fundação técnica. A página disponível agora é somente um diagnóstico do workspace; as telas de organização, página pública e transmissão serão construídas nas fases seguintes.

## Arquitetura

| Unidade | Porta | Responsabilidade |
|---|---:|---|
| `apps/web` | 3000 | Next.js App Router, páginas públicas e overlays futuros |
| `apps/api` | 3001 | API NestJS/Fastify e coordenação transacional |
| `apps/worker` | 3002 | Jobs BullMQ, importação PUBG e projeções futuras |
| `apps/discord-bot` | 3003 | Automação Discord futura; ativada por profile no Compose |
| PostgreSQL | 5432 | Fonte única de verdade e outbox |
| Redis | 6379 | Filas, locks e distribuição de eventos |
| MinIO | 9000/9001 | Armazenamento S3 local e console |

Pacotes compartilhados vivem em `packages/`. O domínio é puro; aplicações não importam outras aplicações; banco, fila e storage são adaptadores substituíveis. Essas fronteiras são executadas por `dependency-cruiser`.

## Pré-requisitos

- Node.js 24 ou superior
- pnpm 11 (o Corepack pode ativá-lo)
- Docker com Compose v2 para o ambiente completo

## Instalação sem Docker

```bash
corepack enable
pnpm install
pnpm ci:verify
```

Os builds e testes não exigem serviços externos. Readiness retorna `503` enquanto PostgreSQL/Redis não estiverem acessíveis; liveness continua em `200`.

## Ambiente local completo

```bash
copy .env.example .env
pnpm env:up
```

No macOS/Linux use `cp .env.example .env`. O comando constrói as imagens, sobe PostgreSQL, Redis, MinIO, API, web e worker e executa a migração antes da API. O bot Discord é opcional porque requer credencial:

```bash
docker compose --profile discord up --build -d
```

Nunca reutilize as credenciais locais do exemplo em produção.

## Health e readiness

- Web: `/api/health/live` e `/api/health/ready`
- API, worker e bot: `/health/live` e `/health/ready`

Liveness indica que o processo responde. Readiness verifica as dependências necessárias e deve ser usada pelo orquestrador antes de enviar tráfego.

## Comandos

| Comando | Uso |
|---|---|
| `pnpm dev` | executa aplicações em modo watch |
| `pnpm lint` | Biome e limites arquiteturais |
| `pnpm typecheck` | TypeScript estrito em todo o workspace |
| `pnpm test` | testes Vitest |
| `pnpm build` | builds de produção |
| `pnpm verify:migrations` | journal e schema Drizzle |
| `pnpm verify:secrets` | scanner local de assinaturas sensíveis |
| `pnpm verify:compose` | estrutura e, quando disponível, `docker compose config` |
| `pnpm ci:verify` | gate local completo |
| `pnpm env:down` | encerra contêineres mantendo volumes |

## Migrações

O schema fica em `packages/database/src/schema.ts` e as migrações em `packages/database/migrations`.

```bash
pnpm --filter @pubg-camp/database db:generate
pnpm verify:migrations
pnpm --filter @pubg-camp/database db:migrate
```

Toda alteração de schema deve acompanhar migração e passar pelo verificador antes do commit.

## Planejamento

- [Visão do produto](./PRODUCT.md)
- [Requisitos](./.planning/REQUIREMENTS.md)
- [Roadmap](./.planning/ROADMAP.md)

Consulte [CONTRIBUTING.md](./CONTRIBUTING.md) antes de alterar dependências, limites ou schema.
