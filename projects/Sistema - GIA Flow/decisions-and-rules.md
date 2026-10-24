---
name: "decisions-and-rules"
description: "SGPA architecture decisions, business rules, and git workflow constraints — read before changing architecture or process"
---

## Architecture decisions

- Modular Monolith was deliberately chosen over microservices for this context
- The Modular Monolith ADR should not be revisited without strong justification

## Business rules

- The "Regra das 3 Semanas" (RN-09) is a critical business rule: a WIN status repeated for 3 consecutive weeks triggers automatic escalation to Plano de Ação PLA-DEP-2026-001
- RN-09 must be enforced at the system level, not left to manual tracking
- The Master Reference Document defines 15 business rules in total

## Git workflow

- Claude Code should only run `git init` and `git add .`
- Commits are handled exclusively through GitKraken
