---
name: overview
description: NutriDeby — hybrid AI + human nutritionist SaaS for the Brazilian market: purpose, compliance constraints, business model, and current development state
sources: [backfill]
aliases: [NutriDeby, NutriBot]
---

## Purpose & context

- Fabiano is building NutriDeby, a hybrid AI + human nutritionist SaaS platform for nutritional monitoring in the Brazilian market
- Core value proposition: improving patient retention between consultations via a 24/7 AI copilot called "NutriBot"
- Mandatory compliance requirement: a licensed nutritionist (RT) must approve every AI-generated message before it reaches patients, per Brazilian CFN Resolution 680/2021 and LGPD
- The human-approval layer is non-negotiable and shapes core architecture decisions (BullMQ approval queue, audit trails, etc.)
- Business model: B2B (license per nutritionist), with planned expansion to B2B2C (white-label per clinic) and B2C (patient subscription)

## Current state

- Development is actively underway, with features implemented and deployed to Vercel
- Current strategic approach is PWA-first (Next.js + next-pwa for Phases 1–2) before migrating to React Native in Phase 3, reusing ~80% of the codebase
- The PWA-first decision was made explicitly to accelerate time-to-first-revenue and reduce initial team cost by deferring a mobile developer hire
- A comprehensive suite of planning and technical documents has been produced: v1–v3 strategic docs, 48-week Gantt in XLSX, interactive HTML architecture docs, PWA and nutritionist panel prototypes, PDF checklists, and a ZIP of 10 Claude Code skills

## On the horizon

- Phase 3 migration to React Native, planned post-Phase 2, reusing ~80% of the PWA codebase
- Expansion from B2B to B2B2C and B2C business models
- Next agenda item flagged in a recent conversation: a Node.js ingestion script to process the Brazilian TACO nutritional table PDF and populate pgvector
