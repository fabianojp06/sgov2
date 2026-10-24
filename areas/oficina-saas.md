---
name: "oficina-saas"
description: "Multi-tenant commercial SaaS for auto repair shops (oficina mecânica)"
---

- Building a commercial multi-tenant SaaS for auto repair shops (oficina mecânica)
- Starting with a single pilot client that also runs an auto parts store
- Documentation produced: technical requirements spec (v1.2), client-facing functional spec, commercial proposal restructured into three delivery waves, developer standards document
- Claude Code skills created: oficina-tech-lead, oficina-fullstack-dev, oficina-business-rules, oficina-qa-security, oficina-lifecycle-sustentacao
- Tech stack mirrors SGO 2.0: Next.js 15+ App Router, Prisma + PostgreSQL (Supabase), Clerk (Organizations as tenants), Cloudflare R2, SSE for real-time, Vercel, Resend
- Key scope items: vehicle checklist linked to parts/services inventory, real-time client portal with short-lived JWT tokens, man-hour cost calculation, auto parts PDV as separate interface, fiscal emission with two triggers, vehicle plate lookup via external API
- Eight open gaps remain (LGPD formalization most urgent, plus formal contract, UAT process, training materials, etc.)
- Per user instruction: maintains a backlog of ideas in a dedicated conversation and does not update formal documentation until explicitly asked to consolidate
- Registered backlog idea: create a "Configurações da oficina" area (tenant-level settings) consolidating institutional data (CNPJ, razão social, address) and per-tenant configurations — notification channels, approval link validity period, discount limits by profile, and warranty deadlines by service type
