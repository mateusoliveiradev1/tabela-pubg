---
created: 2026-08-24T01:47:36.411Z
title: Redesenhar experiência visual do produto
area: ui
files:
  - apps/web/src/app/(auth)/entrar/page.tsx
  - apps/web/src/components/identity/auth-shell.tsx
  - apps/web/src/components/layout/app-shell.tsx
  - apps/web/src/app/globals.css
---

## Problem

A fundação atual é funcional, responsiva e acessível, mas a percepção visual ainda é de protótipo simples e genérico. O produto precisa transmitir a energia competitiva de campeonatos de PUBG sem copiar a transmissão oficial: identidade própria, hierarquia mais forte, melhor composição, estados ricos e acabamento consistente entre autenticação, painel do organizador, página pública, classificação, estatísticas, MVP e overlays do OBS.

## Solution

Planejar uma fase dedicada de direção de arte e polish visual. Auditar as telas existentes, definir uma linguagem visual competitiva e modular, evoluir tokens e componentes reutilizáveis, criar fundos/arte de apoio originais e validar os fluxos em 320, 768 e 1440 px. Preservar WCAG, teclado, reduced motion, performance e legibilidade para transmissão. Usar `gsd-ui-phase` para o contrato e `impeccable` para a execução/revisão visual antes de aplicar o redesign ao produto inteiro.
