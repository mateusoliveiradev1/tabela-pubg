# Fase 2: Configuração externa necessária

**Gerado em:** 2026-08-21
**Fase:** 02-identidade-organizacoes-e-autorizacao
**Status:** Incompleto

Os adapters, os testes com HTTP capturado e a infraestrutura PostgreSQL/Redis já estão configurados. Faltam somente os cadastros externos do Discord e do remetente transacional no Resend; ambos exigem acesso humano aos respectivos painéis.

## Variáveis de ambiente

| Status | Variável | Origem | Destino |
|---|---|---|---|
| [ ] | `DISCORD_CLIENT_ID` | Discord Developer Portal → aplicação → OAuth2 | ambiente secreto da API |
| [ ] | `DISCORD_CLIENT_SECRET` | Discord Developer Portal → aplicação → OAuth2 → Client Secret | ambiente secreto da API |
| [ ] | `DISCORD_REDIRECT_URI` | URL exata cadastrada na seção Redirects | ambiente da API |
| [ ] | `RESEND_API_KEY` | Resend Dashboard → API Keys | ambiente secreto do worker |
| [ ] | `EMAIL_FROM` | Endereço do domínio verificado no Resend | ambiente do worker |

Nunca commitar esses valores nem colocá-los em variáveis expostas ao browser.

## Configuração no painel

- [ ] Criar ou selecionar a aplicação sandbox no [Discord Developer Portal](https://discord.com/developers/applications).
- [ ] Em **OAuth2 → Redirects**, cadastrar as URLs exatas de desenvolvimento e produção.
- [ ] Autorizar somente os scopes `identify` e `email`.
- [ ] Manter `DISCORD_PKCE_MODE=required`.
- [ ] Usar `documented-exception` somente com um registro de risco válido em `DISCORD_PKCE_EXCEPTION_ID`; remover ambos assim que a incompatibilidade for reparada.
- [ ] No [Resend Dashboard](https://resend.com/domains), verificar o domínio usado pelo remetente transacional.
- [ ] Em **API Keys**, criar uma chave restrita à entrega de e-mails e armazená-la somente no ambiente secreto do worker.

## Verificação

Depois de configurar os valores no ambiente seguro, iniciar a API e confirmar:

- o redirect contém `response_type=code`, `code_challenge_method=S256` e apenas `identify email`;
- callback sem state ou sem binding do browser retorna somente `{ "status": "cancelled" }`;
- access token do Discord não aparece em resposta, redirect, HTML ou log;
- o token é revogado depois da leitura de `/users/@me`.
- OTP, convite e alerta de novo dispositivo chegam a um endereço controlado usando o remetente verificado;
- retries do mesmo delivery preservam a mesma chave de idempotência e não geram uma segunda mensagem.

---

**Quando concluir:** alterar o status acima para `Completo`.
