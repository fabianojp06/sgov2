---
name: "decisions-and-stack"
description: "Locked-in technical decisions for the AI engine, the application stack and tools, and Fabiano's working and design preferences"
---

## Locked-in technical decisions
- Separate API calls for PDF extraction vs. analysis
- Raw output is saved for auditability
- Mandatory disclaimer language in all outputs
- Streaming, caching by exam hash, and retry logic with exponential backoff

- Repositório GitHub: https://github.com/fabianojp06/nutrideby.git

## Tools and stack
- Claude API (`claude-sonnet-4-6`) — core AI engine
- Next.js 15+, Supabase, Prisma, Clerk — application stack
- Pagar.me / Stripe — payment gateway options
- TACO/UNICAMP, USDA — nutritional reference databases
- Zod — output validation

## Ways of working
- Fabiano works iteratively — designs are refined through multiple feedback rounds with specific, direct correction requests
- Prefers clean, minimal, professional visual design with strict light-background consistency (no dark sections anywhere)
- Builds artifacts (HTML documents, architecture docs) as concrete deliverables rather than abstract discussion

## Known pitfalls
- Dark mode interference with CSS is a known pitfall for HTML artifacts; `color-scheme: light only` is the established fix
