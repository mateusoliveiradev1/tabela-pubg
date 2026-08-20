# Phase 2: Identidade, organizações e autorização - Research

**Researched:** 2026-08-20
**Domain:** autenticação passwordless, sessões opacas, RBAC multi-tenant e auditoria
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Login Discord e acesso por e-mail

- **D-01:** Discord será o método principal e ficará em destaque na tela de acesso.
- **D-02:** o acesso alternativo por e-mail usará código temporário, sem senha e sem link mágico.
- **D-03:** identidades Discord e e-mail só serão vinculadas após confirmação explícita dos dois métodos; coincidência de e-mail nunca une contas automaticamente.
- **D-04:** no primeiro acesso, a pessoa poderá criar uma organização ou aceitar um convite existente.

#### Sessões e dispositivos

- **D-05:** uma conta pode manter várias sessões e verá uma lista de dispositivos com revogação individual.
- **D-06:** sessões confiáveis duram 30 dias e renovam a expiração quando há atividade válida.
- **D-07:** login em dispositivo novo gera registro e aviso por e-mail com ação para encerrar a sessão.
- **D-08:** vincular identidade, trocar e-mail ou transferir propriedade encerra todas as outras sessões e preserva somente a sessão que reconfirmou a identidade.

#### Organizações, membros e convites

- **D-09:** uma pessoa pode criar, possuir e participar de várias organizações.
- **D-10:** convites usam e-mail e link individual, são de uso único, expiram em 7 dias e carregam o cargo inicial.
- **D-11:** somente uma conta que confirme o e-mail convidado pode aceitar o convite; encaminhar o link não transfere a vaga.
- **D-12:** o último proprietário não pode sair, ser removido ou perder o cargo sem transferência explícita de propriedade.

#### Cargos, escopos e auditoria

- **D-13:** proprietário e administrador atuam na organização inteira; árbitro, inscrições, transmissão e analista são atribuídos por campeonato.
- **D-14:** uma pessoa pode acumular cargos operacionais; as permissões efetivas são a união estrita dos cargos atribuídos, sem promoção implícita.
- **D-15:** autorização nega por padrão e toda consulta/comando protegido exige organização e, quando aplicável, campeonato explícitos.
- **D-16:** mudanças de cargo, revogação de membro e transferência de propriedade exigem reconfirmação de identidade e produzem evento de auditoria.
- **D-17:** proprietários e administradores veem a auditoria completa da organização; cada membro pode ver somente as próprias ações.

### the agent's Discretion

- Seleção da biblioteca de autenticação e do provedor de e-mail, desde que fiquem atrás de adapters substituíveis.
- TTL do código, limite de tentativas, cooldown, hashing, rotação de sessão, cookies e proteção CSRF seguindo práticas atuais e testes de abuso.
- Matriz granular de permissões por cargo, respeitando exatamente os escopos e limites decididos acima.
- Apresentação visual detalhada das telas técnicas da fase, mantendo Discord como ação principal e acessibilidade adequada.

### Deferred Ideas (OUT OF SCOPE)

Nenhuma — a discussão permaneceu dentro do escopo da Fase 2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-001 | permitir login com Discord OAuth2. | Authorization Code no servidor, `state`, PKCE sob gate de sandbox, escopos mínimos e revogação do token Discord após `/users/@me`. |
| AUTH-002 | oferecer e-mail como alternativa de acesso e recuperação. | Desafio OTP de uso único, HMAC com pepper, limites distribuídos, respostas uniformes e entrega assíncrona. |
| AUTH-003 | manter sessões revogáveis, expiração segura e proteção contra reutilização de credenciais. | Token opaco aleatório, somente digest no PostgreSQL, cookie `__Host-`, rotação, expiração deslizante e revogação imediata. |
| AUTH-004 | permitir que uma pessoa participe de várias organizações e campeonatos. | Memberships e assignments normalizados, contexto explícito, sem organização ativa embutida na sessão. |
| AUTH-005 | aplicar autorização por organização e por campeonato, negando por padrão. | Guardas globais, matriz pura de permissões, consulta de estado atual e repositórios tenant-aware. |
| AUTH-006 | nunca expor tokens da PUBG, Discord, Twitch ou OBS no navegador. | Backend-for-frontend lógico, adapters no servidor, respostas e logs redigidos e testes de ausência de segredo. |
| ORG-001 | permitir criar uma organização de campeonatos com nome, logo e membros. | Agregado transacional, owner inicial e schema tenant-aware; upload de logo permanece restrito e validado. |
| ORG-002 | permitir convidar membros e revogar acesso. | Convite opaco, vinculado ao e-mail confirmado, uso único/7 dias, aceitação e revogação atômicas. |
| ORG-003 | oferecer funções de proprietário, administrador, árbitro, inscrições, operador de transmissão e analista. | Matriz prescritiva de papéis organizacionais e por campeonato. |
| ORG-004 | restringir cada função ao menor conjunto de permissões necessário. | Permissões enumeradas, união estrita, sem promoção implícita e teste exaustivo. |
| ORG-005 | impedir que o último proprietário abandone ou perca controle da organização sem transferência explícita. | Bloqueio pessimista da organização, transação, pré-condição e testes de corrida. |
| AUD-001 | registrar autor, data, motivo, valor anterior e novo em ações sensíveis. | Evento append-only persistido na mesma transação da mutação e consultas com visibilidade filtrada. |
| NFR-005 | aplicar segredo fora do código, criptografia em trânsito, rate limiting, validação de entrada, uploads restritos e menor privilégio. | Config validada, cookies seguros, CSRF, Zod, limites Redis, redaction, adapter de upload e threat inventory. |
</phase_requirements>

## Summary

A fase deve manter NestJS como autoridade de identidade e autorização, usando um fluxo OAuth baixo nível atrás de `DiscordIdentityProvider`, OTP de e-mail atrás de `EmailSender` e sessões opacas armazenadas no PostgreSQL. O navegador recebe somente um cookie de referência; credenciais Discord e futuros tokens PUBG/Twitch/OBS permanecem exclusivamente no backend. O monorepo já fornece Drizzle, PostgreSQL, Redis/BullMQ, outbox transacional, configuração Zod, relógio injetável e testes Vitest, portanto a implementação deve estender esses padrões em vez de introduzir um framework de autenticação que passe a possuir o schema. [VERIFIED: codebase grep]

O ponto de maior risco não é o login isoladamente, mas a combinação de vinculação explícita de identidades, expiração deslizante, convites vinculados a e-mail, múltiplas organizações e papéis por campeonato. A solução recomendada separa autenticação, contexto de sessão e decisão de autorização; consulta memberships/assignments atuais em toda operação protegida; e grava a mutação, auditoria e outbox na mesma transação. A proteção do último proprietário e o consumo de convite exigem bloqueio/condição transacional e testes reais de concorrência em PostgreSQL. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html]

O acesso por e-mail atende à decisão de produto, mas deve ser tratado como autenticação de fator único e não como MFA ou autenticação resistente a phishing. A NIST proíbe e-mail como autenticador out-of-band em contextos federais de maior garantia; aqui ele é um canal de conveniência/recuperação compatível com o risco comunitário, protegido por códigos curtos, single-use e forte anti-automação. [CITED: https://pages.nist.gov/800-63-4/sp800-63b.html]

**Primary recommendation:** construir uma camada de identidade própria e modular sobre `oauth4webapi`, cookies Fastify, Drizzle/PostgreSQL e Redis, com RBAC escopado puro, sessão opaca revogável e todos os provedores externos escondidos por ports/adapters. [VERIFIED: npm registry]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tela Discord/OTP, onboarding e gestão de sessões | Browser / Client | Frontend Server (SSR) | Renderiza estado e coleta entrada; nunca decide autenticação/autorização nem recebe tokens de provedor. [CITED: https://nextjs.org/docs/app/getting-started/proxy] |
| Proxy same-origin `/api/platform/*` | Frontend Server (SSR) | API / Backend | Simplifica cookies first-party e roteia ao Nest; não substitui o controle de acesso no API. [CITED: https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites] |
| OAuth Discord, OTP, sessão e step-up | API / Backend | Database / Storage | O servidor troca códigos, verifica desafios, emite referência opaca e mantém credenciais fora do browser. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x19-V10-OAuth-and-OIDC.md] |
| Organizações, memberships e convites | API / Backend | Database / Storage | Regras e transações são autoridade central; PostgreSQL preserva invariantes concorrentes. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html] |
| Matriz RBAC e decisão contextual | API / Backend | Database / Storage | A decisão é server-side e usa organização/campeonato explícitos e assignments atuais. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html] |
| Auditoria e outbox | Database / Storage | API / Backend | O registro deve confirmar atomicamente com a mudança sensível e depois ser entregue pelo worker. [VERIFIED: codebase grep] |
| Entrega de e-mail | API / Backend (worker) | External provider | Worker resolve delivery criptografada e chama um adapter idempotente; request HTTP não depende do provedor. [CITED: https://resend.com/docs/api-reference/emails/send-email] |
| Logo da organização | Database / Storage + object storage | CDN / Static | Banco guarda metadados/chave; bytes devem passar por adapter de storage com validação de tipo/tamanho. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `oauth4webapi` [VERIFIED: npm registry] | 3.8.7 (2026-08-11) | Authorization Code, validação OAuth e revogação | Implementa primitivas RFC sem possuir sessões, organizações ou schema; documentação oficial cobre state, PKCE e revocation. [CITED: https://github.com/panva/oauth4webapi] |
| `@fastify/cookie` [VERIFIED: npm registry] | 11.1.2 (2026-07-15) | Parse/serialização e assinatura de cookies | Release compatível com Fastify 5 e suporta atributos seguros e prefixo `__Host-`. [CITED: https://github.com/fastify/fastify-cookie] |
| `@fastify/csrf-protection` [VERIFIED: npm registry] | 8.0.1 (2026-08-02) | Token CSRF ligado à sessão/cookie | Plugin oficial Fastify 5 com hooks e binding customizável de usuário. [CITED: https://github.com/fastify/csrf-protection] |
| `drizzle-orm` [VERIFIED: codebase package lock] | 0.45.2 | Schema, migrações e transações PostgreSQL | Já é o padrão do repositório; suporta transações e constraints/indexes SQL. [CITED: https://orm.drizzle.team/docs/transactions] |
| `postgres` [VERIFIED: codebase package lock] | 3.4.9 | Driver PostgreSQL | Já está integrado ao package database e permite SQL explícito para locks. [VERIFIED: codebase grep] |
| `zod` [VERIFIED: codebase package lock] | 4.4.3 | Validação de config e contratos | Já valida config/contratos compartilhados e impede input não validado no domínio. [VERIFIED: codebase grep] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `rate-limiter-flexible` [VERIFIED: npm registry] | 11.2.0 (2026-06-08) | Limites atômicos e multidimensionais em Redis | OTP request/verify, callback OAuth e convites; o `@fastify/rate-limit` existente continua como perímetro grosseiro. [CITED: https://github.com/animir/node-rate-limiter-flexible] |
| `resend` [VERIFIED: npm registry] | 6.21.0 (2026-08-20) | Adapter inicial de e-mail | Somente no worker, atrás de `EmailSender`; a API grava outbox e nunca chama o provedor inline. [CITED: https://resend.com/docs/api-reference/emails/send-email] |
| `node:crypto` [VERIFIED: Node.js official docs] | Node 24.19.0 | CSPRNG, SHA-256, HMAC, timing-safe compare, AES-GCM | Sessão/convite/OTP e envelope de entrega, sem dependência externa. [CITED: https://nodejs.org/api/crypto.html] |
| `vitest` [VERIFIED: codebase package lock] | 4.1.11 | Unitários, integração e matrizes de autorização | Infraestrutura de teste já configurada no monorepo. [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `oauth4webapi` | Better Auth 1.7 beta | Better Auth fornece Discord/OTP/organizations, mas a integração Nest é community-maintained/beta e seu schema/políticas competem com os escopos já fechados e o outbox do projeto. [CITED: https://better-auth.com/docs/beta/integrations/nestjs] |
| Sessão opaca DB | JWT stateless | JWT mantém permissões antigas até expirar/revogar por infraestrutura extra; não atende tão diretamente revogação por dispositivo e mudança de papel imediata. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html] |
| RBAC puro do produto | CASL/Casbin | A matriz é finita e específica; uma DSL adicionaria tradução e risco de divergência sem benefício nesta fase. [ASSUMED] |
| Resend adapter | SMTP direto/outro provedor | SMTP também deve implementar retry, idempotência e observabilidade; o port preserva troca futura sem alterar casos de uso. [ASSUMED] |

**Installation:**

```bash
pnpm --filter @pubg-camp/api add oauth4webapi @fastify/cookie @fastify/csrf-protection rate-limiter-flexible
pnpm --filter @pubg-camp/worker add resend
```

As versões foram confirmadas com `npm view <package> version time repository dist` em 2026-08-20; nenhum pacote selecionado declara `postinstall`. [VERIFIED: npm registry]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `oauth4webapi` | npm | ~4 anos | ~10.8M/semana | `github.com/panva/oauth4webapi` | OK | Approved [VERIFIED: npm registry] |
| `@fastify/cookie` | npm | ~4 anos | ~2.1M/semana | `github.com/fastify/fastify-cookie` | OK | Approved [VERIFIED: npm registry] |
| `@fastify/csrf-protection` | npm | ~4 anos | ~70K/semana | `github.com/fastify/csrf-protection` | OK | Approved [VERIFIED: npm registry] |
| `rate-limiter-flexible` | npm | ~8 anos | ~2.5M/semana | `github.com/animir/node-rate-limiter-flexible` | OK | Approved [VERIFIED: npm registry] |
| `resend` | npm | ~9 anos | ~8.4M/semana | `github.com/resend/resend-node` | OK | Approved [VERIFIED: npm registry] |

`slopcheck` 0.6.1 foi instalado com o Python já empacotado no workspace; como essa versão expõe `scan` e não `install`, cada pacote foi verificado com `slopcheck scan --pkg npm --json`. Todos retornaram `OK`. [VERIFIED: slopcheck 0.6.1]

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck 0.6.1]

**Packages flagged as suspicious [SUS]:** none. [VERIFIED: slopcheck 0.6.1]

## Architecture Patterns

### System Architecture Diagram

```text
Browser / Next 16
  ├─ Login Discord ───────────────────────────────────────────────┐
  ├─ Solicitar/verificar OTP ─────────────────────────────────┐   │
  ├─ Sessões / organização / convite ─────────────────────┐   │   │
  └─ cookie __Host-session + header CSRF                  │   │   │
                                                          ▼   ▼   ▼
                                      same-origin /api/platform/*
                                                          │
                                                          ▼
NestJS 11 / Fastify 5
  public explícito ──► OAuth transaction / OTP challenge
  protegido ─────────► Global SessionGuard
                           │ sessão válida?
                     não ──┴──► 401 + security log
                     sim
                      ▼
                Global PermissionGuard
                org + tournament scope explícitos?
                     não ─────► 403 + security log
                     sim
                      ▼
             use case + tenant-aware repository
                      │
                      ▼
PostgreSQL: mutação + audit_event + outbox (uma transação)
                      │
                      ▼
BullMQ/Redis ──► Worker ──► EmailSender adapter ──► Resend

Discord OAuth boundary:
Nest callback ──► Discord token endpoint ──► /users/@me ──► revoke token
                 (client secret só no servidor; nunca no Browser)
```

O fluxo separa entrada pública, autenticação, autorização e mutação; cada seta que cruza uma fronteira externa usa um adapter e cada decisão protegida acontece no API. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html]

### Recommended Project Structure

```text
apps/
├── api/src/
│   ├── identity/          # OAuth, OTP, sessões, dispositivos e identity linking
│   ├── organizations/     # organizações, memberships, convites e ownership
│   ├── authorization/     # guards/decorators e carregamento do contexto
│   └── audit/             # gravação append-only e projeções autorizadas
├── web/src/app/
│   ├── (auth)/            # login Discord, OTP, callback e onboarding
│   └── (platform)/        # sessões, membros, convites e auditoria
└── worker/src/notifications/ # consumidor outbox + EmailSender
packages/
├── authorization/src/     # permission vocabulary + evaluator puro
├── contracts/src/         # schemas Zod HTTP sem segredos
├── database/src/
│   ├── schema/identity.ts
│   ├── schema/organizations.ts
│   ├── schema/authorization.ts
│   ├── schema/audit.ts
│   └── schema/notifications.ts
└── domain/src/            # IDs, eventos, clock e invariantes puras
```

Essa estrutura segue as fronteiras puras e adapters já estabelecidos na Fase 1. [VERIFIED: codebase grep]

### Pattern 1: OAuth Discord server-side e descartável

**What:** iniciar Authorization Code com `state` único ligado ao navegador; solicitar apenas `identify email`; trocar o `code` no API; buscar `/users/@me`; persistir somente `provider_subject`/perfil necessário; revogar imediatamente o token Discord. [CITED: https://docs.discord.com/developers/topics/oauth2]

**When to use:** login e vínculo explícito de Discord. O implicit grant não deve ser usado porque entrega token ao user agent. [CITED: https://docs.discord.com/developers/topics/oauth2]

**Required flow:**

1. Persistir `oauth_transactions(state_digest, browser_binding_digest, purpose, user/session?, expires_at, consumed_at)`; nunca aceitar callback sem transação viva. [CITED: https://datatracker.ietf.org/doc/html/rfc9700]
2. Enviar `state` e, se o sandbox Discord confirmar suporte atual, `code_challenge_method=S256`; armazenar/verificar o verifier somente no servidor. [CITED: https://datatracker.ietf.org/doc/html/rfc9700]
3. Token/revocation requests usam `application/x-www-form-urlencoded` e autenticação confidencial do cliente no servidor. [CITED: https://docs.discord.com/developers/topics/oauth2]
4. Validar usuário, vincular por `(provider='discord', provider_subject=discord_id)` e nunca por coincidência de e-mail. [CITED: https://docs.discord.com/developers/resources/user]
5. Revogar o access token e não persistir access/refresh tokens Discord. [CITED: https://docs.discord.com/developers/topics/oauth2]

### Pattern 2: Sessão opaca, rotacionável e server-side

**What:** gerar 32 bytes aleatórios, devolver o valor somente como cookie `__Host-session` e persistir apenas SHA-256 do token; toda request carrega sessão/usuário e verifica revogação/expiração no banco. Tokens de sessão precisam ser imprevisíveis e sem significado. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html]

**Cookie contract:** `Secure` em produção, `HttpOnly`, `SameSite=Lax`, `Path=/`, sem `Domain`, sem persistência em `localStorage`/`sessionStorage`. `Lax` preserva navegação top-level de OAuth/convites; CSRF continua obrigatório em métodos inseguros. [CITED: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie]

**Lifecycle:** 30 dias de inatividade deslizante conforme D-06; renovação e `last_seen_at` coalescidas a cada cinco minutos para conter write amplification; máximo absoluto recomendado de 90 dias; rotação após autenticação/step-up e revogação dos demais tokens em D-08. Os intervalos de coalescing e máximo absoluto são decisões de implementação propostas. [ASSUMED]

```typescript
// Source: https://nodejs.org/api/crypto.html and OWASP Session Management Cheat Sheet
import { createHash, randomBytes } from "node:crypto";

const token = randomBytes(32).toString("base64url");
const tokenDigest = createHash("sha256").update(token).digest("hex");

reply.setCookie("__Host-session", token, {
  path: "/",
  httpOnly: true,
  secure: config.isProduction,
  sameSite: "lax",
});
```

### Pattern 3: OTP como desafio, não credencial persistente

**What:** resposta uniforme ao pedido; 8 dígitos; validade de 10 minutos; cinco tentativas; cooldown de 60 segundos; um novo desafio invalida o anterior; consumo atômico. Limitar por digest de e-mail, IP confiável e combinação email+IP no Redis. Esses números são a política inicial recomendada e devem ser testados/telemetrados. [ASSUMED]

Como códigos decimais têm baixa entropia, armazenar `HMAC-SHA-256(pepper, challenge_id || normalized_email || code)` e comparar em constant time; hash de senha lento isolado não impede ataque offline ao espaço pequeno. Respostas não devem revelar se o e-mail existe, e envio/validação precisam de throttling. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html]

O código e os links de ação não podem ficar em plaintext no outbox. Persistir um envelope AES-256-GCM curto com `key_version`, IV único, ciphertext e auth tag em `notification_deliveries`; o outbox referencia apenas `delivery_id`; após envio/expiração, apagar o ciphertext. O Node documenta GCM/auth tag e exige IV imprevisível e único. [CITED: https://nodejs.org/api/crypto.html]

### Pattern 4: Autorização em duas etapas, default-deny

**What:** um `SessionGuard` global autentica e um `PermissionGuard` global exige metadata explícita; somente endpoints decorados `@Public()` pulam autenticação. O Nest recomenda registrar guard global com `APP_GUARD` e marcar rotas públicas explicitamente. [CITED: https://docs.nestjs.com/security/authentication]

**When to use:** toda consulta/comando de produto. O permission input é `{ actorId, organizationId, tournamentScopeId?, permission }`; IDs ausentes, membership inativa ou scope de outra organização resultam em deny. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html]

```typescript
// Source: project-specific policy derived from D-13..D-15 and OWASP Authorization Cheat Sheet
export function can(input: AuthorizationInput, snapshot: ActorSnapshot): boolean {
  const membership = snapshot.memberships.find(
    (item) => item.organizationId === input.organizationId && item.status === "active",
  );
  if (!membership) return false;

  if (membership.organizationRole === "owner") return ownerPermissions.has(input.permission);
  if (membership.organizationRole === "admin") return adminPermissions.has(input.permission);
  if (!input.tournamentScopeId) return false;

  return snapshot.assignments
    .filter((item) => item.tournamentScopeId === input.tournamentScopeId)
    .some((item) => rolePermissions[item.role]?.has(input.permission) === true);
}
```

As permissões não entram no cookie e não ficam em cache na primeira versão: consultar memberships/assignments atuais permite revogação imediata sem encerrar a sessão nas outras organizações. [ASSUMED]

### Pattern 5: Invariantes concorrentes e auditoria atômica

**What:** em aceitação de convite, transferência/remoção do owner e mudança de papel, abrir transação, bloquear a organização (`SELECT ... FOR UPDATE`), recarregar invariantes, aplicar condição, gravar `audit_events` e outbox, então commit. Locks de linha bloqueiam writers concorrentes até o fim da transação. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html]

```typescript
// Source: https://orm.drizzle.team/docs/transactions and PostgreSQL row-lock docs
await db.transaction(async (tx) => {
  await tx.execute(sql`select id from organizations where id = ${organizationId} for update`);
  const owners = await repositories.memberships.countOwners(tx, organizationId);
  if (owners <= 1 && command.removesCurrentOwner) throw new LastOwnerError();

  const before = await repositories.memberships.get(tx, command.membershipId);
  const after = await repositories.memberships.apply(tx, command);
  await repositories.audit.append(tx, auditEvent({ before, after, reason: command.reason }));
  await enqueueOutbox(tx, organizationMemberChanged({ before, after }));
});
```

`CHECK` não deve tentar contar proprietários: PostgreSQL não suporta de forma segura constraints `CHECK` que dependem de outras linhas; a invariante é transacional e precisa de teste concorrente. [CITED: https://www.postgresql.org/docs/current/ddl-constraints.html]

### Pattern 6: Convite vinculado à identidade confirmada

**What:** token aleatório de 256 bits, somente digest no banco, uso único e 7 dias; a aceitação exige que o e-mail normalizado e verificado do usuário atual seja igual ao e-mail normalizado do convite. Consumo, membership, papéis, auditoria e outbox são uma transação condicional. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html]

Para reduzir vazamento por `Referer`, usar rota de aceitação sem scripts terceiros e `Referrer-Policy: no-referrer`; preferir token no fragmento, removê-lo do endereço no cliente e enviá-lo por POST same-origin protegido por CSRF. [CITED: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy]

### Component Responsibilities

| Component | Responsibility | Must not do |
|-----------|----------------|-------------|
| `IdentityService` | Orquestrar OAuth/OTP, linking, step-up e criação/rotação de sessão. | Importar SDK Resend ou retornar credenciais Discord. [ASSUMED] |
| `SessionRepository` | Resolver digest, expiração, rotação/revogação e device metadata. | Autorizar organização/campeonato. [ASSUMED] |
| `AuthorizationService` | Carregar snapshot atual e avaliar permission/scope. | Confiar em role vindo do body/query/cookie. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html] |
| `OrganizationService` | Criar org, convidar, aceitar/revogar e proteger owner. | Enviar e-mail inline ou ignorar transação. [ASSUMED] |
| `AuditWriter` | Append-only na mesma transação com actor/before/after/reason/correlation. | Registrar tokens, códigos ou payloads secretos. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md] |
| `EmailSender` | Traduzir mensagem tipada para provedor e idempotency key. | Conhecer domínio de membership ou sessão. [ASSUMED] |
| Next Proxy/rewrites | Redirecionamento otimista e roteamento same-origin. | Ser a única barreira de autorização. [CITED: https://nextjs.org/docs/app/getting-started/proxy] |

### Anti-Patterns to Avoid

- **Autorização somente no Next Proxy:** ele não substitui checagem junto à fonte de dados e pode ser contornado por chamadas diretas ao API. [CITED: https://nextjs.org/docs/app/getting-started/proxy]
- **JWT com roles/tenant embutidos:** cria permissões obsoletas e dificulta revogação imediata por dispositivo/organização. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html]
- **Auto-merge por e-mail Discord:** viola D-03 e permite account confusion se identidades tiverem histórico diferente. [ASSUMED]
- **`organizationId` opcional ou inferido de “organização ativa”:** produz BOLA/cross-tenant; o contexto protegido deve ser explícito e validado contra o recurso. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html]
- **Confiar em IP/user-agent como autenticação de dispositivo:** são sinais mutáveis; use-os somente para descrição/alerta, nunca para autorizar. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html]
- **Enviar OTP/link diretamente no request:** aumenta latência, duplica envios em retry e quebra atomicidade; usar outbox e idempotency key. [CITED: https://resend.com/docs/api-reference/emails/send-email]
- **Guardar OTP/link/token de sessão em plaintext:** vazamento do banco/outbox vira takeover imediato; guardar digest ou envelope criptografado curto. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html]
- **State-changing GET:** links devem abrir uma confirmação; consumo/revogação ocorre por POST protegido por CSRF. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html]
- **Usar `arctic`:** o repositório oficial marcou a biblioteca deprecated em julho de 2026; não adotar em código novo. [CITED: https://github.com/pilcrowonpaper/arctic]

## Proposed Permission Matrix

A permission vocabulary precisa ser enumerada em TypeScript e exercitada por teste table-driven; não criar strings livres, wildcards ou linguagem de políticas. [ASSUMED]

| Capability | Owner | Admin | Referee (tournament) | Registrations (tournament) | Broadcast (tournament) | Analyst (tournament) |
|------------|-------|-------|-----------------------|----------------------------|------------------------|----------------------|
| Organização: settings/logo | allow | allow | deny | deny | deny | deny |
| Organização: invite/revoke non-owner | allow | allow | deny | deny | deny | deny |
| Organização: role operacional | allow | allow | deny | deny | deny | deny |
| Organização: transferir ownership/remover último owner | allow com step-up/invariante | deny | deny | deny | deny | deny |
| Auditoria completa da organização | allow | allow | deny | deny | deny | deny |
| Auditoria própria | allow | allow | allow (self only) | allow (self only) | allow (self only) | allow (self only) |
| Partida/resultado/penalidade | allow | allow | allow | deny | deny | read |
| Inscrição/roster/pagamento/check-in | allow | allow | deny | allow | deny | read |
| Transmissão/overlay/publicação | allow | allow | deny | deny | allow | read |
| Estatísticas/resultados/export | allow | allow | read | read | read | allow |

Esta é a granularidade inicial recomendada derivada de D-13–D-17; o planner deve transformar cada célula em permissões nomeadas e testes. [ASSUMED]

Até o domínio de campeonato surgir na Fase 3, criar `authorization_scopes(id, organization_id, kind='tournament')` como identidade mínima estável e fazer o campeonato futuro referenciar esse mesmo ID; isso evita assignments com `tournament_id` solto ou sem FK. [ASSUMED]

## Proposed Data Model

| Table | Key invariants |
|-------|----------------|
| `users` | sujeito interno estável, status e timestamps; não contém credencial. [ASSUMED] |
| `identities` | unique `(provider, provider_subject)`; vínculo explícito ao user; provider enum Discord/email. [ASSUMED] |
| `verified_emails` | e-mail canonicalizado, `verified_at`, unique normalized email; alteração exige step-up. [ASSUMED] |
| `auth_challenges` | purpose, HMAC, tentativas, expiração, superseded/consumed; nunca código plaintext. [ASSUMED] |
| `oauth_transactions` | state/browser-binding digests, purpose, expiry, consumed, user/session opcional; one-use. [ASSUMED] |
| `sessions` | token digest unique, user/device, issued/last_seen/inactivity/absolute expiry, reauth, revoked/reason. [ASSUMED] |
| `devices` | user + device digest unique, label, first/last seen, user-agent resumido e geografia aproximada. [ASSUMED] |
| `organizations` | tenant root, nome, logo metadata, owner invariant coordenada pela transação. [ASSUMED] |
| `organization_memberships` | unique `(organization_id,user_id)`, status e org role owner/admin/member. [ASSUMED] |
| `authorization_scopes` | composite ownership `(organization_id,id)`, kind tournament. [ASSUMED] |
| `role_assignments` | membership + scope + operational role, composite unique; scope pertence à mesma org. [ASSUMED] |
| `invitations` | token digest unique, org, normalized email, role payload validado, 7d, accepted/revoked. [ASSUMED] |
| `audit_events` | append-only: org/scope, actor, action, target, reason, before/after JSON, correlation, timestamp. [ASSUMED] |
| `notification_deliveries` | template, recipient, encrypted short-lived payload/key version, status/idempotency. [ASSUMED] |

Colocar `organization_id` em toda tabela tenant-owned e preferir FKs compostas que comprovem que membership/scope/target pertencem à mesma organização. RLS pode virar defesa adicional no futuro, mas não substitui repositórios tenant-aware; table owners e roles privilegiadas podem contornar políticas, e contexto por transação acrescenta operação que a fase ainda não possui. [CITED: https://www.postgresql.org/docs/current/ddl-rowsecurity.html]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Validação do protocolo OAuth | Parser próprio de callback/token response | `oauth4webapi` | Cobre parâmetros, erros e validações RFC que mudam e são fáceis de omitir. [CITED: https://github.com/panva/oauth4webapi] |
| Aleatoriedade/crypto | RNG, cifra ou hash custom | `node:crypto` CSPRNG/HMAC/AES-GCM | Criptografia caseira falha em nonce, integridade ou comparação. [CITED: https://nodejs.org/api/crypto.html] |
| Cookies | Montar `Set-Cookie` manual | `@fastify/cookie` | Serialização, assinatura e flags compatíveis com Fastify. [CITED: https://github.com/fastify/fastify-cookie] |
| Token CSRF | Token sem binding/validação custom | `@fastify/csrf-protection` + Origin allowlist | SameSite sozinho não basta e token precisa estar ligado ao contexto. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html] |
| Rate limiter distribuído | Contador em memória | `rate-limiter-flexible` + Redis existente | Várias instâncias precisam compartilhar consumo, cooldown e bloqueio. [CITED: https://github.com/animir/node-rate-limiter-flexible] |
| Retry de e-mail | Loop inline no endpoint | Outbox/BullMQ existente + Resend idempotency | Evita perda/duplicação entre commit e falha externa. [CITED: https://resend.com/docs/api-reference/emails/send-email] |
| Linguagem de policy | DSL/wildcards próprios | Enum finito + evaluator puro | A necessidade atual é uma matriz fechada; DSL introduz semântica difícil de auditar. [ASSUMED] |

**Key insight:** o produto deve escrever suas regras de domínio finitas, mas não os protocolos/controles de segurança genéricos que já possuem implementações testadas e documentação normativa. [ASSUMED]

## Common Pitfalls

### Pitfall 1: Login CSRF e account substitution no callback Discord

**What goes wrong:** um `code` iniciado por outro navegador é aceito e liga a conta errada. [CITED: https://datatracker.ietf.org/doc/html/rfc9700]

**Why it happens:** callback valida apenas o `code`, sem state one-use e binding ao navegador. [CITED: https://docs.discord.com/developers/topics/oauth2]

**How to avoid:** state aleatório/digest, cookie de pré-auth ligado à transação, expiry/consume atômicos, redirect URI exata e PKCE S256 quando confirmado. [CITED: https://datatracker.ietf.org/doc/html/rfc9700]

**Warning signs:** callbacks funcionam sem cookie inicial, state reutilizável ou token Discord aparece em URL/log. [ASSUMED]

### Pitfall 2: Enumeração, brute force e mail bombing no OTP

**What goes wrong:** atacante descobre contas, tenta todo espaço do código ou dispara volume de e-mail. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html]

**Why it happens:** respostas/timing diferentes, limiter só por IP e códigos reutilizáveis. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html]

**How to avoid:** resposta/timing uniformes, HMAC, expiry/single-use, supersede, limites Redis por email/IP/composição e métricas. [ASSUMED]

**Warning signs:** 404 para e-mail desconhecido, múltiplos códigos simultâneos válidos ou contador reinicia por pod. [ASSUMED]

### Pitfall 3: Cookie seguro sem CSRF completo

**What goes wrong:** site externo força POST autenticado. `SameSite` reduz, mas não elimina todos os cenários e não substitui token. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html]

**How to avoid:** CSRF token em header, binding à sessão, Origin/Referer exact allowlist, métodos GET sem efeito e CORS estrito/same-origin. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x12-V3-Web-Frontend-Security.md]

**Warning signs:** mutações aceitam form POST sem header ou `Origin: null` indiscriminadamente. [ASSUMED]

### Pitfall 4: Vazamento cross-tenant/BOLA

**What goes wrong:** usuário de org A acessa recurso de org B alterando ID. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html]

**Why it happens:** lookup por resource ID sem org/scope, ou guard só verifica que usuário pertence a alguma organização. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html]

**How to avoid:** contexto explícito, FK composta, query `where org_id = ? and id = ?`, permission guard e testes negativos para toda permissão. [ASSUMED]

**Warning signs:** repository methods `findById(id)` em entidades tenant-owned. [ASSUMED]

### Pitfall 5: Corrida do último owner e convite duplicado

**What goes wrong:** duas requests passam pela checagem e deixam zero owners ou aceitam duas vezes o convite. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html]

**How to avoid:** lock de uma linha coordenadora estável (organization), recheck dentro da transação e update condicional `consumed_at is null`. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html]

**Warning signs:** unit test passa, mas não existe teste concorrente em PostgreSQL real. [ASSUMED]

### Pitfall 6: Auditoria ou e-mail fora da transação

**What goes wrong:** estado muda sem audit/outbox ou e-mail é enviado para transação que depois falha. [ASSUMED]

**How to avoid:** mutation + `audit_events` + outbox no mesmo `db.transaction`; worker idempotente depois do commit. [VERIFIED: codebase outbox pattern]

**Warning signs:** SDK Resend importado no módulo HTTP ou `audit.append` depois do commit. [ASSUMED]

### Pitfall 7: Confundir aviso de novo dispositivo com device binding

**What goes wrong:** mudança de IP/user-agent derruba usuário legítimo ou atacante imita metadados. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html]

**How to avoid:** device cookie opaco como sinal não-autenticador; IP/geo somente em alerta; confiança continua no token de sessão. [ASSUMED]

**Warning signs:** autorização compara IP atual com IP do login. [ASSUMED]

## Code Examples

### Guard global com public explícito

```typescript
// Source: https://docs.nestjs.com/security/authentication
@Module({
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class SecurityModule {}
```

O guard de permissão deve falhar se a rota protegida não declarar permission metadata; isso transforma esquecimento do desenvolvedor em deny, não allow. [ASSUMED]

### Verificação do contexto tenant no repository

```typescript
// Source: project-specific pattern derived from OWASP Multi-Tenant Security Cheat Sheet
const row = await db.query.organizationMemberships.findFirst({
  where: and(
    eq(organizationMemberships.organizationId, input.organizationId),
    eq(organizationMemberships.userId, actor.userId),
    eq(organizationMemberships.status, "active"),
  ),
});
if (!row) throw new ForbiddenException();
```

### CSRF em método inseguro

```typescript
// Source: https://github.com/fastify/csrf-protection
await fastify.register(fastifyCookie, { secret: config.cookieSigningKey });
await fastify.register(fastifyCsrf, {
  cookieOpts: { path: "/", httpOnly: true, secure: config.isProduction, sameSite: "lax" },
  getToken: (request) => request.headers["x-csrf-token"] as string | undefined,
  getUserInfo: (request) => request.auth?.sessionId ?? "preauth",
});
```

Além do plugin, rejeitar Origin/Referer que não corresponda à origem configurada e nunca confiar em `X-Forwarded-*` fora da cadeia de proxies conhecida. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OAuth implicit/token no browser | Authorization Code server-side, state e PKCE quando suportado | OAuth Security BCP RFC 9700, Jan 2025 | Remove token de URL/browser e endurece injection/login CSRF. [CITED: https://datatracker.ietf.org/doc/html/rfc9700] |
| Middleware frontend como autorização | Checks perto da fonte de dados/API | Next 16 docs atuais | Proxy faz redirecionamento otimista, não controle completo. [CITED: https://nextjs.org/docs/app/getting-started/proxy] |
| JWT com roles | Referência opaca + autorização live | Prática atual ASVS 5 | Revogação/papel têm efeito imediato. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md] |
| “RBAC global” | RBAC escopado + contexto/relacionamento | Prática atual OWASP multi-tenant | Impede papel operacional vazar entre campeonatos. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html] |
| E-mail inline | Outbox + worker + idempotência | Padrão já adotado na Fase 1 | Commit não depende de provedor e retries não duplicam ação. [VERIFIED: codebase grep] |
| OWASP ASVS 4.x | OWASP ASVS 5.0.0 | Maio de 2025 | IDs/capítulos atuais V3/V6/V7/V8/V10/V13/V15/V16 orientam esta fase. [CITED: https://github.com/OWASP/ASVS] |

**Deprecated/outdated:**

- `arctic`: repositório oficial deprecated desde julho de 2026; usar `oauth4webapi`. [CITED: https://github.com/pilcrowonpaper/arctic]
- Implicit Grant: Discord ainda documenta o fluxo, mas o BCP atual recomenda evitar exposição de access token no browser; não usar. [CITED: https://datatracker.ietf.org/doc/html/rfc9700]
- Autorização feita só por UI/Proxy: não protege endpoint nem dados; manter no Nest/repository. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Discord sem e-mail confirmado gera sessão provisória e exige OTP explícito antes de sessão confiável/administração. | Open Questions / Sessions | Pode adicionar fricção ou deixar D-07 sem canal de aviso. |
| A2 | Sessão tem máximo absoluto de 90 dias além dos 30 dias deslizantes. | Architecture Pattern 2 | Usuários podem esperar renovação indefinida; ausência do cap aumenta janela de token roubado. |
| A3 | OTP inicial: 8 dígitos, 10 min, 5 tentativas, cooldown 60 s e limites multidimensionais. | Architecture Pattern 3 | Limites podem ser rigorosos ou fracos para o tráfego real. |
| A4 | Step-up permanece fresco por 10 minutos. | Security / Sessions | Janela pode ser incompatível com UX/risco esperado. |
| A5 | `last_seen_at`/expiração são coalescidos a cada 5 minutos. | Architecture Pattern 2 | Mais writes ou menor precisão de revogação/UX. |
| A6 | Identidade que já pertence a outro user bloqueia vínculo e segue para suporte; nunca faz merge automático. | Identity linking | Sem processo de suporte, casos legítimos podem ficar presos. |
| A7 | Device cookie, user-agent e geo aproximada são sinais de apresentação/alerta, não autenticação. | Pitfall 7 | Definição de “novo dispositivo” pode gerar falsos avisos. |
| A8 | Payload secreto de notificação fica em envelope AES-GCM curto e é apagado após envio/expiração. | Architecture Pattern 3 | Política de retenção/key rotation precisa operação explícita. |
| A9 | `authorization_scopes` cria o placeholder de tournament na Fase 2 e a Fase 3 reutiliza o mesmo ID. | Proposed Permission Matrix | Se Fase 3 modelar ID diferente, haverá migração/integração. |
| A10 | Discord aceitará PKCE S256 no fluxo web atual; confirmar no sandbox antes de travar implementação. | OAuth Pattern | Se não aceitar, usar state/browser binding obrigatório e documentar a exceção. |

## Open Questions

1. **Discord sem e-mail utilizável**
   - What we know: o scope `email` inclui o e-mail quando a conta Discord possui um, e o recurso User permite ausência desse campo. [CITED: https://docs.discord.com/developers/resources/user]
   - What's unclear: D-07 exige aviso por e-mail, mas não define se Discord-only sem e-mail confirmado pode ter sessão confiável.
   - Recommendation: criar sessão provisória curta e concluir um vínculo por OTP explícito antes da sessão de 30 dias, criação de organização ou aceite de convite. [ASSUMED]

2. **Máximo absoluto de sessão**
   - What we know: D-06 trava 30 dias com renovação por atividade; OWASP recomenda idle e absolute timeout server-side. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html]
   - What's unclear: não há teto absoluto decidido.
   - Recommendation: 90 dias absolutos, depois reautenticação completa. [ASSUMED]

3. **PKCE Discord no ambiente real**
   - What we know: RFC 9700 recomenda PKCE S256 inclusive para clientes web; a documentação OAuth principal do Discord não descreve os parâmetros PKCE. [CITED: https://datatracker.ietf.org/doc/html/rfc9700]
   - What's unclear: suporte atual no tipo exato de aplicação/redirect do projeto.
   - Recommendation: tornar um teste de sandbox pré-requisito; manter state one-use/browser binding sempre; se o endpoint recusar PKCE, registrar a exceção e seguir o BCP para CSRF com state. [CITED: https://datatracker.ietf.org/doc/html/rfc9700]

4. **Credenciais operacionais de e-mail e Discord**
   - What we know: `.env.example` ainda não possui Discord OAuth nem Resend e nenhum domínio/remetente está configurado no workspace. [VERIFIED: codebase grep]
   - What's unclear: app Discord, redirect URLs, domínio verificado e remetente de produção.
   - Recommendation: implementar/testar com adapters fake e tornar sandbox Discord + Resend um checkpoint manual antes do smoke externo. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | build/tests/crypto | ✓ | 24.19.0 | — [VERIFIED: local command] |
| pnpm | workspace/install | ✓ | 11.17.0 | — [VERIFIED: local command] |
| Git | commits | ✓ | 2.55.x | — [VERIFIED: local command] |
| PostgreSQL service/`psql` | DB integration/concurrency | ✗ | — | CI service container ou host com Docker Compose da Fase 1. [VERIFIED: local command] |
| Redis/`redis-cli` | OTP limiter/BullMQ | ✗ | — | Fake/in-memory somente em unit; Redis real obrigatório em integração/CI. [VERIFIED: local command] |
| Docker | stack local | ✗ | — | CI/host com Docker; não há fallback fiel local para locks PostgreSQL. [VERIFIED: local command] |
| Discord application credentials | OAuth sandbox | ✗ | — | `DiscordIdentityProvider` fake; checkpoint manual para sandbox. [VERIFIED: codebase grep] |
| Resend API key/domain | E-mail real | ✗ | — | `EmailSender` fake/outbox; checkpoint manual antes de produção. [VERIFIED: codebase grep] |

**Missing dependencies with no fallback:** PostgreSQL real é necessário para o gate de concorrência; nesta máquina Docker/psql não estão disponíveis, portanto esses testes devem rodar em CI ou outro host. [VERIFIED: local command]

**Missing dependencies with fallback:** Redis, Discord e Resend podem ser substituídos por fakes determinísticos durante unit/API integration; smoke externo continua dependente das credenciais/serviços. [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 [VERIFIED: codebase package lock] |
| Config file | configs existentes por workspace; adicionar projects/setup de integração na Wave 0. [VERIFIED: codebase grep] |
| Quick run command | `pnpm --filter @pubg-camp/api test` [VERIFIED: codebase package scripts] |
| Full suite command | `pnpm ci:verify` + suite de integração PostgreSQL/Redis [VERIFIED: codebase package scripts] |

### Test Layers

| Layer | Scope | Infrastructure |
|-------|-------|----------------|
| Pure unit | OTP policy, session lifecycle, permission matrix, invitation/owner invariants | Injected clock/RNG, no I/O. [ASSUMED] |
| Adapter contract | Discord OAuth, EmailSender, rate limiter | Fakes + captured HTTP fixtures sem tokens reais. [ASSUMED] |
| API integration | Fastify inject, cookies, CSRF, guards, response redaction | Nest testing app + fake external adapters. [ASSUMED] |
| Persistence integration | migrations, transactions, unique/composite FKs, locks e atomic outbox/audit | PostgreSQL real; Redis real para limiter. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html] |
| Concurrency | duplo aceite de convite, dupla remoção/transferência do último owner | duas conexões/transações coordenadas em PostgreSQL real. [ASSUMED] |
| Manual sandbox | Discord redirects/PKCE, entrega Resend e flags Secure atrás do proxy TLS | Credenciais não presentes; checkpoint manual. [ASSUMED] |

Não usar SQLite/PGlite como substituto do gate de persistência: o comportamento crítico desta fase depende de locks de linha, constraints PostgreSQL e concorrência entre conexões. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-001 | state/binding one-use, callback, identity por Discord ID, token revogado | unit + API integration | `pnpm --filter @pubg-camp/api test -- identity/oauth` | ❌ Wave 0 |
| AUTH-002 | OTP genérico, HMAC, expiry, tentativas, supersede e cooldown | unit + Redis integration | `pnpm --filter @pubg-camp/api test -- identity/otp` | ❌ Wave 0 |
| AUTH-003 | emissão, rotação, 30d sliding, absolute, revogação individual/outros devices | API + DB integration | `pnpm --filter @pubg-camp/api test -- identity/session` | ❌ Wave 0 |
| AUTH-004 | mesmo user em múltiplas orgs sem “org ativa” implícita | DB/API integration | `pnpm --filter @pubg-camp/api test -- organizations/multi-org` | ❌ Wave 0 |
| AUTH-005 | default deny e cross-org/scope IDOR | table unit + API integration | `pnpm --filter @pubg-camp/authorization test && pnpm --filter @pubg-camp/api test -- authorization` | ❌ Wave 0 |
| AUTH-006 | nenhum token/secret em HTML, JSON, URL ou logs | contract/security integration | `pnpm --filter @pubg-camp/api test -- security/secret-boundary` | ❌ Wave 0 |
| ORG-001 | criação atômica com owner inicial | DB integration | `pnpm --filter @pubg-camp/api test -- organizations/create` | ❌ Wave 0 |
| ORG-002 | convite/revogação/email binding/single-use/7d | DB/API + concurrency | `pnpm --filter @pubg-camp/api test -- organizations/invitation` | ❌ Wave 0 |
| ORG-003 | seis papéis e escopos corretos | table unit | `pnpm --filter @pubg-camp/authorization test` | ❌ Wave 0 |
| ORG-004 | união estrita sem promoção | exhaustive/property-like table unit | `pnpm --filter @pubg-camp/authorization test` | ❌ Wave 0 |
| ORG-005 | último owner protegido sob corrida | PostgreSQL concurrency | `pnpm --filter @pubg-camp/database test -- last-owner.concurrent` | ❌ Wave 0 |
| AUD-001 | actor/date/reason/before/after e visibilidade admin/self | DB/API integration | `pnpm --filter @pubg-camp/api test -- audit` | ❌ Wave 0 |
| NFR-005 | CSRF/origin, rate limits, config, upload restrictions e least privilege | security integration | `pnpm --filter @pubg-camp/api test -- security` | ❌ Wave 0 |

### Mandatory Abuse/Negative Cases

- OAuth state ausente/incorreto/reutilizado/expirado e callback sem pre-auth binding devem falhar sem criar sessão. [CITED: https://datatracker.ietf.org/doc/html/rfc9700]
- OTP deve falhar após cinco erros, expiração/consumo/supersede e deve manter resposta indistinguível para e-mail existente/inexistente. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html]
- POST sem CSRF, com token de outra sessão e com Origin externo deve falhar; GET não pode mutar. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html]
- Role correta na org errada e role operacional no campeonato errado devem falhar; todo permission enum precisa de allow/deny explícitos para cada role. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html]
- Duas transações concorrentes não podem consumir o mesmo convite nem remover/transferir o último owner duas vezes. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html]
- Falha antes do commit não deixa audit/outbox; retry do worker não duplica efeito externo para a mesma idempotency key. [CITED: https://resend.com/docs/api-reference/emails/send-email]
- Revogação de membership/papel afeta a próxima request sem esperar expiração de cookie; outras orgs continuam acessíveis. [ASSUMED]

### Sampling Rate

- **Per task commit:** teste filtrado do módulo alterado, alvo abaixo de 30 segundos. [ASSUMED]
- **Per wave merge:** `pnpm test` + integração PostgreSQL/Redis da fase. [ASSUMED]
- **Phase gate:** `pnpm ci:verify`, migrations do zero, suite de abuso e concorrência verdes antes de `$gsd-verify-work`. [ASSUMED]

### Wave 0 Gaps

- [ ] `packages/authorization/src/authorization.spec.ts` — matriz completa ORG-003/004 e AUTH-005. [ASSUMED]
- [ ] `apps/api/src/identity/**/*.spec.ts` — clock/RNG/provider/email/rate-limiter fakes para AUTH-001/002/003. [ASSUMED]
- [ ] `apps/api/test/security.integration.spec.ts` — Fastify inject, cookies, CSRF, origin e boundary de segredos. [ASSUMED]
- [ ] `packages/database/test/identity-organizations.integration.spec.ts` — migrations/transactions/FKs. [ASSUMED]
- [ ] `packages/database/test/last-owner.concurrent.spec.ts` e `invitation.concurrent.spec.ts` — duas conexões PostgreSQL reais. [ASSUMED]
- [ ] Setup CI com PostgreSQL e Redis; local atual não dispõe de Docker/psql/redis-cli. [VERIFIED: local command]
- [ ] Adapters fake determinísticos e builders de actor/session/organization. [ASSUMED]

## Security Domain

### Applicable ASVS Categories

OWASP ASVS 5.0.0 é a versão estável atual publicada em maio de 2025. [CITED: https://github.com/OWASP/ASVS]

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Encoding and Sanitization | yes | Zod allowlist, queries Drizzle parametrizadas e output encoding React. [CITED: https://github.com/OWASP/ASVS] |
| V2 Validation and Business Logic | yes | anti-automation OTP/convite e invariantes concorrentes. [CITED: https://github.com/OWASP/ASVS] |
| V3 Web Frontend Security | yes | `__Host-` Secure/HttpOnly/SameSite, CSRF token e Origin. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x12-V3-Web-Frontend-Security.md] |
| V4 API and Web Service | yes | métodos corretos, contracts, limites de body e erros uniformes. [CITED: https://github.com/OWASP/ASVS] |
| V6 Authentication | yes | Discord code flow, OTP single-use, step-up e anti-enumeration. [CITED: https://github.com/OWASP/ASVS] |
| V7 Session Management | yes | 256-bit opaque tokens, digest, timeouts/rotate/revoke. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md] |
| V8 Authorization | yes | service-side default deny, org/scope explícitos, efeito imediato. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md] |
| V10 OAuth and OIDC | yes | state one-use/browser binding, code flow e secret server-side. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x19-V10-OAuth-and-OIDC.md] |
| V11 Cryptography | yes | Node crypto, HMAC/AES-GCM, external key e rotation version. [CITED: https://github.com/OWASP/ASVS] |
| V12 Secure Communication | yes | TLS, Secure cookies e trusted proxy explícito. [CITED: https://github.com/OWASP/ASVS] |
| V13 Configuration | yes | Zod env, secrets fora de código e redaction. [CITED: https://github.com/OWASP/ASVS] |
| V14 Data Protection | yes | minimização de PII e ciphertext temporário sem secrets no audit/log. [CITED: https://github.com/OWASP/ASVS] |
| V15 Secure Coding and Architecture | yes | transações, concorrência e adapters. [CITED: https://github.com/OWASP/ASVS] |
| V16 Security Logging and Error Handling | yes | logs estruturados/redigidos, audit separado e correlation ID. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md] |

### STRIDE Threat Inventory

| Threat | STRIDE | Asset/Entry | Standard Mitigation | Verification |
|--------|--------|-------------|---------------------|--------------|
| OAuth login CSRF/code injection/account substitution | Spoofing, Tampering | `/auth/discord/callback` | state one-use + browser binding, redirect exata, PKCE sandbox, token server-side. [CITED: https://datatracker.ietf.org/doc/html/rfc9700] | mismatch/replay/callback sem binding |
| Discord token em browser/log/URL | Information Disclosure | token exchange | server-only, response redaction, `Cache-Control: no-store`, revogar após profile. [CITED: https://docs.discord.com/developers/topics/oauth2] | secret-boundary test/log capture |
| OTP enumeration/brute force/mail bombing | Spoofing, DoS | request/verify OTP | resposta uniforme, HMAC, expiry/single-use, Redis limits por múltiplas chaves. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html] | abuse matrix/limiter integration |
| Session fixation/hijack/replay | Spoofing | cookie | 256-bit opaque, digest DB, rotate/revoke/timeouts, cookie flags. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html] | rotation/reuse/revocation tests |
| CSRF em operação sensível | Tampering | POST/PATCH/DELETE | token ligado à sessão, Origin/Referer, no state-changing GET, step-up. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html] | missing/wrong token/origin tests |
| Cross-tenant BOLA | Elevation, Information Disclosure | IDs org/scope/resource | guard global, contexto explícito, query tenant-aware, FK composta. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html] | role certa/org errada |
| Role/last-owner race | Tampering, Elevation | membership commands | row lock org, transaction, recheck e conditional update. [CITED: https://www.postgresql.org/docs/17/explicit-locking.html] | duas conexões coordenadas |
| Convite encaminhado/reutilizado | Spoofing, Elevation | invite token | digest 256-bit, e-mail verificado exato, 7d, one-use atômico. [ASSUMED] | wrong email/double accept |
| Ação sensível repudiada/audit adulterado | Repudiation, Tampering | org commands/audit | append-only app path, actor/time/reason/before/after/correlation na mesma tx. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md] | rollback/visibility tests |
| OTP/link plaintext no outbox | Information Disclosure | DB/worker | envelope AES-GCM short-lived, outbox só delivery ID, cleanup/key version. [CITED: https://nodejs.org/api/crypto.html] | DB assertion/no plaintext search |
| E-mail duplicado após retry | DoS, Repudiation | worker/provider | delivery state + provider idempotency key + retry bounded. [CITED: https://resend.com/docs/api-reference/emails/send-email] | duplicate job test |
| Permission cache obsoleto | Elevation | authorization | sem claims/cache inicialmente; leitura atual em toda request. [ASSUMED] | revoke then next-request deny |
| `X-Forwarded-*`/geo forjado | Spoofing | ingress/device alert | trust proxy configurado, sinal nunca autoriza. [CITED: https://fastify.dev/docs/latest/Reference/Server/#trustproxy] | untrusted header test |

### Security Logging vs Business Audit

Eventos de negócio sensíveis bem-sucedidos entram em `audit_events` e são visíveis conforme D-17. Falhas de login, OTP e autorização vão para security logs estruturados, com correlation ID e redaction, não para uma trilha de produto que o atacante possa inflar. Nunca registrar cookie, state, code, OTP, invite token, client secret, access token, e-mail completo ou payload criptográfico. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md]

Operações D-16 exigem `reauthenticated_at` dentro de 10 minutos e motivo não vazio; após linking, troca de e-mail ou ownership transfer, rotacionar a sessão atual e revogar todas as outras na mesma transação. A janela de 10 minutos é proposta e deve ser aceita no planejamento. [ASSUMED]

## Project Constraints (from AGENTS.md)

O arquivo `AGENTS.md` não existe fisicamente no checkout durante a pesquisa, mas a instrução de projeto injetada referencia `C:\Users\Liiiraa\.codex\RTK.md`; ela exige prefixar comandos de terminal com `rtk`. Todos os comandos desta pesquisa seguiram essa regra. [VERIFIED: injected project instruction]

Restrições arquiteturais já registradas no projeto: domínio puro não importa infraestrutura, integrações externas ficam em adapters, mudanças de schema incluem migração/teste, estado sensível grava outbox na mesma transação, e logs estruturados aplicam redaction. [VERIFIED: 02-CONTEXT.md and codebase grep]

## Sources

### Primary (HIGH confidence)

- [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2) — Authorization Code, scopes, token/revocation e requisitos de request.
- [Discord User resource](https://docs.discord.com/developers/resources/user) — subject estável e disponibilidade do e-mail.
- [OAuth 2.0 Security Best Current Practice, RFC 9700](https://datatracker.ietf.org/doc/html/rfc9700) — PKCE, state e ameaças atuais.
- [OWASP ASVS 5.0](https://github.com/OWASP/ASVS) — baseline atual e controles V3/V6/V7/V8/V10/V13/V15/V16.
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — tokens, cookies, rotação e timeouts.
- [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) — anti-enumeration, throttling e reautenticação.
- [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) — desafios de uso único, storage, expiry e respostas uniformes.
- [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — default deny, server-side e every-request checks.
- [OWASP Multi Tenant Security](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html) — isolamento e contexto tenant.
- [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — token, Origin e SameSite defense-in-depth.
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) — limitações de e-mail como autenticador.
- [NestJS Authentication](https://docs.nestjs.com/security/authentication) — `APP_GUARD` e public decorator.
- [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy) e [rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites) — limite da camada frontend e proxy same-origin.
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), [constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) e [row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — concorrência e isolamento.
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions) e [indexes/constraints](https://orm.drizzle.team/docs/indexes-constraints) — APIs persistentes.
- [Node crypto](https://nodejs.org/api/crypto.html) — CSPRNG, HMAC, SHA e AES-GCM.
- [Resend send email](https://resend.com/docs/api-reference/emails/send-email) — idempotency key.
- Repositórios oficiais de [`oauth4webapi`](https://github.com/panva/oauth4webapi), [`@fastify/cookie`](https://github.com/fastify/fastify-cookie), [`@fastify/csrf-protection`](https://github.com/fastify/csrf-protection) e [`rate-limiter-flexible`](https://github.com/animir/node-rate-limiter-flexible) — API/compatibilidade.

### Secondary (MEDIUM confidence)

- npm registry metadata em 2026-08-20 — versões, datas, downloads, repositories e ausência de `postinstall`. [VERIFIED: npm registry]
- `slopcheck` 0.6.1 — package legitimacy (`scan --pkg npm --json`) para todas as novas dependências. [VERIFIED: local command]

### Tertiary (LOW confidence)

- Nenhuma fonte terciária foi usada para decisões factuais. Propostas específicas do produto estão marcadas `[ASSUMED]` e enumeradas no Assumptions Log.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — package names confirmados em documentação oficial, registro correto e slopcheck; versões verificadas em 2026-08-20.
- Architecture: HIGH — alinha decisões fechadas, código existente, OAuth BCP, OWASP ASVS 5 e PostgreSQL oficial.
- OAuth Discord PKCE: MEDIUM — BCP é inequívoco, mas a documentação principal do Discord não declara suporte; sandbox é gate explícito.
- OTP/session policy values: MEDIUM — controles são normativos; valores de TTL/tentativas/cooldown/absolute timeout são propostas marcadas `[ASSUMED]`.
- Pitfalls/threats: HIGH — derivados de OWASP, RFC 9700 e concorrência PostgreSQL, com testes concretos.

**Research date:** 2026-08-20

**Valid until:** 2026-09-19 para stack estável; rever antes se Discord, Better Auth, Fastify plugins ou Next 16 tiverem mudança relevante.
