---
status: pending
phase: 01-fundacao-modular-e-ambientes
items: 1
created: 2026-08-20
---

# Validação humana pendente — ambiente Docker

## Pré-requisito

Docker Desktop ou Docker Engine com Compose v2 disponível no terminal.

## Roteiro

1. Copiar `.env.example` para `.env` e manter apenas credenciais locais de desenvolvimento.
2. Executar `pnpm env:up` na raiz do repositório.
3. Aguardar os healthchecks e executar `docker compose ps`.
4. Confirmar `healthy` para PostgreSQL, Redis, MinIO, API, web e worker.
5. Abrir `http://localhost:3000/api/health/ready` e `http://localhost:3001/health/ready`; ambas devem responder com estado pronto.
6. Opcionalmente iniciar o perfil `discord` somente após configurar um token de teste.
7. Encerrar com `pnpm env:down`.

## Aprovação

- [ ] Ambiente completo iniciou com um comando.
- [ ] Readiness de web e API respondeu corretamente.
- [ ] Serviços ficaram saudáveis e encerraram sem erro.

Quando os três itens passarem, alterar o status deste arquivo para `passed`, o status de `01-VERIFICATION.md` para `passed` e fechar a Fase 1 no roadmap.

