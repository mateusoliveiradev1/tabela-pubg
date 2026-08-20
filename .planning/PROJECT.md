# Plataforma comunitária de campeonatos PUBG PC

## Core Value

Reduzir o trabalho manual e os erros de quem organiza campeonatos comunitários de PUBG PC, transformando dados oficiais pós-partida em classificação, estatísticas, páginas públicas, overlays e ações operacionais auditáveis.

## Current State

Projeto greenfield. A visão, os requisitos e o roadmap v1 estão aprovados; a Fase 1 inicia a fundação modular e os ambientes reproduzíveis.

## Requirements

- Suportar múltiplas organizações e campeonatos com regras próprias.
- Usar a API oficial do PUBG após cada partida, com detecção segura por três jogadores-sentinela.
- Manter banco, classificação, estatísticas e eventos de saída consistentes.
- Entregar página pública, Twitch, pacote OBS e Discord automatizado em fases posteriores.
- Permitir evolução independente de web, API, workers e bot.

## Architecture Direction

- Monorepo TypeScript com pnpm e Turborepo.
- Next.js App Router para web e overlays.
- NestJS com Fastify para API; processos separados para worker e bot Discord.
- PostgreSQL com Drizzle, Redis/BullMQ e armazenamento S3 compatível.
- Contratos, configuração, telemetria e domínio em pacotes explícitos.
- Outbox transacional como base da automação orientada a eventos.

## Evolution Rules

- O domínio não importa infraestrutura nem aplicações.
- Aplicações dependem de contratos e portas; integrações externas ficam atrás de adaptadores.
- Segredos nunca entram no repositório.
- Mudanças de esquema incluem migração verificável.
- Cada etapa funcional deve ser pequena, testável e registrada em commit atômico.

## Validated Requirements

Nenhum requisito validado ainda.

---
Last updated: 2026-08-20
