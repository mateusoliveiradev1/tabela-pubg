# Plataforma comunitária de campeonatos PUBG PC

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Stack delegada para uma solução moderna, modular e preparada para evolução:

- **Monorepo:** pnpm workspaces e Turborepo, com limites de dependência verificados entre aplicações e pacotes.
- **Web:** Next.js App Router, React, TypeScript e Tailwind CSS. O mesmo aplicativo entrega site público, painel do organizador e páginas transparentes para o OBS.
- **API:** NestJS com adaptador Fastify, REST documentado por OpenAPI e canais de atualização em tempo real. A API começa como um monólito modular, com portas e adaptadores que permitem extrair módulos para serviços independentes quando houver necessidade real.
- **Processamento assíncrono:** aplicação worker separada, BullMQ e Redis para consultas agendadas, retentativas, deduplicação, notificações e geração de derivados.
- **Persistência:** PostgreSQL como fonte de verdade; Drizzle ORM para schema, consultas tipadas e migrações versionadas.
- **Arquivos:** armazenamento compatível com S3 para logos, banners, comprovantes e peças geradas.
- **Autenticação:** módulo próprio na API usando OAuth2 do Discord como entrada principal, e-mail como alternativa, sessões seguras e autorização por função e por campeonato.
- **Integrações:** PUBG Developer API, telemetria PUBG, Twitch Embed, Discord Bot API e obs-websocket.
- **OBS:** conector local pareado ao painel por código temporário; ele controla o OBS sem expor senha ou porta local à internet.
- **Qualidade:** Vitest, Playwright, testes de contrato, Testcontainers, OpenTelemetry, logs estruturados e rastreamento de erros.
- **Entrega:** contêineres Docker independentes para `web`, `api`, `worker` e `discord-bot`; CI por pacote afetado. Provedores de hospedagem permanecem substituíveis.

Estrutura pretendida:

```text
apps/
  web/             site público, painel e overlays
  api/             API e autorização
  worker/          PUBG, filas, agregações e derivados
  discord-bot/     automações do Discord
  obs-bridge/      conector local opcional do OBS
packages/
  domain/          entidades, eventos e políticas do negócio
  contracts/       DTOs, eventos e schemas compartilhados
  database/        schema, migrações e repositórios
  scoring/         motor de pontuação e desempates
  pubg/            cliente e normalização da PUBG API
  broadcast/       modelos de telas e comandos de exibição
  ui/              design system e componentes
  config/          TypeScript, lint, testes e observabilidade
```

## Users

- **Organizadores comunitários:** criam e administram campeonatos sem depender de planilhas, artes refeitas manualmente ou importação manual de resultados.
- **Equipe de operação:** administradores, árbitros, moderadores de inscrição, analistas e operadores de transmissão trabalham com permissões separadas.
- **Capitães e jogadores:** inscrevem equipes ou participam em solo, confirmam presença, consultam credenciais e acompanham histórico e desempenho.
- **Público da Twitch:** assiste à transmissão e consulta classificação, partidas, equipes e estatísticas em uma página pública coerente com a identidade do campeonato.

## Product Purpose

Permitir que qualquer organizador da comunidade realize um campeonato de PUBG PC do início ao fim: inscrições, check-in, etapas, salas no Discord, importação automática das partidas, pontuação, estatísticas, página pública e pacote profissional de transmissão para o OBS.

O produto nasce de um caso real: um streamer que organiza partidas personalizadas para amigos, cobra uma pequena inscrição via Pix e precisa produzir tabelas e materiais para a live. O sucesso significa reduzir sua operação manual ao tratamento de exceções, mantendo controle humano sobre disputas e sobre o que vai ao ar.

## Positioning

A plataforma combina três capacidades que normalmente ficam separadas: operação comunitária simples, apuração automática com dados oficiais do PUBG PC e apresentação pública com qualidade de broadcast. A automação é baseada em confiança verificável e para quando encontra divergências, em vez de publicar resultados duvidosos.

## Operating Context

Fluxo principal:

```text
criar campeonato
  -> configurar etapas, regras, identidade e Twitch
  -> abrir inscrições e aprovar pagamentos manualmente
  -> formar elencos, Discord e check-in
  -> disputar partida personalizada no PUBG
  -> detectar a partida por jogadores-sentinela
  -> validar, importar, calcular e publicar
  -> atualizar página, Discord e overlays
  -> avançar classificados até o campeão
```

O PUBG Developer API não cria nem controla salas personalizadas e não entrega dados públicos durante a partida. O produto trabalha com os resultados disponibilizados após a partida e mantém a classificação anterior enquanto uma queda está em andamento. A publicação é automática quando as verificações passam; divergências viram tarefas de revisão.

## Capabilities and Constraints

### Campeonato

- Formatos solo, duo e squad.
- Qualificatórias, grupos, semifinais e final.
- Avanço por grupo ou classificação geral, wildcards e opção de carregar ou zerar pontos.
- Pontuação por colocação e eliminação, bônus, penalidades e desempates configuráveis.
- Modelos de regras reutilizáveis, incluindo um modelo competitivo oficial como ponto de partida.

### Participação

- Solo se inscreve diretamente; capitão cadastra duo ou squad.
- Jogadores podem confirmar participação e reivindicar perfis posteriormente.
- Comprovante de Pix e aprovação manual na primeira versão; pagamento automático fica fora do escopo inicial.
- Login principal pelo Discord e alternativa por e-mail.

### Automação PUBG

- Três jogadores-sentinela confirmados, de equipes diferentes quando aplicável, são selecionados automaticamente e podem ser substituídos pelo organizador.
- O sistema usa `accountId`, cruza `matchId` e valida partida personalizada, horário, modo, mapa e elenco.
- Três sentinelas encontrados permitem processamento automático; dois enviam para nova tentativa ou revisão; um nunca publica automaticamente.
- A importação é idempotente e registra o payload original, a normalização, o cálculo e todas as revisões.

### Experiência pública e transmissão

- Página pública com Twitch incorporada, classificação, partidas, jogadores, equipes, regras e cronograma.
- Estatísticas principais: eliminações, dano total, dano médio, knocks, assistências, revives, sobrevivência e vitórias. Headshots não são uma métrica principal.
- Temas profissionais controlados; logo, banner, cores e patrocinadores são personalizáveis sem editor livre que comprometa legibilidade.
- Pacote completo para OBS em 1920x1080, usando fontes de navegador transparentes.
- Dados e telas atualizam automaticamente; mudança de cena é assistida por padrão e pode operar em sequência automática opcional.
- Primeira versão focada em Twitch e formato horizontal; formatos verticais não fazem parte do lançamento.

### Discord

- Bot publica avisos, inscrições, cronograma, resultados, classificação e cards.
- Cria categoria, cargos, canais privados de texto e voz por equipe, com permissões para elenco e organização.
- Distribui credenciais da sala no horário definido e arquiva a estrutura ao final.

### Restrições explícitas

- Não prometer estatísticas em tempo real durante a partida.
- Não copiar exatamente a identidade visual, marcas ou artes oficiais da PUBG, Twire ou Wasdefy.
- Nunca expor a chave da PUBG API, token do Discord ou senha do OBS no cliente.
- Nunca substituir resultado oficial ou decisão arbitral sem trilha de auditoria.

## Evidence on Hand

- Arte de referência fornecida pelo usuário: `C:/Users/Liiiraa/AppData/Local/Temp/codex-clipboard-9956f4d9-86d8-4af2-8f27-e0397dde5168.png`. Ela demonstra um campeonato solo comunitário de cinco partidas, inscrição via Pix e premiação distribuída.
- Referências de produto indicadas pelo usuário: Twire e Wasdefy. Servem como referência de organização da informação, não como identidade a ser copiada.
- Não há nome, logo, identidade visual final, domínio, depoimentos ou dados reais de campeonato disponíveis no repositório. Trabalho futuro não deve inventar esses ativos como fatos.

## Product Principles

1. **Automação por exceção:** o caminho comum termina sozinho; situações ambíguas param de forma visível e pedem revisão.
2. **Fonte única de verdade:** API, página pública, Discord e overlays consomem o estado versionado do campeonato, nunca calculam resultados independentemente.
3. **Operação simples, domínio completo:** o sistema esconde complexidade técnica sem empobrecer regras, fases ou auditoria.
4. **Broadcast legível primeiro:** personalização preserva contraste, hierarquia e leitura rápida em transmissão.
5. **Modularidade pragmática:** limites fortes e contratos estáveis desde o início, sem pagar antecipadamente o custo operacional de dezenas de microserviços.

## Accessibility & Inclusion

- Interface web responsiva, navegável por teclado e compatível com tecnologias assistivas.
- Contraste mínimo WCAG AA no painel e página pública; overlays priorizam contraste de transmissão e áreas seguras.
- Informações importantes não dependem somente de cor ou animação.
- Datas, horários e moeda usam `pt-BR` inicialmente, com estrutura preparada para localização futura.
