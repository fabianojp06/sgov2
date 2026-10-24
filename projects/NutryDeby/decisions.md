---
name: "decisions"
description: "NutriDeby architecture and technology decisions with rationale, plus what was explicitly rejected and why"
---

## Decisions and rationale

- PWA-first over native was a deliberate trade-off to reduce upfront cost and compress time-to-revenue — not a permanent architecture choice
- Serverless was explicitly rejected for the backend: Railway (persistent containers) is required for BullMQ cronjobs, which serverless cannot support
- RAG over fine-tuning: training an LLM from scratch or fine-tuning is inappropriate for NutriDeby's use case; RAG + prompt engineering with existing APIs is the correct approach
- Clerk Organizations is used for multi-tenancy rather than manual auth implementation, with tenant/org ID used as a metadata filter for multi-tenant isolation in vector search
- Harness was explicitly rejected as unnecessarily complex for a solo developer team
- The NutriDeby landing page (nutrideby-t5xa7ccy.manus.space) is Fabiano's own concept/prototype — not a competitor

## Stack

- Frontend: Next.js 15, next-pwa, React
- Backend: Fastify 4 on Railway (persistent containers)
- Database: Supabase Pro (PostgreSQL + pgvector, HNSW index)
- Auth/multi-tenancy: Clerk Organizations
- Queue: BullMQ
- Cache: Upstash Redis
- Media storage: Cloudflare R2
- AI APIs: Anthropic Claude (Sonnet), OpenAI GPT-4o Vision, OpenAI Whisper, OpenAI text-embedding-3-small
- Notifications: Twilio WhatsApp, OneSignal, Resend
- CI/CD: GitHub Actions
- Monorepo: pnpm workspaces + Turborepo
- Deployment: Vercel (frontend), Railway (backend)
- Observability is documented in the architecture at service level
