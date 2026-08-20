# Contribuindo

## Fluxo mínimo

1. Crie uma mudança pequena e focada.
2. Atualize testes e migrações quando aplicável.
3. Execute `pnpm ci:verify`.
4. Use commits convencionais com o identificador do plano quando houver, por exemplo `feat(02-01): adicionar autenticação Discord`.

## Limites arquiteturais

- `packages/domain` não importa configuração, banco, fila, storage, observabilidade ou aplicações.
- Um pacote nunca importa código de `apps`.
- Uma aplicação nunca importa outra aplicação.
- Contratos compartilhados devem ser serializáveis e independentes de framework.
- Integrações externas entram por portas/adaptadores, não diretamente no domínio.

`pnpm lint:boundaries` aplica essas regras e deve permanecer verde.

## Segurança

- Não versione `.env`, tokens, comprovantes, dumps ou credenciais.
- Use apenas `.env.example` com placeholders locais.
- Não registre headers de autenticação, cookies ou payloads sensíveis.
- Uploads precisam de allowlist de MIME, tamanho máximo e chave opaca.
- Workflows GitHub mantêm `contents: read` e não recebem permissões adicionais sem necessidade comprovada.

## Banco de dados

Altere o schema Drizzle, gere uma migração, revise o SQL e rode `pnpm verify:migrations`. Migrações publicadas são imutáveis; correções usam uma nova migração.

## Testes

Teste comportamento observável. Liveness nunca deve depender de rede. Testes de readiness devem usar probes controlados ou infraestrutura efêmera, sem atingir serviços reais de produção.
