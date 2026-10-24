---
name: "overview"
description: "JAIF institutional website with AI quotation engine — purpose, stack, pricing model, visual direction, and current phase status"
---

- Fabiano is Founder and CTO of JAIF Consultoria em TI
- Project goal: a professional institutional website with an AI-powered quotation engine targeting small and medium-sized businesses (PMEs)
- Full-stack platform that captures client scope, generates PDF proposals via AI, and triggers automated communication flows

## Technical stack

- Frontend: Next.js 14+ (App Router), TypeScript, Tailwind CSS
- AI engine: Claude API (`claude-sonnet-4-6`) powering a 6-step quotation funnel
- Backend/DB: Supabase (PostgreSQL + Auth)
- Email: Resend (transactional)
- WhatsApp alerts: Z-API (WhatsApp Business)
- Hosting: Vercel
- Domain: Registro.br

## Pricing model

- Service-specific hourly rates across Support, Cloud, Security, Development, Data/AI, and Consulting
- Company-size multipliers and combo discounts applied on top of the hourly rates
- AI funnel includes lead scoring on a 0–100 scale

## Visual direction

- Option 3 — "Parceria Humana" — charcoal + moss green + sand palette
- Typography: Lora serif (display) + Inter (body)
- Logo selected: Option A — typographic wordmark, JAIF in Lora 700 / letter-spacing 6px, 1.5px sand anchor line, "CONSULTORIA EM TI" in Inter 10px / letter-spacing 4px

## Portfolio cases embedded in materials

- ERP Sankhya multi-year implementation for a distributor
- Government digital transformation project (BDD/Gherkin, BPMN)
- Auto repair shop pilot system

## Current state

- Phase 1 (Design System + Logo) is complete
- Design system delivered as an interactive HTML widget with 6 tabs: Logo, Cores, Tipografia, Espaçamento, Componentes, Preview
- Design system also delivered as a `jaif-design-system.md` reference file
- Design system covers CSS custom properties, typographic scale, 4px-increment spacing scale, border radius and shadow tokens, component specs (buttons, inputs, badges, service cards, alerts), Tailwind config, and a Next.js `globals.css` starter
- Two integration pendencies remain unresolved before Phase 3: Resend account creation + domain verification, and Z-API account creation + WhatsApp Business instance connection
- Infrastructure confirmed ready: Registro.br, GitHub, Vercel, Supabase, Anthropic API

## On the horizon

- Phase 2: site build — timing to be confirmed by Fabiano relative to resolving integration pendencies
- Phase 3: integration of Resend and Z-API, dependent on external account setup
- Quotation engine implementation and PDF proposal generation flow still to come

## Key learnings

- All foundational decisions (stack, visual direction, pricing, copy tone, portfolio cases) were captured in a 9-question onboarding questionnaire; that data is embedded across the technical spec, briefing doc, and design system
- The AI quotation harness prompt has been calibrated specifically for PME decision-makers
- Phase 2 start is not blocked by the integration pendencies — those can be resolved in parallel
