---
phase: 2
slug: identidade-organizacoes-e-autorizacao
status: approved
shadcn_initialized: false
preset: none
visual_direction: canon-esports-operations
created: 2026-08-20
---

# Fase 2 — Contrato de design da interface

> Contrato visual e de interação para autenticação, sessões, organizações, membros, permissões e auditoria. As decisões D-01–D-17 de `02-CONTEXT.md` são obrigatórias.

---

## Direção visual

A interface deve parecer uma central de operações de esports: precisa, rápida e confiável. Superfícies grafite foscas, tipografia limpa, bordas discretas e acento teal comunicam estado sem competir com os dados. Não usar texturas militares, grunge, stencil, fogo, vermelho dominante, personagens, mapas, ícones ou composição visual que imitem PUBG, Twire, Wasdefy ou pacotes oficiais de transmissão. A marca Discord aparece somente no botão do provedor, segundo suas regras de marca.

### Direção aprovada pelo usuário

O usuário escolheu conscientemente o padrão visual **dashboard esports profissional**. Twire e Wasdefy são referências apenas para o nível de acabamento, densidade informacional e confiança operacional esperados; não são referências de identidade, composição ou cópia. A execução deve assumir as convenções do gênero com clareza — navegação lateral previsível, hierarquia de dados forte, superfícies escuras sóbrias e estados objetivos — e diferenciá-las pela marca própria grafite/teal, pela linguagem em português e pelos fluxos completos para campeonatos comunitários.

Critérios de aceite específicos desta direção:

- parecer uma ferramenta profissional de operação de campeonato já no primeiro acesso, não um painel administrativo genérico;
- privilegiar leitura rápida de pessoas, cargos, convites, sessões e eventos de auditoria;
- manter densidade moderada no desktop e decompor tabelas em cards legíveis no mobile;
- usar o teal como sinal funcional e não como decoração espalhada;
- preservar uma base visual extensível para tabelas públicas, estatísticas e overlays nas fases posteriores, sem antecipar a estética de transmissão nesta fase.

Esta fase cobre superfícies privadas e técnicas. Temas públicos, identidade do campeonato, tabelas públicas e overlays continuam reservados às Fases 6 e 7.

## Sistema de design

| Propriedade | Valor |
|---|---|
| Ferramenta | Tokens CSS próprios; nenhum design system foi detectado no repositório |
| Preset | não aplicável |
| Biblioteca de componentes | Radix UI Primitives para Dialog, Alert Dialog, Dropdown Menu, Tabs, Tooltip e Toast; HTML semântico para formulários, listas e tabelas |
| Biblioteca de ícones | Lucide React, traço de 1.75px; ícones sempre acompanhados por rótulo ou nome acessível |
| Fonte | Geist Sans; fallback `Arial, Helvetica, sans-serif` |
| Estilo | CSS variables globais para tokens e CSS Modules por domínio; nenhuma cor hexadecimal dentro de componentes |

Componentes de domínio ficam em `apps/web/src/components/{identity,organizations,authorization,audit}`. Primitivos reutilizáveis ficam em `apps/web/src/components/ui`. Componentes não podem conhecer regras de autorização: recebem capacidades já resolvidas e ocultam ou desabilitam ações conforme o contrato de cada tela, sem substituir a verificação do servidor.

## Escala de espaçamento

Valores declarados, todos múltiplos de 4:

| Token | Valor | Uso |
|---|---:|---|
| `space-xs` | 4px | lacunas entre ícone e texto auxiliar |
| `space-sm` | 8px | conteúdo inline, chips e controles compactos |
| `space-md` | 16px | distância padrão entre campos e conteúdo interno |
| `space-lg` | 24px | padding de cards, dialogs e seções mobile |
| `space-xl` | 32px | grupos de formulário e colunas do layout |
| `space-2xl` | 48px | separação entre seções principais |
| `space-3xl` | 64px | respiro de página no desktop |

Exceções: alvos interativos têm no mínimo 44×44px; inputs e botões de autenticação têm 48px de altura; campos visuais do OTP têm 56px de altura. Bordas usam 1px e anel de foco 2px, pois são espessuras, não espaçamento.

## Tipografia

Usar exatamente quatro tamanhos e dois pesos (`400` e `600`). Não usar caixa alta em frases; caixa alta é permitida apenas em eyebrow curta com no máximo 18 caracteres e `letter-spacing: 0.08em`.

| Papel | Tamanho | Peso | Altura de linha |
|---|---:|---:|---:|
| Label/metadado | 14px | 400 ou 600 | 1.4 |
| Corpo/controle | 16px | 400 ou 600 | 1.5 |
| Título de seção | 24px | 600 | 1.2 |
| Display de página | 36px | 600 | 1.15 |

OTP, datas e contagens usam `font-variant-numeric: tabular-nums`. Texto de ajuda nunca fica abaixo de 14px. Títulos não usam sombra, contorno ou tratamento de broadcast.

## Cor

| Papel | Valor | Uso |
|---|---|---|
| Dominante (60%) | `#090C11` | fundo de página, auth shell e canvas principal |
| Secundária (30%) | `#131923` | cards, sidebar, topbar, dialogs e linhas elevadas |
| Acento (10%) | `#45D6C8` | CTA próprio da plataforma, seleção ativa, foco, links importantes e sessão atual |
| Destrutiva | `#FF6B6B` | revogar, remover, encerrar, transferir propriedade e erros bloqueantes |

Tokens auxiliares obrigatórios:

| Token | Valor | Uso |
|---|---|---|
| `text-primary` | `#F4F7FA` | títulos e conteúdo principal |
| `text-secondary` | `#AAB4C3` | descrição, data e metadados |
| `border-default` | `#2A3442` | limites de superfície e campos |
| `surface-hover` | `#1A2230` | hover de linha ou item navegável |
| `provider-discord` | `#5865F2` | somente botão “Continuar com Discord” e ícone Discord |

O acento teal é reservado para CTA primário da plataforma, item de navegação/organização selecionado, anel de foco, links essenciais, checkbox/radio selecionado e marcador “Este dispositivo”. Não usar acento em todo ícone, toda borda ou texto decorativo. Discord roxo é exceção de marca do provedor, nunca uma segunda cor de produto. Estados nunca dependem só de cor: combinam ícone, rótulo e texto.

Contraste mínimo: 4.5:1 para texto normal, 3:1 para texto grande e limites essenciais, conforme WCAG AA. Texto sobre acento teal usa `#07110F`; texto sobre Discord usa `#FFFFFF`.

## Forma, elevação e movimento

- Cards e inputs usam raio de 8px; dialogs e painéis usam 12px; botões não usam formato pill, exceto badges e chips de papel.
- Superfícies usam borda de 1px. Sombra só em dialogs/drawers: `0 20px 60px rgba(0,0,0,.45)`.
- Transições duram 120–180ms e alteram apenas opacidade, cor e deslocamento máximo de 4px.
- Respeitar `prefers-reduced-motion`; nesse modo, remover deslocamento e reduzir transições a mudança imediata de estado.
- Loading de OAuth pode usar spinner de 20px; demais telas priorizam skeleton. Não usar animações de combate, glitch ou contagem regressiva dramática.

## Estrutura responsiva

### Auth shell

- Desktop a partir de 1024px: grade de duas colunas, 40% para mensagem curta da plataforma e 60% para card de acesso; largura total máxima de 1120px. O card de formulário tem 440px e fica centralizado na coluna.
- Tablet e mobile: uma coluna, marca compacta no topo e card sem sombra ocupando a largura disponível; padding lateral 24px entre 640–1023px e 16px abaixo de 640px.
- O conteúdo crítico aparece inteiro em 320px sem rolagem horizontal. A ilustração é opcional e nunca empurra o formulário para baixo da primeira viewport.

### Platform shell

- Desktop a partir de 1024px: sidebar fixa de 264px, topbar de 64px e conteúdo com largura máxima de 1280px, padding de 32px.
- A organização ativa é explícita na URL (`/o/{organizationSlug}/...`) e no `OrganizationSwitcher`; nunca é inferida apenas da sessão.
- Abaixo de 1024px: sidebar vira drawer acionado por botão de 44px; organização ativa permanece visível no topo.
- Abaixo de 768px: tabelas de membros, convites e sessões viram cards ordenados. Auditoria vira timeline compacta; nenhum dado essencial fica escondido em hover.
- Abaixo de 480px: ações secundárias vão para menu “Mais ações”; CTA principal permanece visível e com largura total quando necessário.

## Arquitetura de navegação

### Rotas públicas da fase

| Rota | Tela |
|---|---|
| `/entrar` | Discord em destaque e alternativa por e-mail |
| `/entrar/email` | solicitar código temporário |
| `/entrar/email/codigo` | informar e validar OTP |
| `/entrar/discord/retorno` | retorno/progresso do OAuth sem expor `code` ou token |
| `/convites/aceitar` | prévia e aceite seguro do convite; token removido da URL antes da confirmação |

### Rotas autenticadas da fase

| Rota | Tela |
|---|---|
| `/primeiro-acesso` | criar organização ou aceitar convite |
| `/organizacoes/nova` | criação da organização |
| `/conta/identidades` | Discord/e-mail vinculados e vinculação explícita |
| `/conta/sessoes` | dispositivos e sessões revogáveis |
| `/o/{slug}/membros` | membros e permissões |
| `/o/{slug}/convites` | convites ativos e histórico |
| `/o/{slug}/auditoria` | auditoria completa para owner/admin ou ações próprias para membro |

A sidebar da fase contém “Visão geral”, “Membros”, “Convites” e “Auditoria”. “Conta e segurança” fica no menu do usuário. Itens sem capacidade não aparecem; acesso direto não autorizado recebe estado seguro de permissão, sem revelar dados da organização.

## Contratos por fluxo

### 1. Entrar com Discord ou e-mail

O card mostra, nesta ordem: título “Entre na plataforma”, explicação de uma linha, botão roxo de largura total “Continuar com Discord”, divisor textual “ou use seu e-mail”, campo de e-mail e CTA secundário “Receber código”. Não colocar os dois métodos lado a lado. Discord é inequivocamente primário, conforme D-01.

- O botão Discord redireciona imediatamente e passa a mostrar “Abrindo Discord…” com spinner; impede clique duplicado.
- Erro/cancelamento do provedor retorna ao mesmo card com alerta focável “Não foi possível entrar com Discord. Tente novamente ou use seu e-mail.” O parâmetro técnico nunca aparece.
- Campo de e-mail usa label visível “E-mail”, `autocomplete="email"`, validação somente após blur/submit e descrição “Enviaremos um código temporário. Você não precisa de senha.”
- Após solicitar, sempre mostrar a resposta uniforme: “Se este e-mail puder receber mensagens, enviaremos um código em instantes.” Nunca confirmar se a conta existe.
- Link discreto “Política de privacidade” pode aparecer no rodapé; termos completos não fazem parte desta fase.

### 2. Informar OTP

Usar um único input semântico com apresentação visual segmentada em oito posições. Acessibilidade: label “Código de 8 dígitos”, `inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength="8"`, colagem completa aceita e caracteres não numéricos ignorados. Não criar oito inputs que obriguem navegação caractere por caractere.

- Cabeçalho: “Digite o código”; descrição: “Enviamos um código para m•••@dominio.com. Ele expira em 10 minutos.”
- CTA: “Confirmar código”. Não enviar automaticamente ao completar o oitavo dígito.
- Ação secundária inicialmente desabilitada: “Reenviar em 00:60”; depois “Reenviar código”. Um novo envio limpa o input e anuncia “Novo código enviado” em região `aria-live="polite"`.
- Código inválido: “Código inválido. Confira os 8 dígitos e tente novamente.” O valor continua editável e recebe foco.
- Expirado: “Este código expirou. Solicite um novo para continuar.” CTA “Enviar novo código”.
- Limite atingido: “Muitas tentativas. Solicite um novo código mais tarde.” Não mostrar detalhes do limiter.
- Erro de entrega: manter resposta não enumerável e oferecer “Tentar novamente” após cooldown.

### 3. Vincular identidades

A tela “Formas de acesso” mostra cards separados para Discord e e-mail com estado “Vinculado” ou “Não vinculado”, identidade parcialmente mascarada, data de vínculo e ação explícita.

- “Vincular Discord” inicia OAuth com propósito de vínculo e, ao retornar, exige confirmação da sessão atual.
- “Vincular e-mail” usa o mesmo OTP e exibe o endereço que será associado antes do submit final.
- Antes de concluir, dialog: “Confirme a vinculação” e texto “Você poderá entrar por qualquer um dos dois métodos. Contas nunca são unidas apenas porque os e-mails coincidem.” CTA “Vincular identidade”.
- Se a identidade já pertencer a outra conta, mostrar “Esta forma de acesso já está vinculada a outra conta. Nenhuma conta foi unida.” com caminho de suporte, sem revelar o outro usuário.
- Não permitir desconectar a última forma de acesso. Após vínculo ou troca de e-mail, avisar que as outras sessões foram encerradas, conforme D-08.

### 4. Primeiro acesso

Título “Como você quer começar?” e duas opções de mesmo peso visual:

1. “Criar uma organização” — “Configure o espaço da sua comunidade e convide sua equipe.” CTA “Criar organização”.
2. “Entrar por convite” — quando existe convite válido, mostrar organização, remetente, cargo inicial e validade; CTA “Revisar convite”. Sem convite, CTA “Usar link de convite” abre campo para colar o link.

Selecionar uma opção não executa ação irreversível. O usuário pode voltar até o submit final. Se houver convite válido no contexto, a opção de convite aparece primeiro, mas Discord continua sendo o método principal apenas na tela de login.

### 5. Criar organização

Formulário em uma única coluna, máximo 640px:

- Nome da organização, obrigatório, contador de caracteres e prévia do identificador público; slug editável fica fora desta fase caso não exista requisito técnico.
- Logo opcional com dropzone e botão “Selecionar logo”; aceitar somente formatos/tamanho definidos pelo backend. Mostrar preview, nome e ação “Remover logo”. Nunca depender apenas de drag-and-drop.
- Resumo antes do submit: “Você será o proprietário inicial e poderá convidar outras pessoas depois.”
- CTA “Criar organização”. Após sucesso, navegar para `/o/{slug}/membros` e mostrar toast “Organização criada”.
- Erro de nome duplicado ou inválido aparece abaixo do campo; falha geral mantém todos os valores preenchidos.

### 6. Convite e aceite

A página de convite não consome o token ao abrir. Ela apresenta logo/nome da organização, quem convidou, e-mail mascarado, cargo inicial, escopos de campeonato e data de expiração.

| Estado | Apresentação e ação |
|---|---|
| Válido e identidade correta | CTA “Aceitar convite”; nota “Este convite só pode ser usado por {e-mail mascarado}.” |
| Usuário não autenticado | CTA “Entrar para aceitar”; após login, retornar ao mesmo convite |
| E-mail diferente | alerta “Este convite foi enviado para outro e-mail.”; CTA “Entrar com o e-mail convidado”; nunca transferir a vaga |
| Expirado | ícone de relógio, título “Convite expirado”; CTA “Ver como pedir novo convite” abre instrução para contatar um administrador |
| Revogado | título “Convite cancelado”; nenhuma ação de aceite |
| Já utilizado | título “Convite já utilizado”; CTA “Ir para a organização” apenas se a pessoa já for membro |
| Inválido | estado genérico “Não foi possível abrir este convite”; não revelar se o token existiu |

Após confirmação, o botão mostra “Aceitando…” e aguarda o servidor; não atualizar otimisticamente. Sucesso: “Você entrou em {organização}” e navegação para a organização.

### 7. Sessões e dispositivos

Cabeçalho “Sessões e dispositivos” com explicação “Sua conta pode permanecer conectada em vários dispositivos. Sessões sem atividade expiram em 30 dias.” A sessão atual vem primeiro e recebe badge teal “Este dispositivo”.

Cada linha/card contém: dispositivo resumido, navegador/sistema, localização aproximada quando disponível, “Ativo agora” ou última atividade, início da sessão e expiração. Não mostrar IP completo, fingerprint ou localização precisa.

- Ação por sessão remota: “Encerrar sessão”, seguida por Alert Dialog com nome do dispositivo e CTA destrutivo “Encerrar sessão”.
- Ação de página: “Encerrar todas as outras”, com contagem de sessões afetadas; nunca inclui a atual.
- A sessão atual oferece “Sair deste dispositivo”, não “revogar”.
- Sucesso remove a sessão somente após confirmação do servidor e anuncia em `aria-live`. Falha preserva a linha e mostra “Não foi possível encerrar esta sessão. Tente novamente.”
- Estado vazio impossível para usuário autenticado; se a API retornar zero sessões, mostrar erro de consistência e ação “Entrar novamente”, não uma lista vazia enganosa.

#### Notificação por e-mail de novo dispositivo

Todo login reconhecido como novo dispositivo gera um e-mail transacional, conforme D-07. O e-mail é informativo e nunca altera estado ao ser aberto ou ao clicar no CTA.

- Assunto: “Novo acesso à sua conta”.
- Preheader: “Revise o dispositivo e encerre a sessão se você não reconhecer este acesso.”
- Abertura: “Detectamos um novo acesso à sua conta.”
- Detalhes obrigatórios em bloco legível: “Dispositivo: {navegador} em {sistema operacional}” e “Horário: {data e hora completas com fuso}”.
- Quando o sinal estiver disponível e for confiável, incluir “Localização aproximada: {cidade, estado/país}”. Quando não estiver, mostrar “Localização aproximada: indisponível”. Nunca mostrar IP completo ou tratar localização como prova de identidade.
- Orientação: “Se foi você, nenhuma ação é necessária. Se não reconhece este acesso, revise a sessão e encerre-a imediatamente.”
- CTA único: “Revisar e encerrar sessão”. Ele abre `/conta/sessoes` com a sessão correspondente destacada por um contexto opaco do alerta resolvido no servidor; esse contexto não contém token de sessão, é removido da URL após a resolução e não pode ser usado para autorizar a mutação.
- Rodapé de segurança: “Este e-mail nunca pedirá seu código temporário ou credenciais do Discord.”

Ao chegar pela notificação:

| Estado | Comportamento |
|---|---|
| Não autenticado | redirecionar para login com retorno seguro a `/conta/sessoes`; depois da autenticação, destacar a sessão e mover o foco para seu título |
| Sessão ativa encontrada | card recebe borda teal, badge “Novo acesso” e alerta “Revise este dispositivo”; nenhuma sessão é encerrada automaticamente |
| Já encerrada | banner “Esta sessão já foi encerrada.” e lista normal de sessões; não oferecer novamente a mutação para ela |
| Não encontrada/expirada | banner “Não encontramos esta sessão. Ela pode ter expirado ou já ter sido removida.” e lista normal, sem revelar identificadores internos |

No card destacado, “Encerrar sessão” abre a mesma confirmação usada na lista: “Este dispositivo perderá o acesso imediatamente.” Somente o CTA destrutivo “Encerrar sessão” envia a mutação autenticada por método inseguro protegido por CSRF. GET do e-mail, redirect, carregamento da página e resolução do alerta são estritamente read-only.

### 8. Membros e permissões

O cabeçalho mostra total de membros e CTA “Convidar membro” apenas para owner/admin. Desktop usa tabela com colunas Pessoa, Papel na organização, Cargos por campeonato, Status e Ações. Mobile usa cards com a mesma ordem de informação.

- Owner: badge “Proprietário”; admin: “Administrador”; demais: “Membro”. Badges operacionais usam rótulos “Árbitro”, “Inscrições”, “Transmissão” e “Analista”, sempre acompanhados do campeonato.
- “Editar permissões” abre dialog com dois grupos separados: “Papel na organização” e “Cargos por campeonato”. Nunca misturar papel global com cargo operacional no mesmo select.
- Cargos operacionais são checkboxes combináveis dentro de cada campeonato. A união não exibe frases como “acesso total”; uma caixa lateral “Permissões resultantes” lista capacidades efetivas em linguagem humana.
- Sem campeonatos: mostrar “Nenhum campeonato disponível para atribuir cargos operacionais.” e manter apenas papéis globais possíveis. Não criar escopos fictícios na interface.
- Alterar papel/cargo exige motivo e step-up. Após salvar, atualizar a linha com resposta do servidor e toast “Permissões atualizadas”.
- O último proprietário vê ações de remover/rebaixar desabilitadas com tooltip “Transfira a propriedade antes de alterar este membro.” Não esconder a regra.
- Um usuário sem capacidade de gestão vê a lista conforme permitido, sem menus de mutação. Tentar URL direta de outro tenant exibe estado seguro, não nomes ou membros da organização alvo.

### 9. Convites de membros

CTA “Convidar membro” abre formulário com e-mail, papel inicial, cargos/escopos permitidos e resumo “Uso único · expira em 7 dias · válido apenas para este e-mail”. O submit é “Enviar convite”.

A página tem abas “Ativos” e “Histórico”. Ativos mostram destinatário mascarado, papel/cargos, quem enviou e “Expira em {data relativa e absoluta}”. Histórico inclui aceito, expirado e revogado.

- “Revogar convite” usa confirmação simples e CTA destrutivo “Revogar convite”.
- “Reenviar convite” cria um novo convite e invalida o anterior; o dialog explica isso antes de “Enviar novo convite”.
- Lista vazia: “Nenhum convite ativo” e corpo “Convide alguém para dividir a operação da organização.” CTA “Convidar membro” se autorizado.
- Nunca mostrar token ou link completo depois da criação. Oferecer “Copiar link” somente na resposta imediata, mascarar depois e registrar a ação conforme política do backend.

### 10. Reautenticação para ação sensível

Mudança de cargo, revogação de membro e transferência de propriedade abrem um dialog em duas etapas:

1. Resumo do impacto e campo obrigatório “Motivo da alteração”. O motivo deve ser específico; placeholder “Ex.: mudança na equipe de organização”.
2. “Confirme que é você” com Discord como botão principal e código por e-mail como alternativa. Step-up válido por 10 minutos pode pular a segunda etapa, mas o dialog informa “Identidade confirmada há menos de 10 minutos”.

O dialog preserva o formulário enquanto OAuth/OTP é concluído. Fechar ou falhar não aplica a mutação. Durante o submit final, bloquear fechamento acidental e mostrar progresso dentro do botão; após resposta, devolver foco ao elemento que abriu o dialog.

Transferência de propriedade exige seleção explícita de membro elegível, confirmação digitada com o nome da organização e o resumo completo: “Você deixará de ser proprietário. Todas as suas outras sessões serão encerradas; somente esta sessão, que você acabou de confirmar, permanecerá conectada.” CTA destrutivo “Transferir propriedade”. Revogar membro usa “Revogar acesso”; mudança de papel usa “Salvar permissões”.

Após confirmação do servidor, preservar somente a sessão reautenticada, recarregar capacidades e membership da organização e atualizar imediatamente badge, ações, sidebar e menus conforme o novo papel do usuário. Se a rota atual deixar de ser permitida, navegar para a primeira rota autorizada da mesma organização e explicar a mudança; nunca manter controles de proprietário em cache nem aplicar a troca otimisticamente. Exibir a confirmação persistente e o toast com a copy exata: “Propriedade transferida. Encerramos suas outras sessões por segurança.”

### 11. Auditoria

Owner/admin veem a trilha completa. Demais membros veem título “Minhas ações” e aviso “Você está vendo somente ações realizadas por você.”

- Filtros: período, ator, tipo de ação e campeonato/organização; filtros atualizam a URL e possuem botão “Limpar filtros”.
- Cada evento mostra ator, ação em linguagem humana, alvo, data/hora no fuso da interface, escopo e motivo. “Ver alterações” expande pares “Antes” e “Depois” como lista de campos; nunca renderizar JSON bruto, tokens, cookies, e-mail completo ou payload criptografado.
- Ordem padrão: mais recente primeiro. Paginação explícita; scroll infinito não é permitido em uma trilha auditável.
- Vazio sem filtros: “Nenhuma ação auditada ainda.” Vazio com filtros: “Nenhum evento corresponde aos filtros.” CTA “Limpar filtros”.
- Erro: “Não foi possível carregar a auditoria. Tente novamente sem alterar os filtros.”

## Estados globais

| Estado | Contrato |
|---|---|
| Loading de página | skeleton com a geometria final; manter título e navegação visíveis |
| Loading de ação | texto verbal no botão (“Enviando…”, “Salvando…”, “Encerrando…”), controles relacionados desabilitados e sem layout shift |
| Sucesso | toast de até duas linhas e atualização persistente na própria tela; foco não é movido para o toast |
| Erro de campo | texto imediatamente abaixo, `aria-describedby`, borda destrutiva e ícone; foco no primeiro campo inválido após submit |
| Erro recuperável | alerta inline com problema e ação específica “Tentar novamente” |
| Erro de permissão/tenant | “Não foi possível abrir esta área. Volte para uma organização à qual você tenha acesso.”; não revelar existência de recurso externo |
| Sessão expirada | dialog não destrutivo “Sua sessão expirou”; CTA “Entrar novamente” preserva URL de retorno segura |
| Offline/falha de rede | banner “Sem conexão. Nenhuma alteração foi enviada.”; nunca simular sucesso |
| Vazio | ícone simples, título factual, uma frase de orientação e no máximo um CTA |

Mutações de identidade, convite, membro, papel, propriedade e sessão nunca são otimistas. A interface aguarda a confirmação autoritativa do servidor.

## Inventário de componentes

| Componente | Contrato essencial |
|---|---|
| `AuthShell` | layout responsivo sem navegação da plataforma |
| `AuthCard` | título, descrição, conteúdo, erro de retorno e rodapé |
| `DiscordButton` | marca oficial apenas dentro do botão, loading e nome acessível |
| `EmailOtpForm` | request/verify, resposta uniforme, cooldown e live region |
| `OtpInput` | input único de 8 dígitos com apresentação segmentada |
| `AppShell` | sidebar/drawer, topbar e skip link |
| `OrganizationSwitcher` | organização explícita, busca a partir de 8 itens e opção “Criar organização” |
| `PageHeader` | breadcrumb opcional, título, descrição e um CTA principal |
| `StatusBadge` | ícone + texto; variantes neutral, accent e destructive |
| `RoleBadge` | papel/cargo completo, nunca só abreviação |
| `ScopeRoleEditor` | papéis globais separados de checkboxes por campeonato e resumo de permissões |
| `DeviceSessionCard` | identificação resumida, datas, estado atual e ação de encerramento |
| `InvitationCard` | destinatário mascarado, papel, validade, estado e ações autorizadas |
| `AuditEvent` | resumo acessível e detalhe antes/depois sem JSON bruto |
| `EmptyState` | título, corpo e CTA opcional |
| `InlineAlert` | `role="alert"` apenas para erro urgente; demais usam `status` |
| `ConfirmSensitiveActionDialog` | impacto, motivo, step-up e confirmação final |
| `Skeleton` | dimensões estáveis e `aria-hidden="true"`; container nomeia carregamento |

Botões têm variantes `primary`, `secondary`, `ghost` e `destructive`. Apenas um `primary` por região visual. Links parecem links; não estilizar navegação inline como botão sem necessidade.

## Contrato de copywriting

Tom: direto, humano e operacional. Usar verbos claros, explicar impacto antes de pedir confirmação e evitar jargão como OAuth, RBAC, token, tenant, digest ou outbox na interface.

| Elemento | Copy |
|---|---|
| CTA principal de login | “Continuar com Discord” |
| CTA de e-mail | “Receber código” |
| CTA de OTP | “Confirmar código” |
| CTA de onboarding | “Criar organização” / “Revisar convite” |
| CTA de membros | “Convidar membro” |
| Vazio principal | “Você ainda não participa de uma organização” |
| Corpo do vazio | “Crie uma organização para sua comunidade ou aceite um convite para colaborar.” |
| Erro global | “Não foi possível concluir esta ação. Tente novamente; se o problema continuar, use o código de suporte exibido.” |
| Sem permissão | “Não foi possível abrir esta área. Volte para uma organização à qual você tenha acesso.” |
| Confirmação — sessão | “Encerrar sessão”: “Este dispositivo perderá o acesso imediatamente.” |
| Confirmação — convite | “Revogar convite”: “O link atual deixará de funcionar e não poderá ser reutilizado.” |
| Confirmação — membro | “Revogar acesso”: “Esta pessoa perderá o acesso a esta organização, mas continuará conectada às demais.” |
| Confirmação — propriedade | “Transferir propriedade”: “Você deixará de ser proprietário. Todas as suas outras sessões serão encerradas; somente esta sessão reautenticada permanecerá conectada.” Pós-sucesso: “Propriedade transferida. Encerramos suas outras sessões por segurança.” |

Não usar “Tem certeza?” sozinho. Não usar “Algo deu errado” sem ação de recuperação. Não dizer que um e-mail existe, que um token é válido ou que uma organização externa existe antes da autorização.

## Acessibilidade

- Meta obrigatória: WCAG 2.2 AA em desktop e mobile.
- `lang="pt-BR"`, landmarks `header/nav/main/aside`, heading order sem saltos e skip link “Ir para o conteúdo”.
- Todo fluxo funciona por teclado; foco visível de 2px teal com offset de 2px; nenhum `outline: none` sem substituição.
- Dialogs prendem foco, recebem título/descrição acessíveis, fecham com Escape exceto durante commit irreversível e devolvem foco ao acionador.
- Menus/drawers seguem setas, Escape e foco inicial previsível. Tooltips nunca guardam informação necessária.
- Toasts usam `aria-live="polite"`; erros de submit usam `role="alert"`; contadores e cooldowns não anunciam a cada segundo, somente quando a ação fica disponível.
- Avatares/logos têm alt funcional; decoração usa alt vazio. Nome e e-mail mascarado continuam presentes em texto.
- Touch targets mínimos de 44px e distância mínima de 8px entre ações destrutivas e ações comuns.
- Zoom de 200% não perde conteúdo ou funcionalidade. Texto não fica embutido em imagens.
- Testar teclado, leitor de tela, contraste, reduced motion e largura de 320px antes da aprovação.

## Segurança percebida e privacidade

- Nunca renderizar ou armazenar em estado cliente access token Discord, token de convite, OTP consumido, cookie, CSRF secret ou credenciais futuras de PUBG/Twitch/OBS.
- Remover token de convite da barra de endereço antes de renderizar dados; usar `Referrer-Policy: no-referrer` nessa rota.
- E-mails ficam mascarados fora de formulários de confirmação; localização de sessão é aproximada.
- Mensagens públicas de OTP e convite não permitem enumeração. Detalhes técnicos ficam em correlation/support code, nunca em stack trace.
- A UI não oferece ações que o ator não pode executar, mas toda resposta 401/403 continua tratada como autoridade do servidor.

## Testes visuais e de interação obrigatórios

1. Login Discord, cancelamento do provedor e fallback por e-mail em 320px, 768px e 1440px.
2. OTP vazio, parcial, colado, inválido, expirado, reenviado e bloqueado por tentativas.
3. Primeiro acesso com nenhum convite, convite válido e convite para e-mail diferente.
4. Organização sem logo, nome longo e erro de upload sem perder o formulário.
5. Sessões com 1, 3 e 20 dispositivos; sessão atual sempre identificável.
6. Lista com 0, 1 e 100 membros; nomes/e-mails longos; owner único protegido.
7. Editor com múltiplos cargos e múltiplos campeonatos, além do estado sem campeonatos.
8. Convite válido, expirado, revogado, utilizado, inválido e aceito concorrentemente em outra aba.
9. Step-up por Discord e e-mail; cancelamento não aplica mutação; submit duplicado é impedido.
10. Auditoria completa e visão “Minhas ações”, com before/after extenso e filtros sem resultado.
11. Rotas cross-organization não revelam nome, membros, convite ou existência do recurso.
12. Teclado completo, NVDA/VoiceOver, contraste AA, zoom 200% e `prefers-reduced-motion`.

## Registry Safety

| Registry | Blocos usados | Safety Gate |
|---|---|---|
| shadcn official | nenhum | não aplicável — `components.json` não existe |
| terceiros | nenhum | não aplicável |

Radix UI e Lucide devem ser instalados pelos pacotes npm oficiais, com versões travadas no lockfile. Não incorporar blocos de registry ou snippets de terceiros nesta fase.

## Fontes das decisões

| Fonte | Decisões utilizadas |
|---|---|
| `02-CONTEXT.md` | D-01–D-17: métodos de login, vinculação, onboarding, sessões, convites, escopos, step-up e auditoria |
| `02-RESEARCH.md` | OTP de 8 dígitos/10 min, step-up de 10 min, cookie server-side, rotas same-origin, não enumeração, scopes explícitos e segurança do convite |
| `REQUIREMENTS.md` | AUTH-001–006, ORG-001–005, AUD-001, NFR-005 e proibição de copiar identidade de PUBG/Twire/Wasdefy |
| UI existente | direção dark da Fase 1 preservada; Arial atual vira fallback de Geist Sans |
| Escolha visual do usuário | dashboard esports profissional; Twire e Wasdefy como régua de acabamento, sem copiar identidade ou composição |
| Discrição autorizada | paleta teal, layout de operações, componentes, breakpoints, motion e copy detalhada |

## Checker Sign-Off

- [x] Dimensão 1 Copywriting: PASS
- [x] Dimensão 2 Visuals: PASS
- [x] Dimensão 3 Color: PASS
- [x] Dimensão 4 Typography: PASS
- [x] Dimensão 5 Spacing: PASS
- [x] Dimensão 6 Registry Safety: PASS

**Aprovação:** UI-SPEC verificado e aprovado em 2026-08-20. Pronto para planejamento.
