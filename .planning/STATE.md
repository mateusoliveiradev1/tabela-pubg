---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
last_updated: "2026-08-24T14:30:22.056Z"
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 45
  completed_plans: 40
  percent: 33
---

# Estado do projeto

## Posição atual

- Milestone: v1 completo
- Fase: 2 — Identidade, organizações e autorização
- Plano: 02-32 concluído; próximo plano pendente 02-33
- Status: remediação em execução, com controllers reais de sessões/identidades protegidos e mudanças sensíveis bound/owner-scoped
- Progresso: 40/45 planos do milestone concluídos; restam 5 planos de gap closure da Fase 2

## Decisões acumuladas

- Monorepo TypeScript com pnpm/Turborepo e aplicações implantáveis separadamente.
- Next.js App Router, NestJS/Fastify, PostgreSQL/Drizzle, Redis/BullMQ e S3 compatível.
- Execução sequencial no working tree principal, com commits atômicos por tarefa.
- Verificações humanas consolidadas ao final da fase.
- O preflight inicial da Fase 2 usa PostgreSQL Neon em branch isolada e Redis real loopback-only, sem persistir connection strings.
- A aprovação de PostgreSQL/Redis/migrations do plano 02-17 não aprova a CI final, reservada ao plano 02-24.
- Repositories de identidade e sessão persistem somente digests/HMAC; payloads temporários usam AES-256-GCM e o outbox recebe apenas `deliveryId`.
- Repositories tenant-owned exigem `organizationId` junto do recurso e gravam mutação, audit sanitizado e outbox no mesmo executor transacional.
- Convites e ownership serializam na linha da organização; as corridas usam duas conexões Neon diretas e nunca mock/PGlite.
- A matrix CI da Fase 2 redige logs e produz artifact por suite, mas sua execução remota continua reservada ao plano 02-24.
- OAuth, OTP e sessões dependem apenas de ports, Clock e RNG injetados; linking exige confirmação dual/step-up e alert context permanece read-only.
- Logos validam assinatura/estrutura PNG, JPEG e WebP antes do upload; banco guarda apenas metadata e key server-side.
- Cleanup de storage usa ledger sem FK de organização, outbox somente com `cleanupId` e claim com lease/retry idempotente.
- Verifier PKCE é one-use no Redis, indexado somente pelo digest do state; `documented-exception` exige evidence ID e repara para `required` sem migration.
- OAuth externo usa HTTP capturado nos testes e nunca devolve authorization URL, challengeId, sessionId ou provider token no JSON público.
- Jobs de notificação carregam somente `deliveryId`; recipient, OTP, convite e alert context permanecem cifrados até o worker e são apagados após entrega/expiração.
- Retry reutiliza a idempotency key da delivery; um resend de convite nasce como nova delivery com chave e token próprios.
- CSRF usa binding HMAC distinto para pre-auth e sessão, com rotação em autenticação e invalidação no logout.
- A API aplica SessionGuard, CsrfGuard e PermissionGuard globais; somente `@Public` pula sessão e ausência de permission metadata nega.
- Autorização resolve sessão e carrega snapshot tenant-aware diretamente do PostgreSQL em cada request, sem roles em cookie ou cache.
- Seleção de organização permanece explícita; criar ou listar organizações não altera tenant ativo em sessão ou cookie.
- Convite, audit, envelope cifrado e outbox são gravados na mesma transação; o worker recebe somente `deliveryId`.
- Auditoria aplica visibilidade, filtros, contagem e paginação no PostgreSQL antes da projeção redigida.
- Radix e Lucide ficam isolados nos primitivos locais; componentes de domínio recebem apenas capacidades já resolvidas.
- Specs TSX executam em jsdom e testes de route continuam em Node por projetos Vitest distintos.
- A UI usa quatro tamanhos, dois pesos e tokens globais grafite/teal; componentes TSX não codificam cores hexadecimais.
- O BFF aceita somente combinações path/method allowlisted e um `API_INTERNAL_ORIGIN` server-only sem credenciais ou path.
- O token CSRF retorna em header same-origin, é readquirido com os cookies rotacionados após autenticação e descartado no logout.
- O Next encaminha 401/403/404 e capabilities sem interpretar autorização; o Nest permanece a única autoridade RBAC.
- O desafio OTP permanece fora do JSON público e cruza o BFF apenas em header opaco allowlisted.
- Callback OAuth público é POST-only com CSRF; GET não processa `code` ou `state`.
- Contexto de convite sai da URL antes do preview e permanece em custódia HttpOnly curta até o POST explícito de aceite.
- Multipart de logo aceita somente `name`/`logo`, deriva metadata no servidor e nunca encaminha filename ou object key.
- Replace ativa o novo asset e enfileira cleanup do anterior na mesma transação; compensação de órfão usa transação independente.
- Worker de logo recebe somente `cleanupId` e resolve provider/key do ledger server-side.
- Leituras privadas da conta ficam em Server Components; mutações passam exclusivamente pelo BFF com CSRF.
- O contexto de alerta de novo acesso é resolvido no servidor e removido da URL sem ser serializado para o cliente.
- A UI operacional consome capabilities e projeções autoritativas do servidor sem duplicar a matriz RBAC no navegador.
- Mutações sensíveis de organização preservam o motivo durante step-up e recarregam shell e capabilities somente após resposta confirmada.
- A visibilidade de auditoria vem da API e filtros da UI nunca ampliam uma projeção self para all.
- Branding da UI muda somente após resposta autoritativa e refresh do shell.
- Logo de convite usa origem allowlisted, no-referrer e fallback local após remoção do token.
- Harness E2E aborta antes de seed/start sem preflight PostgreSQL/Redis e escopo fake/test/run-id válido.
- CI preserva main e pull_request e executa Chromium smoke antes da suíte browser completa.
- O gate final aceita somente um run event=push com branch e HEAD SHA exatos; workflow_dispatch permanece proibido.
- CI em fresh checkout constrói storage na matriz e usa Turbo dependencies-only antes do browser.
- Skips só são aceitos nos passos mutuamente exclusivos da matriz e em evidência condicionada a falha; suites obrigatórias devem executar.
- As flags Nyquist só são promovidas após validação da cópia candidata com flags falsas, validação do conteúdo promovido e revalidação pós-rename.
- O gate inicial 02-17 e o run CI final 32676449341 de 02-24 são evidências obrigatórias e distintas; plans, requirements, arquivos e comandos ausentes falham fechado.
- Discord aceitou PKCE S256 required no fluxo real; nenhuma exceção documentada foi necessária.
- OAuth inicia por navegação POST com allowlist CSP exata para discord.com, sem state ou authorization URL no DOM/JSON.
- NVDA 2026.1.1, teclado, zoom 200%, contraste AA e reduced motion foram aprovados manualmente no fluxo crítico.
- Impeccable é obrigatório para toda superfície visual; DROP MANIFEST é o contrato aprovado dos e-mails transacionais.
- Branches e dados sandbox são destruídos após aprovação, preservando credenciais somente no Environment User.
- Trust legado é elevado somente por e-mail verificado ativo; ausência de prova resulta em sessão provisional limitada a 15 minutos.
- Claims do outbox usam `FOR UPDATE SKIP LOCKED`, token de ownership e lease; publish/retry exigem ownership ainda válido.
- Erros persistidos pelo publisher são códigos estáveis redigidos, nunca texto de provider, recipient ou token.
- CSP e convite consomem o mesmo parser de origins exatas; produção aceita somente HTTPS e desenvolvimento adiciona HTTP apenas para loopback.
- Compensação de logo termina no commit do repository; assinatura e validação de resposta pós-commit nunca removem a key ativa.
- Jobs BullMQ carregam somente deliveryId ou cleanupId e usam o UUID do evento de outbox como jobId.
- Queue e Worker confirmam readiness antes do publisher iniciar e do health server anunciar disponibilidade.
- Falha de clear só é idempotente quando o reload encontra exatamente o mesmo estado terminal persistido.
- O repository é o único gerador do token em `issueForDevice` e devolve exatamente o token cujo digest persistiu.
- Trusted usa idle deslizante de 30 dias e teto absoluto de 90 dias; provisional permanece limitada a 15 minutos no repository.
- Autenticação de produção usa `resolveAndTouchSession` e propaga somente trust lido da sessão ativa persistida.
- Trust ausente ou fora do vocabulario nunca recebe compatibilidade trusted e e negado antes do RBAC.
- AllowProvisional vale somente no handler, exige permission authenticated e nao libera permissoes RBAC.
- Negacao provisional registra apenas categoria, correlationId, actorId e sessionId; falha do sink preserva 403.

## Métricas de execução

- Plano 02-35: 11 min, 1 tarefa TDD + 1 fix de build pós-wave, 9 arquivos.
- Plano 02-27: 25 min, 1 tarefa TDD, 6 arquivos.
- Plano 02-26: 9 min, 2 tarefas, 5 arquivos.
- Plano 02-28: 38 min, 2 tarefas, 8 arquivos.
- Plano 02-25: 20 min, 3 tarefas, 10 arquivos.
- Plano 02-23: 8 min, 2 tarefas, 10 arquivos.
- Plano 02-18: 34 min, 3 tarefas, 19 arquivos.
- Plano 02-24: 2d 14h, 1 tarefa, 3 arquivos.
- Plano 02-20: 14 min, 1 tarefa, 3 arquivos.
- Plano 02-15: 3h 36m, 3 checkpoints humanos, 40 arquivos/artefatos rastreados.

## Tarefas pendentes

- Executar os planos pendentes `02-33`–`02-34` e `02-38`–`02-40` para fechar os gaps de integração real registrados em `02-VERIFICATION.md`.
- Após nova verificação verde, avançar para a Fase 2.1 e aplicar Impeccable em toda UI/UX.

## Bloqueadores

- Docker não está instalado nesta máquina. Código, Compose e CI passaram nos gates disponíveis, mas o smoke test dos contêineres requer um host com Docker.

## Continuidade

- Última ação: plano 02-32 publicou controllers reais de sessões/identidades, proof D-08 bound e remoção owner-scoped transacional
- Próxima ação: executar o plano 02-33, próximo gap de integração pendente
- Arquivo de retomada: .planning/phases/02-identidade-organizacoes-e-autorizacao/02-33-PLAN.md

## Accumulated Context

### Roadmap Evolution

- Phase 2.1 inserted after Phase 2: Direção visual e sistema de experiência Impeccable para web, e-mail, Discord e broadcast (URGENT)

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 02 P29 | 9 min | 2 tasks | 7 files |
| Phase 02 P31 | 22 min | 1 tasks | 4 files |
| Phase 02 P42 | 16 min | 1 tasks | 9 files |
| Phase 02 P36 | 40min | 1 tasks | 9 files |
| Phase 02 P37 | 18min | 2 tasks | 14 files |
| Phase 02 P41 | 16min | 1 tasks | 5 files |
| Phase 02 P32 | 13min | 1 tasks | 10 files |

## Decisions

- [Phase 02]: BFF injeta tenant somente de captures UUID canonicos da rota allowlisted; headers tenant do browser sao descartados.
- [Phase 02]: PermissionGuard exige igualdade entre parametros Fastify e headers internos antes do snapshot RBAC ou handler.
- [Phase 02]: Negacoes tenant usam reason class limitada e payload redigido; falha ou ausencia do recorder preserva o 403.
- [Phase 02]: Step-up OAuth exige somente sessão ativa; link-identity exige reauthenticated_at da mesma sessão estritamente mais recente que dez minutos. — Evita pré-requisito circular no step-up e reserva prova fresca ao vínculo de identidade.
- [Phase 02]: Candidate proofs OAuth ficam server-side, actor/session-bound, expirantes e são consumidas por atualização condicional one-use. — Impede replay, troca de sessão e exposição da candidate ao navegador.
- [Phase 02]: Proofs de mudança de identidade persistem finalidade exata e exigem purpose/actor/session/provider/candidate iguais no consume.
- [Phase 02]: Proofs email legadas sem finalidade recuperável são encerradas fail-closed pela migration 0005.
- [Phase 02]: Mudanças account-only registram identity.security-state-changed no outbox sem fabricar audit organizacional.
- [Phase 02]: O token D-08 é gerado antes da transaction e só retorna após proof, identidade, sessão e outbox confirmarem o commit.
- [Phase 02]: O teste offline do database exclui integracao real; o runner phase2 preflighted permanece a rota fail-closed do spec D-08.
- [Phase 02]: Rotas OTP purpose-specific derivam autoridade protegida exclusivamente de request.auth.
- [Phase 02]: Sign-in persiste sessao trusted e alerta de novo dispositivo antes de publicar cookie e CSRF.
- [Phase 02]: Link e change delegam ao comando D-08; promocao provisional publica apenas o replacement token committed.
- [Phase 02]: Sign-in, link-identity e step-up usam paths OAuth distintos; somente sign-in e publico.
- [Phase 02]: OAuth conclui revoke Discord antes de sessao, step-up ou pending proof local.
- [Phase 02]: BFF rejeita authority fields e purpose mismatch antes de encaminhar contratos de identidade.
- [Phase 02]: Produção mantém prefixes Redis de identidade estáveis; somente mode=run aceita runScopeId canônico do caller. — Evita fallback compartilhado em testes sem alterar keys de produção.
- [Phase 02]: TEST_REDIS_URL presente é o endpoint selecionado pelo spec e também recebe PING do preflight; REDIS_URL permanece obrigatório. — Impede evidência contra endpoint diferente e mantém o contrato de ambiente do repositório.
- [Phase 02]: API offline coleta somente specs source não-integrados; Redis real usa config dedicada exata após preflight fail-closed. — Evita dependência de infraestrutura e duplicação src/dist no root test.
- [Phase 02]: candidateIdentityId identifica somente a pending proof server-side; actor, sessao, trust e candidate de provider nunca vem do browser.
- [Phase 02]: Confirmacao Discord consulta a proof bound sem consumir e delega exatamente uma vez ao comando atomico D-08.
- [Phase 02]: Remocao de identidade serializa na conta e confirma target, token atual e revoke-others na mesma transaction.
