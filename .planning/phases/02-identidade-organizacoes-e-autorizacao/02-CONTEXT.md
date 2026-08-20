# Fase 2: Identidade, organizações e autorização — Contexto

**Coletado em:** 2026-08-20  
**Status:** pronto para planejamento

<domain>
## Limite da fase

Entregar identidade segura por Discord e e-mail, sessões revogáveis, organizações com convites e uma autorização negada por padrão nos escopos de organização e campeonato. Esta fase não cria o domínio completo de campeonatos, inscrições ou integrações PUBG; ela fornece os sujeitos, escopos, papéis e trilha de auditoria que essas fases usarão.

</domain>

<decisions>
## Decisões de implementação

### Login Discord e acesso por e-mail

- **D-01:** Discord será o método principal e ficará em destaque na tela de acesso.
- **D-02:** o acesso alternativo por e-mail usará código temporário, sem senha e sem link mágico.
- **D-03:** identidades Discord e e-mail só serão vinculadas após confirmação explícita dos dois métodos; coincidência de e-mail nunca une contas automaticamente.
- **D-04:** no primeiro acesso, a pessoa poderá criar uma organização ou aceitar um convite existente.

### Sessões e dispositivos

- **D-05:** uma conta pode manter várias sessões e verá uma lista de dispositivos com revogação individual.
- **D-06:** sessões confiáveis duram 30 dias e renovam a expiração quando há atividade válida.
- **D-07:** login em dispositivo novo gera registro e aviso por e-mail com ação para encerrar a sessão.
- **D-08:** vincular identidade, trocar e-mail ou transferir propriedade encerra todas as outras sessões e preserva somente a sessão que reconfirmou a identidade.

### Organizações, membros e convites

- **D-09:** uma pessoa pode criar, possuir e participar de várias organizações.
- **D-10:** convites usam e-mail e link individual, são de uso único, expiram em 7 dias e carregam o cargo inicial.
- **D-11:** somente uma conta que confirme o e-mail convidado pode aceitar o convite; encaminhar o link não transfere a vaga.
- **D-12:** o último proprietário não pode sair, ser removido ou perder o cargo sem transferência explícita de propriedade.

### Cargos, escopos e auditoria

- **D-13:** proprietário e administrador atuam na organização inteira; árbitro, inscrições, transmissão e analista são atribuídos por campeonato.
- **D-14:** uma pessoa pode acumular cargos operacionais; as permissões efetivas são a união estrita dos cargos atribuídos, sem promoção implícita.
- **D-15:** autorização nega por padrão e toda consulta/comando protegido exige organização e, quando aplicável, campeonato explícitos.
- **D-16:** mudanças de cargo, revogação de membro e transferência de propriedade exigem reconfirmação de identidade e produzem evento de auditoria.
- **D-17:** proprietários e administradores veem a auditoria completa da organização; cada membro pode ver somente as próprias ações.

### Discrição do agente

- Seleção da biblioteca de autenticação e do provedor de e-mail, desde que fiquem atrás de adapters substituíveis.
- TTL do código, limite de tentativas, cooldown, hashing, rotação de sessão, cookies e proteção CSRF seguindo práticas atuais e testes de abuso.
- Matriz granular de permissões por cargo, respeitando exatamente os escopos e limites decididos acima.
- Apresentação visual detalhada das telas técnicas da fase, mantendo Discord como ação principal e acessibilidade adequada.

</decisions>

<canonical_refs>
## Referências canônicas

**Agentes posteriores devem ler estes documentos antes de planejar ou implementar.**

### Produto e escopo

- `.planning/PROJECT.md` — valor central, direção arquitetural e regras de evolução.
- `.planning/ROADMAP.md` — meta, entregas e critérios de verificação da Fase 2.
- `.planning/REQUIREMENTS.md` — requisitos AUTH-001–006, ORG-001–005, AUD-001 e NFR-005.

Não existem especificações externas; as decisões específicas estão capturadas neste documento.

</canonical_refs>

<code_context>
## Insights do código existente

### Ativos reutilizáveis

- `packages/domain/src/index.ts`: IDs nominalmente tipados, eventos de domínio e relógio injetável para regras determinísticas.
- `packages/database/src/schema.ts` e `packages/database/src/outbox.ts`: padrão Drizzle e outbox transacional para auditoria e eventos de identidade.
- `packages/config/src/index.ts`: configuração validada com Zod e mascaramento de segredos, apropriado para Discord OAuth, e-mail e chaves de sessão.
- `packages/contracts`: contratos Zod compartilhados entre API e web.

### Padrões estabelecidos

- O domínio permanece puro e não importa infraestrutura ou aplicações.
- Integrações externas entram por adapters; nenhuma credencial é enviada ao navegador.
- Mudanças de schema incluem migração e teste; mudanças de estado sensíveis geram outbox na mesma transação.
- Serviços expõem liveness/readiness separados e logs estruturados com redaction.

### Pontos de integração

- `apps/api/src/app.module.ts`: receberá módulos independentes de identity, organizations, authorization e audit.
- `apps/web/src/app`: receberá login, callback, verificação por código, onboarding, sessões, membros e convites.
- `packages/database`: receberá contas, identidades, códigos, sessões, organizações, associações, convites, papéis, atribuições e auditoria.
- `packages/contracts` e `packages/domain`: receberão schemas de entrada/saída, IDs e políticas puras compartilhadas.

</code_context>

<specifics>
## Ideias específicas

- A experiência nasce voltada à comunidade PUBG: Discord é o caminho mais natural, mas o e-mail impede dependência total de uma plataforma externa.
- O sistema deve facilitar equipes pequenas; por isso cargos operacionais podem ser combinados sem entregar poderes administrativos.
- Revogação deve surtir efeito imediatamente nas permissões, mesmo que a sessão continue válida para outras organizações.

</specifics>

<deferred>
## Ideias adiadas

Nenhuma — a discussão permaneceu dentro do escopo da Fase 2.

</deferred>

---

*Fase: 02-identidade-organizacoes-e-autorizacao*  
*Contexto coletado: 2026-08-20*

