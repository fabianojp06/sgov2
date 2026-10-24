---
name: "overview"
description: "Purpose, planned documentation architecture, and current phase of the social security law practice website project"
---

## Purpose

- Fabiano is building a website and system for a social security/benefits law practice
- Overarching goal: structure the project comprehensively upfront so AI agents can execute development tasks autonomously
- Ideal outcome is that a single command like "develop use case 1" is enough for an agent to proceed without further clarification
- Success means minimal human intervention during execution, with domain knowledge pre-encoded in documentation rather than provided interactively at runtime

## Documentation architecture (agreed approach)

- Documentation-first structure organized around a `/docs` folder
- `/docs` subfolders cover vision, use cases, user stories, data models, architecture decisions, and design system
- A master instructions file (`CLAUDE.md` or `AGENTS.md`) is central: agents read it before any coding task to load domain context and project rules
- Each use case is a numbered markdown file containing objectives, actors, preconditions, main flow, and linked user stories
- User stories are written in Gherkin format (Dado/Quando/Então)
- Testable acceptance criteria are treated as essential, since they define "done" for the agent

## Current state

- Site já está no ar no domínio advrafaelagarcia.com.br (código customizado, feito pelo próprio Fabiano)
- Fase atual: divulgação — GA4, Search Console, Google Meu Negócio e campanha de Google Ads (Pesquisa) já configurados e com faturamento pago; faltam SEO de conteúdo e Meta Ads (Facebook/Instagram)
- In the architecture and documentation planning phase, before active coding begins
- Claude Code running locally has been identified as the appropriate execution tool, given its ability to read project files and maintain context across sessions

## On the horizon

- Generating the ready-to-use project skeleton: folder structure, a master `CLAUDE.md` with social security law domain rules, and templates for use cases and user stories in Gherkin format
- Populating use cases and user stories to reach the threshold where autonomous agent execution becomes viable

## Key learnings & principles

- Agent autonomy depends on specification quality: the agent needs enough context to know both what to build and when it's done
- Domain knowledge should live in documentation, not in runtime prompts — this is what makes the workflow scalable and repeatable
- Gherkin-format acceptance criteria (Dado/Quando/Então) are the standard for making user stories machine-actionable

## Tools & resources

- Claude Code (local execution) for autonomous agent-driven development
- Markdown-based documentation architecture (`/docs` folder system)
- `CLAUDE.md` / `AGENTS.md` as the agent's entry point and rule source
