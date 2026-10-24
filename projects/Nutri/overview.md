---
name: "overview"
description: "NutriDebby — purpose, regulatory context, open business questions, and current state of the pitch deck and AI engine workstreams"
---

- Fabiano is building NutriDebby (correct spelling, also referenced as NutriDeby/NutriIA), a Brazilian healthtech SaaS startup operated under the company WSS
- The platform uses AI to analyze blood test results and generate personalized nutritional diagnoses, then recommends and sells relevant supplements through integrated e-commerce
- Core product loop: user uploads lab results → AI generates clinical nutritional diagnosis → platform recommends and sells related products (supplements, meal plans)
- Integrated Brazilian payment methods: PIX, credit card, debit card

## Constraints and regulatory context
- Brazilian nutritional practice regulations (CFN/CRN) are an active constraint
- LGPD data privacy requirements are an active constraint
- Regulatory risk (CFN/CRN) is a live concern that should inform product decisions, particularly around clinical claims and professional partnerships

## Open questions from early scoping
- Business model: own inventory vs. dropshipping
- Target audience definition
- Whether a credentialed nutrition professional partner is involved (relevant to CFN/CRN regulatory compliance)
- B2C vs. B2B model direction

## Current state — investor pitch document
- A full HTML pitch deck has been created and iteratively refined
- The deck covers problem statement, solution flow, competitive differentiators, market sizing, three-revenue-stream business model, three-phase roadmap, founding team structure, and a seed funding ask
- Visual style is "Clínico & Minimalista": DM Serif Display, DM Mono, and Inter typefaces; near-monochromatic palette; green accent only; thin black border grids
- A persistent rendering issue with dark mode overriding CSS was resolved via `color-scheme: light only` in both a `<meta>` tag and CSS root

## Current state — AI engine architecture
- A three-layer TypeScript architecture has been designed
- Pre-processing layer: PDF lab exam extraction
- Orchestration layer: main AI prompt and logic (Claude API, model `claude-sonnet-4-6`, structured JSON output)
- Post-processing layer: database persistence and product mapping (Prisma + Zod validation)
- The AI persona is framed as a "senior clinical nutritionist" with a structured output schema (`DiagnosisOutput`); clinical framing matters for credibility and regulatory positioning
- TACO/UNICAMP and USDA are the intended reference sources for biomarker interpretation

## On the horizon
- Deeper implementation of specific AI engine layers (full system prompt, Next.js file structure for the AI module)
- Resolving the four open product/business questions flagged during initial scoping
- Potential full technical architecture work once the business model is confirmed
