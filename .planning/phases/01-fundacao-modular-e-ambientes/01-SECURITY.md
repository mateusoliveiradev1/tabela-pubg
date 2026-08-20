---
status: verified
phase: 01-fundacao-modular-e-ambientes
threats_total: 11
threats_closed: 11
threats_open: 0
asvs_level: 1
created: 2026-08-20
---

# Auditoria de segurança — Fase 1

## Escopo e fronteiras de confiança

A auditoria cobre o monorepo, o tráfego recebido por web/API, os processos de API, worker e bot, PostgreSQL, Redis, storage S3 compatível, imagens Docker e o workflow de CI.

As fronteiras consideradas são: navegador/ingress para web e API; aplicações para PostgreSQL, Redis e MinIO; CI para registries de dependências e imagens; Discord para o processo do bot. Em produção, TLS termina no ingress; o tráfego HTTP entre contêineres permanece em rede privada.

## Verificação das ameaças

| ID | STRIDE | Ameaça | Mitigação verificada | Estado |
|---|---|---|---|---|
| T-01-01 | Information Disclosure | Segredos versionados | `.env` ignorado, `.env.example` sem credenciais reais e scanner de segredos no gate/CI | Fechada |
| T-01-02 | Tampering | Configuração inválida aceita no boot | Ambientes são validados por schemas Zod tipados e falham cedo | Fechada |
| T-01-03 | Tampering | Domínio acoplado à infraestrutura | Regras do dependency-cruiser bloqueiam imports proibidos e passaram sem violações | Fechada |
| T-01-04 | Information Disclosure | Health checks expõem configuração ou segredos | Respostas usam contrato mínimo e o logger mascara campos sensíveis | Fechada |
| T-01-05 | Tampering | Resultado e eventos divergem | Schema e helper de outbox permitem gravação na mesma transação; migração é verificada | Fechada |
| T-01-06 | Denial of Service | Dependências externas derrubam liveness | Liveness é local; readiness verifica dependências separadamente | Fechada |
| T-01-07 | Tampering / Information Disclosure | Upload arbitrário ou chave previsível | Adapter S3 aplica allowlist de MIME/tamanho e gera chave opaca UUID em namespace controlado | Fechada |
| T-01-08 | Spoofing | Credenciais locais reutilizadas como produção | Credenciais locais ficam somente no exemplo/Compose e produção exige variáveis externas validadas | Fechada |
| T-01-09 | Information Disclosure | Serviços internos expostos desnecessariamente | Portas locais vinculam em `127.0.0.1`; produção publica somente via ingress | Fechada |
| T-01-10 | Elevation of Privilege | Contêiner executado como root | Imagens finais criam e usam usuário não privilegiado | Fechada |
| T-01-11 | Tampering / DoS | Supply chain ou abuso HTTP | Lockfile congelado, permissões CI somente leitura, actions fixadas por major, Helmet/CSP e rate limiting na API | Fechada |

## Evidências

- `pnpm ci:verify` passou em 2026-08-20, incluindo scanner de segredos, migrações, lint, limites arquiteturais, tipos, testes e builds.
- O dependency-cruiser analisou 67 módulos e 82 dependências sem violações.
- A API habilita Helmet e limite de requisições; o web envia CSP e demais cabeçalhos defensivos.
- API, worker, bot e web possuem imagens finais sem root; o serviço Discord é opt-in no Compose.
- O workflow CI usa permissões somente leitura e instalação com lockfile congelado.

## Riscos aceitos

Nenhum risco foi aceito nesta fase. A execução real dos contêineres não foi auditada localmente porque o Docker não está instalado; isso é uma pendência de verificação operacional, não uma ameaça de código aberta.

## Resultado

As 11 ameaças identificadas nos planos da Fase 1 estão fechadas por controles implementados e verificados estaticamente. O hardening de produção e os testes de recuperação continuam previstos para a Fase 9.

