# Requisitos — plataforma comunitária de campeonatos PUBG PC

**Versão:** definição inicial do produto  
**Data:** 2026-08-20  
**Estado:** aprovado para planejamento

## Convenções

- “Deve” indica requisito obrigatório para o lançamento v1.
- A fonte de verdade é o banco de dados da plataforma; integrações apenas alimentam ou consomem esse estado.
- Toda correção administrativa que altere resultado, pontuação, inscrição ou permissão deve gerar auditoria.

## Estado de validação da Fase 2

| Requisito | Estado | Evidência de encerramento |
|---|---|---|
| AUTH-001 | Concluído | Login Discord OAuth2 real com redirect exato, state/browser binding e PKCE S256 required aprovado. |
| AUTH-002 | Concluído | O plano 02-36 publicou sign-in OTP real que persiste sessão trusted e alerta de novo dispositivo antes de cookie/CSRF. |
| AUTH-003 | Bloqueado | Token opaco, trust/touch, enforcement global, step-up email/Discord bound e rotação/revogação D-08 atômica foram fechados nos planos 02-27/02-35/02-36/02-37/02-42; ainda faltam rotas reais de gestão de sessões. |
| AUTH-004 | Concluído | Memberships independentes permitem várias organizações e assignments aceitam escopo explícito. |
| AUTH-005 | Bloqueado | A matriz default-deny e o gate trust-first existem, mas o BFF ainda não fornece o contexto tenant necessário ao caminho autorizado. |
| AUTH-006 | Concluído | Tokens, codes, cookies e contextos permaneceram fora de DOM, JSON público, URL e logs persistidos; o evento D-08 do plano 02-42 também é allowlisted e redigido. |
| ORG-001 | Concluído | Criação/persistência e membros existem; CSP e convite compartilham allowlist exata para a logo externa assinada. |
| ORG-002 | Bloqueado | O plano 02-36 provou aceite somente para o e-mail confirmado após promoção provisional, mas gestão de convites/revogações ainda não completa o fluxo real sem contexto tenant. |
| ORG-003 | Bloqueado | Os seis papéis estão modelados, mas a gestão real via BFF falha sem contexto tenant. |
| ORG-004 | Concluído | Matriz de menor privilégio sem wildcard e default-deny verificada por testes. |
| ORG-005 | Concluído | Lock e testes concorrentes protegem o último proprietário e exigem transferência explícita. |
| AUD-001 | Concluído | Auditoria transacional grava autor, data, motivo e valores anterior/novo sanitizados. |
| NFR-005 | Bloqueado | CSP, compensação pós-commit, outbox, lifecycle, trust-first authorization, OTP/OAuth duráveis e atomicidade D-08 foram fechados; persistem gaps em gestão de identidade/sessão, tenant no BFF e revalidação final. |

**Fase 2:** 35/42 planos executados; verificação em `gaps_found` (8/13 requisitos). O plano 02-37 fechou OAuth autenticado e o wiring BFF purpose-specific; NFR-005 permanece bloqueado pelos demais fluxos runtime e pela revalidação final.

## 1. Contas, organizações e acesso

- **AUTH-001:** permitir login com Discord OAuth2.
- **AUTH-002:** oferecer e-mail como alternativa de acesso e recuperação.
- **AUTH-003:** manter sessões revogáveis, expiração segura e proteção contra reutilização de credenciais.
- **AUTH-004:** permitir que uma pessoa participe de várias organizações e campeonatos.
- **AUTH-005:** aplicar autorização por organização e por campeonato, negando por padrão.
- **AUTH-006:** nunca expor tokens da PUBG, Discord, Twitch ou OBS no navegador.
- **ORG-001:** permitir criar uma organização de campeonatos com nome, logo e membros.
- **ORG-002:** permitir convidar membros e revogar acesso.
- **ORG-003:** oferecer funções de proprietário, administrador, árbitro, inscrições, operador de transmissão e analista.
- **ORG-004:** restringir cada função ao menor conjunto de permissões necessário.
- **ORG-005:** impedir que o último proprietário abandone ou perca controle da organização sem transferência explícita.

## 2. Campeonatos, etapas e agenda

- **CMP-001:** criar campeonatos solo, duo ou squad.
- **CMP-002:** configurar nome, slug público, logo, banner, descrição, regulamento, Twitch, patrocinadores, datas e fuso horário.
- **CMP-003:** suportar estados rascunho, inscrições abertas, confirmado, em andamento, pausado, concluído e arquivado.
- **CMP-004:** criar qualificatórias, grupos, semifinais e final em qualquer ordem válida.
- **CMP-005:** permitir vários grupos e várias partidas em cada etapa.
- **CMP-006:** configurar avanço por melhores de cada grupo, classificação geral e wildcards.
- **CMP-007:** permitir zerar pontos ou carregar pontos entre etapas.
- **CMP-008:** bloquear alterações estruturais destrutivas depois do início sem confirmação reforçada e auditoria.
- **CMP-009:** publicar cronograma, mapas e situação de cada partida.
- **CMP-010:** preservar o histórico de participantes, etapas e classificações já encerradas.

## 3. Regras, pontuação e desempates

- **SCR-001:** configurar pontos por colocação para todas as posições aplicáveis.
- **SCR-002:** configurar valor de cada eliminação.
- **SCR-003:** permitir bônus, penalidades e ajustes com motivo obrigatório.
- **SCR-004:** configurar uma ordem de critérios de desempate.
- **SCR-005:** oferecer modelos reutilizáveis de regras, incluindo um modelo competitivo oficial de referência.
- **SCR-006:** versionar regras; partidas já aprovadas permanecem ligadas à versão usada no cálculo.
- **SCR-007:** recalcular de forma determinística quando uma partida ou ajuste autorizado mudar.
- **SCR-008:** armazenar detalhamento de pontos de colocação, eliminações, bônus, penalidades e total.
- **SCR-009:** produzir o mesmo resultado para o mesmo conjunto de entradas, independentemente da interface consumidora.

## 4. Inscrições, elencos e pagamentos

- **REG-001:** em solo, permitir que o próprio jogador se inscreva.
- **REG-002:** em duo e squad, permitir que o capitão crie a equipe e cadastre o elenco.
- **REG-003:** validar nick PUBG PC e persistir o `accountId` encontrado.
- **REG-004:** permitir que jogadores confirmem participação por link e reivindiquem perfil posteriormente.
- **REG-005:** controlar inscrições pendentes, confirmadas, recusadas, canceladas e em lista de espera.
- **REG-006:** receber comprovante de Pix e permitir aprovação ou recusa manual com observação.
- **REG-007:** registrar capitão, titulares, reservas, slot e histórico de substituições.
- **REG-008:** permitir prazo de alteração de elenco e exigir aprovação depois dele.
- **REG-009:** impedir o mesmo `accountId` em duas inscrições incompatíveis no mesmo campeonato/etapa.
- **REG-010:** permitir exportação operacional da lista de inscritos.
- **PAY-001:** pagamentos automáticos não fazem parte da v1; o desenho do domínio não deve impedir integração futura.

## 5. Check-in e operação da partida

- **OPS-001:** abrir e fechar check-in em horários configuráveis.
- **OPS-002:** registrar presença por jogador ou equipe conforme formato.
- **OPS-003:** destacar ausentes e permitir substituição autorizada.
- **OPS-004:** liberar ID e senha da sala apenas a participantes confirmados e equipe autorizada, no horário definido.
- **OPS-005:** registrar quem visualizou as credenciais e quando.
- **OPS-006:** manter estado da partida: agendada, check-in, sala aberta, em andamento, aguardando API, revisão, aprovada, publicada ou cancelada.
- **OPS-007:** permitir pausar automações de uma partida sem interromper o campeonato inteiro.

## 6. Integração PUBG e detecção segura

- **PUBG-001:** manter a chave PUBG exclusivamente no servidor.
- **PUBG-002:** selecionar automaticamente três jogadores-sentinela confirmados; em duo/squad, preferir equipes diferentes.
- **PUBG-003:** permitir substituir sentinelas antes da partida e manter histórico da escolha.
- **PUBG-004:** consultar os sentinelas em lote durante a janela configurada, respeitando limites e retentativas da API.
- **PUBG-005:** aceitar como candidato apenas um `matchId` novo compatível com a janela da partida.
- **PUBG-006:** validar `isCustomMatch`, plataforma, horário, modo, mapa, duração e participantes.
- **PUBG-007:** com 3/3 sentinelas e demais validações aprovadas, importar automaticamente.
- **PUBG-008:** com 2/3 sentinelas, repetir consultas e, ao expirar a janela, enviar para revisão.
- **PUBG-009:** com 1/3 sentinelas, nunca publicar automaticamente.
- **PUBG-010:** buscar partida e telemetria, armazenando o payload original e sua versão normalizada.
- **PUBG-011:** impedir processamento duplicado por `matchId` e tornar jobs idempotentes.
- **PUBG-012:** permitir busca forçada e vinculação manual de `matchId` por pessoa autorizada.
- **PUBG-013:** manter último estado válido se a API estiver indisponível e exibir defasagem no painel.
- **PUBG-014:** não afirmar nem simular atualização ao vivo durante a partida.
- **PUBG-015:** registrar erros, tentativas, latência de disponibilização e motivo de revisão.

## 7. Resultados, estatísticas e auditoria

- **RES-001:** agrupar participantes por roster/equipe e calcular colocação e eliminações da partida.
- **RES-002:** calcular classificação da etapa e geral conforme versão das regras.
- **RES-003:** permitir aprovação, rejeição e correção administrativa com motivo.
- **RES-004:** permitir penalidades por equipe, jogador, partida ou etapa.
- **RES-005:** calcular eliminações, dano total, dano médio por partida, knocks, assistências, revives, sobrevivência e vitórias.
- **RES-006:** não tratar headshots como indicador principal da plataforma.
- **RES-007:** oferecer totais e detalhamento por partida, etapa, jogador e equipe.
- **RES-008:** marcar dados incompletos ou indisponíveis em vez de substituí-los por zero enganoso.
- **AUD-001:** registrar autor, data, motivo, valor anterior e novo em ações sensíveis.
- **AUD-002:** preservar histórico de versões de regras, resultados e classificações publicadas.
- **AUD-003:** permitir consulta da trilha por árbitro e administrador.

## 8. Página pública

- **PUB-001:** gerar URL pública estável por campeonato.
- **PUB-002:** oferecer abas Visão geral, Classificação, Partidas, Jogadores, Equipes e Regras.
- **PUB-003:** incorporar Twitch configurada, atendendo requisitos de domínio do embed.
- **PUB-004:** durante transmissão ativa, priorizar player e informações da competição; após a live, priorizar resultados.
- **PUB-005:** exibir classificação com posição, participante, partidas, vitórias, eliminações, colocação, penalidades e total.
- **PUB-006:** exibir líderes de eliminações, dano e demais indicadores habilitados.
- **PUB-007:** oferecer páginas individuais de jogador e equipe, com histórico por partida.
- **PUB-008:** oferecer detalhe de cada partida com mapa, vencedor, classificação e estatísticas.
- **PUB-009:** atualizar consumidores conectados sem recarregar a página.
- **PUB-010:** exibir horário/idade do último dado e estado de processamento.
- **PUB-011:** ser responsiva para desktop e celular, com navegação por teclado e contraste WCAG AA.
- **PUB-012:** produzir metadados e cards compartilháveis sem inventar dados ausentes.

## 9. Identidade e personalização

- **BRD-001:** oferecer três ou quatro temas profissionais controlados.
- **BRD-002:** permitir logo, banner, cor de destaque, patrocinadores e ativos autorizados.
- **BRD-003:** sugerir paleta a partir da logo e ajustar contraste automaticamente.
- **BRD-004:** aplicar a identidade escolhida de forma consistente em página, cards e overlays.
- **BRD-005:** impedir configurações que tornem texto ou pontuação ilegíveis.
- **BRD-006:** não fornecer editor livre de posicionamento na v1.
- **BRD-007:** não copiar a identidade visual oficial da PUBG nem de plataformas de referência.

## 10. Pacote de transmissão e OBS

- **OBS-001:** fornecer overlays transparentes em 1920x1080 como URLs de fonte de navegador.
- **OBS-002:** manter conexão de atualização e reconectar sem intervenção após queda de rede.
- **OBS-003:** oferecer abertura, contagem regressiva, agenda, mapas, equipes, escalações, próxima partida, classificação completa/compacta, resultado da queda, vencedor, líderes, destaques, comparação, lower thirds, ticker, processamento, intervalo, classificados, pódio, campeão e encerramento.
- **OBS-004:** permitir habilitar somente as telas usadas pelo campeonato.
- **OBS-005:** oferecer painel com prévia e botão de colocar no ar.
- **OBS-006:** manter modo assistido como padrão e modo automático configurável.
- **OBS-007:** permitir sequências automáticas com duração, transição e condição de interrupção.
- **OBS-008:** integrar opcionalmente ao obs-websocket para trocar cenas e visibilidade de fontes.
- **OBS-009:** parear o conector local por código temporário e nunca armazenar a senha do OBS no servidor.
- **OBS-010:** manter áreas seguras e animações respeitando legibilidade e desempenho.
- **OBS-011:** focar Twitch e formato horizontal; versões verticais ficam fora da v1.

## 11. Discord

- **DSC-001:** instalar bot em servidor autorizado via OAuth2 e solicitar somente permissões necessárias.
- **DSC-002:** permitir mapear canais para anúncios, inscritos, check-in, resultados, alertas internos e transmissão.
- **DSC-003:** publicar inscrições, cronograma, lembretes, resultados, classificação, cards e links públicos.
- **DSC-004:** alertar árbitros sobre divergências e partidas aguardando revisão.
- **DSC-005:** criar categoria do campeonato, cargos por equipe e canais privados de texto e voz.
- **DSC-006:** conceder acesso apenas ao elenco, capitão e equipe autorizada.
- **DSC-007:** distribuir credenciais da sala no canal privado no horário definido.
- **DSC-008:** permitir renomear canais por slot/etapa e arquivar estrutura ao concluir.
- **DSC-009:** tolerar remoção manual de canal/cargo e oferecer reconciliação segura.
- **DSC-010:** registrar falhas e ações do bot sem expor tokens ou conteúdo privado indevido.

## 12. Requisitos não funcionais

- **NFR-001 — Consistência:** uma publicação de resultado deve atualizar banco, classificação e eventos de saída de forma transacional ou por outbox confiável.
- **NFR-002 — Disponibilidade:** página e overlay exibem o último estado válido durante falhas temporárias.
- **NFR-003 — Desempenho:** página pública deve permanecer rápida mesmo com transmissão incorporada; dados críticos carregam independentemente do player.
- **NFR-004 — Escala:** workers e bot podem escalar independentemente da API e do web.
- **NFR-005 — Segurança:** aplicar segredo fora do código, criptografia em trânsito, rate limiting, validação de entrada, uploads restritos e menor privilégio.
- **NFR-006 — Privacidade:** comprovantes e dados internos nunca são públicos; acesso expira conforme política definida.
- **NFR-007 — Observabilidade:** métricas para consultas PUBG, latência de publicação, jobs, conexões de overlay, eventos Discord e falhas OBS.
- **NFR-008 — Recuperação:** backups do PostgreSQL e teste periódico de restauração.
- **NFR-009 — Portabilidade:** aplicações entregues em contêiner e integrações atrás de adaptadores substituíveis.
- **NFR-010 — Testabilidade:** motor de pontuação, matching de partidas, progressão de etapas e autorização têm testes determinísticos.

## 13. Fora do escopo v1

- Criação ou controle da sala personalizada dentro do PUBG.
- Estatísticas públicas em tempo real durante a partida.
- Confirmação automática de Pix ou divisão automática da premiação.
- Aplicativos nativos para celular.
- Overlays verticais para TikTok, Shorts ou Reels.
- Editor visual livre de arrastar e redimensionar.
- Cópia exata de layouts ou marcas de PUBG, Twire ou Wasdefy.
- Marketplace, fantasy league ou ranking global entre campeonatos.

## 14. Critérios de lançamento v1

O lançamento acontece quando um campeonato piloto consegue, sem planilha externa:

1. Abrir inscrições, aprovar comprovantes e fechar elencos.
2. Executar check-in e distribuir credenciais com segurança.
3. Realizar múltiplas etapas e avançar classificados.
4. Detectar e processar partidas por três sentinelas com tratamento de exceções.
5. Publicar classificação e estatísticas coerentes na página pública.
6. Alimentar o pacote OBS e controlar cenas pelo modo assistido.
7. Criar canais/cargos no Discord e publicar avisos/resultados.
8. Corrigir uma divergência com auditoria e recalcular todos os consumidores.
9. Manter o último estado válido durante uma falha simulada de PUBG, Discord ou conexão do overlay.
