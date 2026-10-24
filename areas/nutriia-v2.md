---
name: "nutriia-v2"
description: "NutriIA V2.0 / DebyNutri — nutrition-focused healthtech SaaS for nutritionists"
---

- Nutrition-focused healthtech SaaS for nutritionists (multi-tenant, patient portals)
- Architecture nearly identical to SGO 2.0 / oficina stack
- Key deltas: nutritional data API (Open Food Facts, TACO/UNICAMP, or Nutritionix), Anthropic API for AI meal plans and patient evolution analysis, Recharts for charting, no POS or complex fiscal requirements
- Delivered an architectural risk analysis of a prior proposal document, identifying critical issues (Supabase Free Tier limits, pgvector HNSW incompatibility on shared tier, Web Bluetooth unsupported on iOS, cronjob logic incompatible with Edge Functions) and producing a formal DOCX report
