# Fase 2: Configuração externa necessária

**Gerado em:** 2026-08-21
**Fase:** 02-identidade-organizacoes-e-autorizacao
**Status:** Incompleto

O adapter, os testes com HTTP capturado e a infraestrutura PostgreSQL/Redis já estão configurados. Falta apenas cadastrar o aplicativo que representará a plataforma no Discord; isso exige acesso humano ao Discord Developer Portal.

## Variáveis de ambiente

| Status | Variável | Origem | Destino |
|---|---|---|---|
| [ ] | `DISCORD_CLIENT_ID` | Discord Developer Portal → aplicação → OAuth2 | ambiente secreto da API |
| [ ] | `DISCORD_CLIENT_SECRET` | Discord Developer Portal → aplicação → OAuth2 → Client Secret | ambiente secreto da API |
| [ ] | `DISCORD_REDIRECT_URI` | URL exata cadastrada na seção Redirects | ambiente da API |

Nunca commitar esses valores nem colocá-los em variáveis expostas ao browser.

## Configuração no painel

- [ ] Criar ou selecionar a aplicação sandbox no [Discord Developer Portal](https://discord.com/developers/applications).
- [ ] Em **OAuth2 → Redirects**, cadastrar as URLs exatas de desenvolvimento e produção.
- [ ] Autorizar somente os scopes `identify` e `email`.
- [ ] Manter `DISCORD_PKCE_MODE=required`.
- [ ] Usar `documented-exception` somente com um registro de risco válido em `DISCORD_PKCE_EXCEPTION_ID`; remover ambos assim que a incompatibilidade for reparada.

## Verificação

Depois de configurar os valores no ambiente seguro, iniciar a API e confirmar:

- o redirect contém `response_type=code`, `code_challenge_method=S256` e apenas `identify email`;
- callback sem state ou sem binding do browser retorna somente `{ "status": "cancelled" }`;
- access token do Discord não aparece em resposta, redirect, HTML ou log;
- o token é revogado depois da leitura de `/users/@me`.

---

**Quando concluir:** alterar o status acima para `Completo`.
