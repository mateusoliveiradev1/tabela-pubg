# Fase 2: Identidade, organizações e autorização — Mapa de padrões

**Mapeado:** 2026-08-20  
**Arquivos/grupos classificados:** 38  
**Analogs fortes encontrados:** 5 famílias  
**Escopo pesquisado:** `apps/{api,web,worker}`, `packages/{domain,contracts,config,database,queue,storage}`, configuração do workspace e artefatos da Fase 1

## Resumo para o planner

A Fase 1 estabeleceu cinco famílias úteis: domínio puro com IDs nominais e relógio injetável; contratos Zod compartilhados; persistência Drizzle com helper de outbox aceitando executor transacional; módulos Nest pequenos; e processos/rotas com configuração validada, logs redigidos e encerramento explícito. Não há analog existente para autenticação, guardas globais, OAuth, OTP, RBAC, locking PostgreSQL, e-mail ou componentes interativos. Nesses pontos, o planner deve usar os padrões prescritivos de `02-RESEARCH.md`, conservando as fronteiras da fundação.

Não copiar a instanciação direta de banco/Redis por `process.env` dentro de `HealthService`: ela é aceitável no probe técnico mínimo da Fase 1, mas os módulos funcionais desta fase precisam receber ports/repositories por injeção do Nest para permitir testes determinísticos.

## Classificação de arquivos

| Arquivo novo/modificado | Papel | Fluxo de dados | Analog mais próximo | Qualidade |
|---|---|---|---|---|
| `packages/domain/src/identity.ts` | model/utility | transform, event-driven | `packages/domain/src/index.ts` | exact-role |
| `packages/domain/src/organizations.ts` | model/utility | transform, event-driven | `packages/domain/src/index.ts` | exact-role |
| `packages/domain/src/index.ts` | config/barrel | transform | próprio arquivo | exact |
| `packages/authorization/{package.json,tsconfig.json}` | config | build/test | `packages/domain/{package.json,tsconfig.json}` | exact-role |
| `packages/authorization/src/index.ts` | service/utility | transform | `packages/domain/src/index.ts` + pesquisa da fase | partial |
| `packages/authorization/src/authorization.spec.ts` | test | transform | `packages/storage/src/index.test.ts` | role-match |
| `packages/contracts/src/{identity,organizations,audit}.ts` | model/contract | request-response | `packages/contracts/src/index.ts` | exact-role |
| `packages/contracts/src/index.ts` | config/barrel | transform | próprio arquivo | exact |
| `packages/contracts/src/{identity,organizations,audit}.test.ts` | test | request-response | `packages/contracts/src/index.test.ts` | exact-role |
| `packages/config/src/index.ts` | config | boot/transform | próprio arquivo | exact |
| `packages/config/src/index.test.ts` | test | transform | próprio arquivo | exact |
| `packages/database/src/schema/{identity,organizations,authorization,audit,notifications}.ts` | model/migration | CRUD | `packages/database/src/schema.ts` | exact-role |
| `packages/database/src/schema.ts` | config/barrel | CRUD | próprio arquivo | exact |
| `packages/database/src/repositories/{identity,sessions,organizations,authorization,audit,notifications}.ts` | service/repository | CRUD | `packages/database/src/outbox.ts` | role-match |
| `packages/database/src/index.ts` | provider/barrel | CRUD | próprio arquivo | exact |
| `packages/database/migrations/0001_identity_organizations.sql` + journal | migration | CRUD | `packages/database/migrations/0000_foundation.sql` | exact-role |
| `packages/database/test/identity-organizations.integration.spec.ts` | test | CRUD | `packages/database/src/outbox.test.ts` | partial |
| `packages/database/test/{invitation,last-owner}.concurrent.spec.ts` | test | concurrent CRUD | nenhum | none |
| `apps/api/src/identity/{identity.module,identity.controller,identity.service}.ts` | module/controller/service | request-response | `apps/api/src/{app.module,health/*}.ts` | role-match |
| `apps/api/src/identity/ports/{discord-identity-provider,email-delivery,auth-rate-limiter,token-generator}.ts` | provider/port | request-response/event-driven | `packages/storage/src/index.ts` interfaces | partial |
| `apps/api/src/identity/adapters/{discord-oauth,redis-auth-rate-limiter}.ts` | adapter/service | request-response | `packages/storage/src/index.ts` | role-match |
| `apps/api/src/identity/**/*.spec.ts` | test | request-response/transform | `apps/api/src/health/health.controller.test.ts` | role-match |
| `apps/api/src/organizations/{organizations.module,organizations.controller,organizations.service}.ts` | module/controller/service | CRUD | `apps/api/src/{app.module,health/*}.ts` | role-match |
| `apps/api/src/authorization/{authorization.module,authorization.service,session.guard,permission.guard,decorators}.ts` | middleware/service | request-response | nenhum | none |
| `apps/api/src/audit/{audit.module,audit.controller,audit.service,audit-writer}.ts` | module/controller/service | CRUD/event-driven | `apps/api/src/{app.module,health/*}.ts` + `packages/database/src/outbox.ts` | role-match |
| `apps/api/src/app.module.ts` | module | request-response | próprio arquivo | exact |
| `apps/api/src/main.ts` | config/bootstrap | request-response | próprio arquivo | exact |
| `apps/api/test/security.integration.spec.ts` | test | request-response | `apps/web/src/app/api/health/live/route.test.ts` | partial |
| `apps/worker/src/notifications/{processor,email-sender,resend-email-sender}.ts` | service/adapter | event-driven | `apps/worker/src/main.ts` + `packages/queue/src/index.ts` | role-match |
| `apps/worker/src/notifications/*.spec.ts` | test | event-driven | `apps/worker/src/health.test.ts` | role-match |
| `apps/worker/src/main.ts` | config/bootstrap | event-driven | próprio arquivo | exact |
| `apps/web/src/app/(auth)/**/{page,loading,error}.tsx` | component/route | request-response | `apps/web/src/app/page.tsx` | role-match |
| `apps/web/src/app/(platform)/**/{page,loading,error}.tsx` | component/route | request-response/CRUD | `apps/web/src/app/page.tsx` | role-match |
| `apps/web/src/app/api/platform/[...path]/route.ts` ou `next.config.ts` rewrite | route/config | request-response | `apps/web/src/app/api/health/*/route.ts` | role-match |
| `apps/web/src/components/ui/*` | component | transform/event-driven | nenhum | none |
| `apps/web/src/components/{identity,organizations,authorization,audit}/*` | component | request-response/CRUD | nenhum | none |
| `apps/web/src/app/globals.css` + `*.module.css` | config/component | transform | `apps/web/src/app/globals.css` | role-match; UI-SPEC authoritative |
| `apps/web/src/**/*.test.tsx` | test | request-response/event-driven | `apps/web/src/app/api/health/live/route.test.ts` | partial |

## Atribuições de padrões

### Domínio puro: `packages/domain/src/{identity,organizations}.ts`

**Analog:** `packages/domain/src/index.ts`

**IDs nominais e relógio injetável** (`packages/domain/src/index.ts:1-21`):

```typescript
export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type OrganizationId = Brand<string, "OrganizationId">;
export type TournamentId = Brand<string, "TournamentId">;

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
```

Aplicar a `UserId`, `IdentityId`, `SessionId`, `MembershipId`, `InvitationId`, `AuthorizationScopeId` e `AuditEventId`. Regras de expiração de OTP/convite/sessão, step-up, união de papéis e proteção do último owner recebem `Clock`; nenhuma usa `new Date()` internamente. O domínio não importa Nest, Drizzle, Redis, OAuth ou Resend, conforme `.dependency-cruiser.cjs:17-22`.

### Contratos HTTP: `packages/contracts/src/{identity,organizations,audit}.ts`

**Analog:** `packages/contracts/src/index.ts`

**Schema + tipo inferido + construção validada** (`packages/contracts/src/index.ts:1-12,30-40`):

```typescript
import { z } from "zod";

export const HealthResponseSchema = z.object({
  service: z.string().min(1),
  state: HealthStateSchema,
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

return HealthResponseSchema.parse({ service, state, timestamp: new Date().toISOString() });
```

Cada endpoint deve expor schema de input e output, tipos inferidos e respostas sem campos secretos. Separar requests de OTP, verificação, convite, sessão, membro, papel e auditoria; nunca incluir `code`, token Discord, digest, cookie, ciphertext ou credenciais futuras nos outputs. Os testes seguem `packages/contracts/src/index.test.ts:13-24`: `safeParse` para casos negativos e assertions estruturais para respostas válidas.

### Configuração e fronteira de segredos: `packages/config/src/index.ts`, `apps/api/src/main.ts`, `apps/worker/src/main.ts`

**Analogs:** `packages/config/src/index.ts` e bootstraps atuais

**Falha segura sem vazar valor** (`packages/config/src/index.ts:24-42`):

```typescript
const result = schema.safeParse(input);
if (result.success) return result.data;
const fields = result.error.issues.map((issue) => issue.path.join(".") || "environment");
throw new Error(`Invalid environment configuration: ${[...new Set(fields)].join(", ")}`);

secretKeyPattern.test(key) ? "[REDACTED]" : value;
```

Estender config com Discord client/redirect/secret, chaves cookie/CSRF/OTP/envelope, Resend, origem pública e TTLs. O padrão de `apps/api/src/main.ts:13-28` é validar antes de criar infraestrutura. Manter logs Pino estruturados; campos `state`, `code`, `otp`, `invite`, `email`, `authorization`, `cookie`, ciphertext e provider tokens precisam entrar na redaction, não em auditoria.

### Schema, migration e repositories tenant-aware

**Analogs:** `packages/database/src/schema.ts`, `packages/database/migrations/0000_foundation.sql`, `packages/database/src/index.ts`

**Drizzle explícito com índices e tipos inferidos** (`packages/database/src/schema.ts:10-36`):

```typescript
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("outbox_pending_available_idx").on(table.status, table.availableAt),
  ],
);

export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type NewOutboxEventRow = typeof outboxEvents.$inferInsert;
```

Dividir o schema pelos cinco arquivos indicados e reexportar no barrel usado por `createDatabase` (`packages/database/src/index.ts:1-18`). Toda tabela pertencente a tenant leva `organization_id`; usar uniques/FKs compostas para provar organização comum entre membership, scope e assignment. Tokens ficam apenas como digest; OTP/link de entrega fica em envelope curto, nunca plaintext. A migration gerada deve permanecer explícita e passar `db:check`/journal como `0000_foundation.sql:1-22`.

**Métodos de repository:** nunca criar `findById(id)` para recurso tenant-owned. A assinatura mínima é `(executor, organizationId, resourceId)`; comandos sensíveis recebem o executor da transação. Para convite e último owner, executar `SELECT ... FOR UPDATE` na linha da organização e recarregar a invariante dentro da mesma transação. Não existe analog concorrente no código: copiar a sequência normativa de `02-RESEARCH.md`, não improvisar com check prévio fora da transação.

### Outbox, auditoria e atomicidade

**Analog:** `packages/database/src/outbox.ts`

**Port transacional pequeno** (`packages/database/src/outbox.ts:5-8,28-32`):

```typescript
export interface InsertExecutor {
  insert(table: typeof outboxEvents): {
    values(value: NewOutboxEventRow): PromiseLike<unknown>;
  };
}

export async function appendOutboxEvent(executor: InsertExecutor, event: EventEnvelope): Promise<void> {
  await executor.insert(outboxEvents).values(toOutboxRecord(event));
}
```

`AuditWriter` e notification repository devem aceitar o mesmo executor/transaction, sem abrir conexão própria. Em criação de organização, aceite/revogação de convite, alteração de papel, revogação de membro, linking e transferência: mutação + `audit_events` + outbox confirmam juntas. `AuditWriter` é append-only na aplicação e recebe ator, data, motivo, before, after, correlation e escopo; nunca recebe segredo. O teste unitário de mapeamento copia `packages/database/src/outbox.test.ts:5-24`, com relógio/data fixos.

### Módulos, controllers e services Nest: identity, organizations e audit

**Analog:** `apps/api/src/health/{health.controller,health.service}.ts` e `apps/api/src/app.module.ts`

**Controller fino** (`apps/api/src/health/health.controller.ts:5-20`):

```typescript
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("ready")
  async ready(): Promise<HealthResponse> {
    return this.health.ready();
  }
}
```

Controllers da fase apenas extraem actor/contexto, validam DTO/contrato e chamam caso de uso; não acessam Drizzle, OAuth, Redis ou Resend. Organizar providers/controllers por módulo e importar os módulos no `AppModule`, seguindo `apps/api/src/app.module.ts:1-9`. Usar imports ESM locais com `.js` e imports de pacote via `@pubg-camp/*`.

**Erro de infraestrutura convertido na borda** (`apps/api/src/health/health.controller.ts:14-20`, `health.service.ts:32-43`): serviços não devem devolver stack/secret. Definir exceções de domínio tipadas e um filter HTTP uniforme; 401/403/404 cross-tenant não revela existência externa. OTP request e convite inválido mantêm respostas indistinguíveis quando exigido pelo contrato.

**Teste com fake injetado** (`apps/api/src/health/health.controller.test.ts:5-11`):

```typescript
const service = { live: () => ({ service: "api", state: "ok", timestamp: new Date().toISOString() }) };
const controller = new HealthController(service as HealthService);
expect(controller.live()).toMatchObject({ service: "api", state: "ok" });
```

Evoluir para ports tipados e fakes determinísticos; evitar casts nos novos testes quando uma interface de port resolver. OAuth, OTP e sessão precisam cobrir replay, expiry, supersede, rotação, revogação e ausência de segredo.

### Guards e autorização default-deny

**Analog:** nenhum guard existente; usar `02-RESEARCH.md` como fonte prescritiva.

Criar `SessionGuard` e `PermissionGuard` como `APP_GUARD` em `AuthorizationModule`. Somente `@Public()` ignora sessão. Em rota protegida, metadata de permissão ausente deve negar. O input sempre contém `actorId`, `organizationId`, `authorizationScopeId?` e uma permission enum; papel vindo de body/query/cookie é ignorado. A cada request, carregar memberships/assignments atuais; não inserir papéis no cookie nem cachear na v1. Testar tabela completa owner/admin/referee/registrations/broadcast/analyst, união estrita e papel certo em organização/campeonato errado.

### Ports/adapters de OAuth, limiter, storage e e-mail

**Analog:** `packages/storage/src/index.ts`

**Config separada, validação antes do SDK e interface estável** (`packages/storage/src/index.ts:24-40,53-81`):

```typescript
export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createStorage(config: StorageConfig) {
  const client = new S3Client({ /* config traduzida */ });
  return { /* operações pequenas */, close(): void { client.destroy(); } };
}
```

`DiscordIdentityProvider`, `AuthRateLimiter`, `TokenGenerator` e delivery port pertencem à borda consumidora, com adapters concretos separados. `oauth4webapi`, `rate-limiter-flexible` e Resend não entram em domínio/contracts/database. O token Discord é trocado, usado só para `/users/@me` e revogado; nunca persistido/retornado. E-mail sai apenas pelo worker, com idempotency key e payload descriptografado no último momento. Logo usa o `validateUpload`/`createObjectKey` existente (`packages/storage/src/index.ts:33-50`) e namespace `branding` já suportado.

### Worker de notificações

**Analogs:** `apps/worker/src/main.ts` e `packages/queue/src/index.ts`

**Worker recebe somente job data e lifecycle explícito** (`packages/queue/src/index.ts:30-39`, `apps/worker/src/main.ts:42-47`):

```typescript
return new Worker<TData, TResult>(name, (job) => processor(job.data), {
  ...options,
  connection,
});

await outboxWorker.close();
await server.close();
redis.disconnect();
await telemetry.shutdown();
```

Extrair o processor placeholder de `apps/worker/src/main.ts:26-30` para `notifications/processor.ts`. O processor busca `notification_delivery` pelo ID, verifica estado/expiração, descriptografa, chama `EmailSender` com idempotency key estável, marca sucesso e apaga ciphertext. Retry aproveita defaults de BullMQ (`packages/queue/src/index.ts:20-25`) e não pode duplicar envio. `main.ts` apenas compõe config, conexão, adapter e worker.

### Next.js: rotas, shells e componentes

**Analogs:** `apps/web/src/app/layout.tsx`, `page.tsx`, health route e `next.config.ts`

**Server Component sem hidratação desnecessária** (`apps/web/src/app/page.tsx:3-19`) e idioma global (`layout.tsx:10-15`):

```tsx
export default function HomePage() {
  return <main>{/* conteúdo sem estado cliente */}</main>;
}

<html lang="pt-BR"><body>{children}</body></html>
```

Páginas e shells devem permanecer Server Components; adicionar `"use client"` apenas aos limites interativos: OTP, dialogs, menus, editor de papéis, revogação e toasts. Buscar estado inicial no servidor e aguardar confirmação autoritativa em todas as mutações; nunca usar atualização otimista para identidade, convite, membro, ownership ou sessão.

**Route handler explícito** (`apps/web/src/app/api/health/live/route.ts:4-8`):

```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(/* contrato validado */);
}
```

Para BFF/proxy same-origin, encaminhar cookie/CSRF ao Nest sem interpretar permissão e sem logar body/header sensível. Alternativamente, usar rewrite controlado. O API continua sendo autoridade. Na rota de convite aplicar `Referrer-Policy: no-referrer`; os headers globais existentes estão em `apps/web/next.config.ts:10-24`.

### Tokens CSS, layout e componentes UI

**Analog parcial:** `apps/web/src/app/globals.css`; **autoridade:** `02-UI-SPEC.md`.

Preservar `box-sizing`/reset (`globals.css:8-13`), mas substituir cores/tipografia hardcoded por as variáveis grafite/teal do UI-SPEC. CSS global guarda tokens, reset, foco, reduced motion e shells; CSS Modules guardam estilos de domínio. Não copiar a escala tipográfica amarela/exagerada da landing técnica (`globals.css:19-34`): a especificação aprovada limita quatro tamanhos, dois pesos, foco 2px teal, targets de 44px e auth controls de 48px.

Implementar primeiro os primitivos `Button`, `Input`, `StatusBadge`, `InlineAlert`, `EmptyState`, `Skeleton`, dialogs e toast; então compor `AuthShell`, `EmailOtpForm`, `OrganizationSwitcher`, `DeviceSessionCard`, `ScopeRoleEditor`, `InvitationCard`, `AuditEvent` e `ConfirmSensitiveActionDialog`. Radix/Lucide ficam isolados nos primitivos. Componentes recebem capabilities resolvidas e nunca calculam RBAC.

### Estratégia de testes

**Analogs:** testes Vitest co-localizados da Fase 1.

Padrões concretos:

- nome `*.test.ts` existente para unitários (`packages/storage/src/index.test.ts:6-24`), mas manter os nomes `*.spec.ts` já travados em `02-VALIDATION.md` para as novas suites;
- `describe` por capacidade, `it` por comportamento, datas/IDs explícitos e `safeParse`/`toMatchObject` em vez de snapshots amplos;
- fakes sem rede como `packages/queue/src/index.test.ts:4-9`;
- erro externo vira resultado seguro como `apps/worker/src/health.test.ts:4-10`;
- matrix table-driven para toda permission/role/scope;
- `Fastify inject` para cookie, CSRF, Origin, 401/403, callback e boundary de segredo;
- PostgreSQL real e duas conexões coordenadas para convite e último owner; SQLite/PGlite não substituem esse gate;
- worker fake/adapter contract comprova idempotency key, retry sem duplicidade e limpeza de ciphertext.

## Padrões compartilhados obrigatórios

### Imports e exports

- Workspace: `@pubg-camp/*`; arquivo local ESM: sufixo `.js` (`packages/database/src/outbox.ts:1-3`).
- Usar `import type` para tipos (`apps/api/src/health/health.controller.ts:2-3`).
- Pacotes publicam apenas `dist` por `exports` e possuem `build/lint/typecheck/test/clean` como `packages/domain/package.json:6-17`.
- Atualizar `transpilePackages` do web somente se ele importar novo pacote compilável; não criar imports app-to-app.

### Injeção e testabilidade

- Clock, RNG, provider Discord, limiter, repositories, audit writer e email sender são dependências injetadas.
- Casos de uso não leem `process.env`, não constroem SDK e não abrem conexão.
- Adapters traduzem tipos externos para tipos internos mínimos e encerram recursos quando necessário.

### Autenticação e sessão

- Cookie opaco `__Host-`, 32 bytes aleatórios, somente SHA-256 no banco; `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sem `Domain`.
- 30 dias sliding, escrita coalescida; teto absoluto/step-up seguem as decisões aceitas do plano.
- Link/troca de e-mail/ownership: rotacionar sessão atual e revogar as demais na mesma transação.
- CSRF + Origin exato em método inseguro; GET nunca muda estado.

### Autorização multi-tenant

- Default deny; organização e scope explícitos; query filtra `organization_id` junto do resource ID.
- Membership/assignment são consultados ao vivo; revogação afeta a próxima request.
- Owner/admin são organização-wide; cargos operacionais acumuláveis são scope tournament e não promovem implicitamente.

### Erros, logs e auditoria

- Erros públicos são estáveis, acionáveis e não enumeráveis quando necessário.
- Security failures vão a logs estruturados redigidos; ações sensíveis bem-sucedidas vão a `audit_events`.
- Auditoria inclui actor, timestamp, motivo, before/after, correlation e escopo, mas exclui secrets/PII completa.

## Sem analog existente

| Arquivo/grupo | Motivo | Fonte a usar |
|---|---|---|
| `apps/api/src/authorization/{session.guard,permission.guard,decorators}.ts` | nenhum guard/decorator no repositório | `02-RESEARCH.md` Pattern 4 + matriz proposta |
| `apps/api/src/identity/adapters/discord-oauth.ts` | nenhuma integração OAuth | `oauth4webapi` e fluxo prescritivo do research |
| `packages/database/test/{invitation,last-owner}.concurrent.spec.ts` | nenhum teste PostgreSQL concorrente | locks/recheck de `02-RESEARCH.md` + PostgreSQL real |
| `apps/worker/src/notifications/resend-email-sender.ts` | nenhum adapter de e-mail | port/adapters do projeto + Resend idempotency |
| `apps/web/src/components/ui/*` e componentes interativos | web atual é estática | `02-UI-SPEC.md`, Radix e Lucide oficiais |

## Armadilhas específicas para os planos

1. Não transformar `HealthService` em modelo de DI funcional; ele instancia infraestrutura diretamente.
2. Não colocar todos os novos schemas no atual `schema.ts`; usar módulos e barrel para impedir um arquivo monolítico.
3. Não enviar e-mail no request HTTP nem importar Resend na API.
4. Não persistir access/refresh token Discord, OTP, invitation token ou session token em plaintext.
5. Não inferir organização ativa da sessão; URL/comando sempre carrega contexto explícito.
6. Não testar concorrência só com fake/unitário.
7. Não usar UI/Next proxy como barreira de autorização.
8. Não antecipar o domínio completo de campeonatos: `authorization_scopes` é apenas a identidade mínima de scope que a Fase 3 reutilizará.

## Metadados

**Analogs principais lidos:**

1. `packages/domain/src/index.ts`
2. `packages/contracts/src/index.ts`
3. `packages/database/src/{schema,outbox,index}.ts`
4. `apps/api/src/{app.module,main,health/*}.ts`
5. `apps/worker/src/main.ts`, `packages/queue/src/index.ts`, `apps/web/src/app/{layout,page,api/health/*}.ts`

**Arquivos fonte inspecionados:** 37 (código/config/testes) + 12 artefatos de planejamento  
**Cobertura:** analog exato ou por papel para 33/38 grupos; 5 grupos dependem diretamente do research/UI-SPEC.  
**Data de extração:** 2026-08-20
