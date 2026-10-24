---
name: "sgo-2"
description: "SGO 2.0 — multi-tenant budget management system for OSCIPs/public sector"
---

- Multi-tenant budget management system (Sistema de Gestão Orçamentária) for OSCIPs/public sector
- Built with Next.js 15+, TypeScript, Prisma, PostgreSQL, Zod, Clerk, Tailwind CSS, shadcn/ui
- A large skill library has been assembled covering the full dev lifecycle (techlead-fsg, fullstack-dev, fullstack-pleno, ba-po-architect, dba-data-engineer, process-analyst, oscip-contador, fpa-insights, dmaic-sipoc, posmba, excel-specialist, sgo-doc-layout, and others)
- Architectural decisions consolidated: NUMERIC(15,2) for money, multi-tenant via Clerk orgId, Prisma transactions with Serializable isolation, append-only audit logs, soft deletes
- No application scaffolding or Prisma schema started yet; suggested next step was Tech Lead defining module structure and BA/PO writing first User Stories
- Project lives in GitHub at fabianojp06/sistemaSgo; runs in GitHub Codespaces with Claude Code CLI
- Session persistence managed via CLAUDE_CONFIG_DIR pointing inside the repo
- SGO 2.0 terá auditoria completa, controle de versões e controle de acesso (cada área acessa somente as telas do sistema que lhe dizem respeito) como melhorias em relação ao processo AS-IS de criação de proposta (Termo de Parceria); pretende pedir posteriormente a criação de um documento reunindo essas melhorias
- Escopo dessa discussão de melhorias é somente a parte orçada (orçamentário), não execução financeira
