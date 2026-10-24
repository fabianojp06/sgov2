---
name: "stack-and-ways-of-working"
description: "SGPA technology stack, UI/UX direction, and how Fabiano structures Claude sessions on this project"
---

## Technology stack

- Framework: Next.js 15 (full-stack)
- Database/Backend: Supabase (PostgreSQL + Realtime + Storage)
- Auth/RBAC: Clerk
- ORM: Prisma
- Hosting: Vercel
- Email: Resend + React Email
- AI features: Anthropic API (AI-assisted agenda generation)
- Dev tool: Claude Code
- Git UI: GitKraken
- Version control: GitHub

## UI/UX direction

- Dark-first, graphite professional palette (`--bg-base: #0D0F12`)
- Inter for body text, Geist Mono for data and numbers
- Real-time radar sidebar via Supabase Realtime

## Ways of working

- Fabiano uses a dual-persona framing for Claude assistance: business/PO analysis and software architecture/UI-UX, switching as needed
- Sessions are structured around producing concrete deliverables (documents, prompts, schemas) rather than open-ended exploration
- The Master Reference Document and its session-start context prompt (Section 10) are used to re-establish context at the start of each Claude Code session
