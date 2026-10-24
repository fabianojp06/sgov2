---
name: "cronograma-sistema"
description: "Sistema independente de cronograma/plano de ação (substitui planilhas PLA-DEP e CRO-DEP) para acompanhamento de múltiplos projetos da CTCEA"
---

- Objetivo: replicar e substituir as planilhas CRO-DEP-2026-001.xlsx e PLA-DEP-2026-001.xlsx (cronogramas Gantt com Previsto/Realizado por semana)
- Sistema independente (não é módulo do SGO 2.0)
- Escopo: múltiplos projetos/plano de ação simultâneos (modelo PLA-DEP), com visão detalhada por projeto (modelo CRO-DEP)
- Stack confirmada: Next.js + Prisma + PostgreSQL (mesmo padrão usado no SGO 2.0)
- Uso interno único da CTCEA — não precisa ser multi-tenant
- Será desenvolvido via Claude Code de forma totalmente autônoma, usando o padrão do script autoloop.sh (referenciado na conversa "AutoLoopFb")
- Estilo visual escolhido: "Painel Operacional" (claro, moderno, sem cards genéricos, timeline embutida na lista) — deve ter alternância entre modo claro e escuro
- Protótipos das 4 telas prioritárias criados e navegáveis: Dashboard consolidado, Detalhe do projeto (Gantt), Formulário de Projeto, Formulário de Ação — artifact em https://claude.ai/artifact/WPxn8dThgUAmMPJHAPJzhs
- Infra: Clerk (Instance ID ins_3JTS4qDnU1wKm8mPloItwq6KxYJ, auth com login social Microsoft/Outlook), banco no Railway (Project ID 28445ef3-95ee-44bd-bfba-b5af383d8057), deploy na Vercel (Project ID prj_HxI1VBYwefOAGBqyJXvEOCBAkHPO), repositório GitHub privado em https://github.com/fabianojp06/cronograma
