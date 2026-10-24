---
name: "ways-of-working"
description: "How Fabiano runs NutriDeby development — two-machine Claude Code setup, skills, and documentation conventions"
---

## Two-machine development setup

- Fabiano uses two computers simultaneously for development
- Machine 1: frontend, interactive Claude Code mode, pointed at staging API
- Machine 2: backend, autonomous Claude Code mode, sole machine permitted to run migrations
- Explicit scope-limiting prompts are used when running Claude Code autonomously on Machine 2 to prevent unintended frontend package modifications

## Working patterns

- Fabiano works iteratively with Claude to produce versioned, production-ready deliverables (documents, prototypes, skill files) rather than generic guidance
- Claude Code skills are a core part of the workflow: 10 skills exist, with two recently created (`nutrideby-docs`, `nutrideby-sustentacao`) and `nutrideby-architect` updated to reference all skills and the full `docs/` monorepo structure

## Documentation conventions

- Conventional Commits
- Keep a Changelog format
- Gherkin BDD acceptance criteria
- GitHub labels/milestones
- Full traceability from user stories to code to tests
