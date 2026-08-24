---
name: "PUBG CAMP — DROP MANIFEST"
description: "Manifestos transacionais para operar campeonatos com clareza, urgência e segurança."
colors:
  carbon: "#0b0d0f"
  field-carbon: "#181c20"
  ivory: "#f2eee3"
  signal-orange: "#f4a21d"
  steel: "#79828c"
  steel-light: "#a9b0b7"
  steel-muted: "#5c646d"
  steel-link: "#35404a"
  security-red: "#e45a5a"
typography:
  display:
    fontFamily: "Arial Narrow, Aptos Narrow, Helvetica Neue Condensed, Arial, sans-serif"
    fontSize: "50px"
    fontWeight: 900
    lineHeight: 1.02
    letterSpacing: "-1px"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.53
  label:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "1.2px"
  code:
    fontFamily: "Courier New, Courier, monospace"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "8px"
rounded:
  none: "0"
spacing:
  edge-mobile: "20px"
  edge: "28px"
  section: "34px"
  block: "24px"
  row: "13px"
components:
  manifest-shell:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.carbon}"
    rounded: "{rounded.none}"
    width: "640px"
  action-button:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.carbon}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "16px 24px"
  status-meta-row:
    backgroundColor: "{colors.field-carbon}"
    textColor: "{colors.steel-light}"
    typography: "{typography.label}"
  data-row:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.carbon}"
    typography: "{typography.label}"
    padding: "13px 0"
  otp-code-block:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.signal-orange}"
    typography: "{typography.code}"
    rounded: "{rounded.none}"
    padding: "24px 16px"
---

# Design System: PUBG CAMP — DROP MANIFEST

## Overview

**Creative North Star: "DROP MANIFEST"**

Cada e-mail transacional é um manifesto de operação de campeonato, não um card de SaaS. A composição remete a uma folha de suprimentos e a uma credencial de operação: carbono, marfim, aço, linhas de medição e retângulos industriais organizam a informação com precisão. A referência é funcional, sem reproduzir arte, marca ou identidade oficial de PUBG.

A história de leitura é invariável: identificar o tipo de transmissão, compreender o dado principal e agir com segurança. O primeiro viewport contém a faixa textual PUBG CAMP, título condensado em grande escala, status, timestamp, conteúdo primário em alto contraste e, quando há ação, um CTA retangular acompanhado pelo endereço completo.

**Direction provenance:** manifesto de suprimentos e credencial de operação · seed `ca30eaa3`.

DROP MANIFEST é a primeira superfície visual aprovada. Este documento descreve os e-mails transacionais já implementados; ele não afirma que a interface web atual compartilha este mundo. Toda futura superfície visual — autenticação, dashboard, páginas públicas, classificação, estatísticas, MVP e OBS — deve passar por direção Impeccable e finish review antes de ser considerada aprovada.

**Key Characteristics:**

- Manifesto operacional, denso e escaneável.
- Hierarquia industrial de transmissão, dado e ação segura.
- Contraste alto, geometria ortogonal e identidade por composição.
- Compatibilidade real com Gmail, Outlook e clientes móveis.

## Colors

A paleta combina carbono e marfim como estrutura, laranja sinal para operação, aço para metadados e vermelho exclusivamente para segurança.

### Primary

- **Signal Orange:** marca estados operacionais, régua de medição, OTP e CTA de convite; sua raridade preserva prioridade.

### Secondary

- **Security Red:** substitui o laranja apenas em alertas de segurança, incluindo borda superior, régua e status.

### Neutral

- **Carbon:** fundo externo, faixa de marca, rodapé e bloco de código.
- **Field Carbon:** campo do título e metadados do manifesto.
- **Ivory:** folha principal, corpo e texto reverso sobre carbono.
- **Steel / Light Steel / Muted Steel / Link Steel:** bordas, divisores, timestamps, rótulos, notas e URLs.

**The Red-Only-Security Rule.** Vermelho nunca sinaliza operação comum, seleção, destaque ou marca; aparece somente quando a transmissão é um alerta de segurança.

**The Contrast Pair Rule.** Texto principal usa Carbon sobre Ivory ou Ivory sobre Carbon/Field Carbon. As combinações implementadas atendem WCAG AA: Carbon/Ivory (16,79:1), Signal Orange/Carbon (9,30:1), Security Red/Field Carbon (4,82:1), Light Steel/Field Carbon (7,82:1) e Muted Steel/Ivory (5,18:1).

## Typography

**Display Font:** Arial Narrow, com Aptos Narrow, Helvetica Neue Condensed e Arial como fallbacks.
**Body Font:** Arial, com Helvetica e sans-serif como fallbacks.
**Label/Mono Font:** Arial para rótulos; Courier New para o código OTP.

**Character:** Títulos estreitos, pesados e em caixa alta fazem o manifesto parecer emitido por uma sala de operações. Corpo, rótulos e metadados ficam em famílias seguras de sistema para preservar a leitura em Gmail e Outlook; a identidade é carregada pela composição quando o cliente substitui a fonte condensada.

### Hierarchy

- **Display** (900, 50px, 51px): título da transmissão, sempre em caixa alta; reduz para 38px/40px em telas estreitas.
- **Content title** (800, 32px, 36px): dado principal longo, como nome da organização, com quebra agressivamente segura.
- **Body** (400, 17px, 26px): instrução principal antes dos dados e ações.
- **Data value** (700, 15px, 21px): valor escaneável em linhas do manifesto.
- **Label** (700–800, 10–12px, tracking 1–1,4px): transmissão, status e nomes dos campos em caixa alta.
- **OTP code** (700, 40px, 48px, tracking 8px): credencial temporária selecionável; reduz para 32px e tracking 5px no mobile.

**The Email-Safe Identity Rule.** Não depender de webfonts: Arial Narrow/Arial e os fallbacks observados são a exceção deliberada para compatibilidade; peso, caixa, espaçamento, contraste e geometria mantêm a assinatura quando a fonte estreita não existe.

## Layout

O e-mail usa estrutura híbrida table-first com CSS inline. O manifesto é fluido até 640px e recebe uma tabela condicional MSO fixa em 640px para Outlook. A shell externa mantém 12px de respiro lateral; as faixas internas usam 28px nas laterais, 34px no campo de título e corpo, e blocos separados por intervalos de 24–28px.

A faixa PUBG CAMP inicia o primeiro viewport, seguida pelo título, régua, status/timestamp e pelo dado primário. Linhas de dados usam duas colunas, com rótulo em 34% e valor no restante. Conteúdo dinâmico deve usar `overflow-wrap:anywhere` e `word-break:break-word` em nomes, valores e URLs, sem truncar informação operacional.

Abaixo de 680px, laterais caem para 20px, título e OTP reduzem, linhas de dados empilham e CTA ocupa a largura disponível. Abaixo de 400px, status e timestamp empilham e alinham à esquerda. A ordem de leitura e o fallback URL permanecem intactos em qualquer largura.

**The First-Viewport Rule.** Antes de qualquer detalhe secundário, o destinatário deve enxergar a transmissão, o título, o estado, o timestamp e o conteúdo ou ação decisiva.

## Elevation & Depth

Não há sombras, gradientes, brilho ou transparência ornamental. Profundidade vem de campos tonais sólidos, bordas de 1px, uma borda superior de 6px e a régua curta de 4px que encontra uma linha de 1px. A folha não flutua: ela é montada como um documento técnico.

**The Flat-Manifest Rule.** Toda separação é estrutural — cor sólida, linha, espaçamento ou mudança de campo — nunca efeito decorativo de elevação.

## Shapes

Todos os elementos são ortogonais, com raio zero. Botões, bloco OTP, faixas, divisores e folha principal usam retângulos rígidos. O detalhe de assinatura é a régua assimétrica: um trecho curto e espesso na cor de estado seguido por uma linha fina de aço.

**The Measurement Geometry Rule.** Use linhas e proporções para sugerir aferição e controle; não use cards arredondados, cápsulas, círculos decorativos ou molduras de interface genérica.

## Components

### Manifest Shell

- **Structure:** tabela de apresentação fluida com largura máxima de 640px e fallback MSO de 640px.
- **Bands:** faixa de marca em Carbon, título em Field Carbon, corpo em Ivory e rodapé em Carbon.
- **Accessibility:** HTML em `pt-BR`, preheader oculto, `role="article"`, `aria-label` no conteúdo principal e cores sólidas protegidas no dark mode.

### Action Button

- **Shape:** retangular, raio zero, padding 16px × 24px e largura mínima de 246px.
- **Operation:** Signal Orange sobre Carbon.
- **Security:** Carbon sobre Ivory; o vermelho identifica o alerta, mas não preenche o CTA.
- **Compatibility:** VML fornece o botão de 310px × 52px no Outlook; todos os clientes recebem um link de endereço completo, legível e quebrável, abaixo do CTA.

### Status / Meta Row

- **Structure:** status à esquerda e timestamp à direita no Field Carbon, separados da régua por 14px.
- **Responsive:** empilha abaixo de 400px sem depender de cor para transmitir o estado.

### Data Row

- **Structure:** borda superior Steel Light; rótulo de 34% e valor flexível, com 13px de padding vertical.
- **Dynamic content:** valores longos quebram em qualquer ponto seguro; no mobile, rótulo e valor se tornam blocos de largura total.

### OTP Code Block

- **Structure:** Carbon com borda Steel, código Signal Orange em Courier New, centralizado e selecionável.
- **Safety:** `aria-label` separa os dígitos para leitura; instrução e aviso deixam explícito que o código não deve ser compartilhado.

## Do's and Don'ts

### Do:

- **Do** preservar a sequência transmissão → dado principal → ação segura.
- **Do** manter tabelas de apresentação, estilos inline, fallback híbrido de 640px/MSO e CTA VML para compatibilidade de e-mail.
- **Do** testar contraste WCAG AA, dark mode, largura abaixo de 400px e conteúdo dinâmico longo antes da aprovação.
- **Do** repetir o URL completo abaixo de toda ação transacional.
- **Do** submeter qualquer futura superfície visual a direção Impeccable e finish review.

### Don't:

- **Don't** usar vermelho fora de alertas de segurança.
- **Don't** usar gradientes, glow, emoji, sombra ornamental ou cards genéricos arredondados.
- **Don't** depender de webfont, JavaScript, imagem remota ou CSS externo para comunicar identidade ou informação essencial.
- **Don't** copiar arte, logotipo, tipografia proprietária ou branding oficial de PUBG.
- **Don't** promover DROP MANIFEST como identidade já implementada no web app; hoje ele é o mundo aprovado dos e-mails transacionais.
