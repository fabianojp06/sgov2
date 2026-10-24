---
name: "overview"
description: "SGO 2.0 and RVS — purpose, stakeholders, architecture directives, and current state of both projects"
---

## Role and scope

- Fabiano is Business Analyst / Product Owner at CTCEA/GIA, leading requirements analysis and technical documentation across two distinct active projects: SGO 2.0 and RVS.
- On SGO 2.0 Fabiano operates as Senior Requirements Analyst, with Claude also adopting Software Architect framing when warranted.
- RVS is architecturally separate from SGO 2.0 despite integration touchpoints; specifications must not conflate the two systems.

## SGO 2.0 (Sistema de Gestão Orçamentária)

- Multi-module budgetary management system for CTCEA, built on Next.js/Prisma/PostgreSQL, integrating with ERP Senior (Rubi) via REST.
- The system digitizes manual/Excel-based processes currently handled by GFIN and other teams.
- Eight modules in scope: Módulo Geral (EP083/24), Autenticação (EP084/24), Administração (EP085/24), Cadastros (EP118/24), Orçamentário (EP48/26), Relatório, Viagens, and Aprovações (EP??/26).
- A separate but related Integration Module covers three controllers: `SeniorIntegrationController` (Plano de Contas), `RubiIntegrationController` (RH/Folha), and `RVSIntegrationController` (Viagens → RVS/price reference).

### Canonical architectural directives (SGO 2.0)

- ORIGEM BLINDADA — read-only ERP-sourced fields.
- TRAVA O ERRO — modal persistence on validation errors.
- SOFT DELETE.
- SINCRONISMO ATÔMICO.
- Optimistic Locking via a version field.
- RLS (Row Level Security).
- Multi-tenant via org_id.
- Core engine: TotalizerService.
- All monetary fields use NUMERIC(15,2)/BigDecimal with Half-Even rounding at 2 decimal places.

## RVS (Requisição de Viagem a Serviço)

- Complete redesign of a legacy PHP system in production since 2009; a fully separate project from SGO 2.0.
- TAP formalized 14/08/2026, ~90 business-day timeline targeting V1.0 operation still in 2026.
- Normative source: IT0051:2026. Identified in systems as slug "rvs", id_sistema 122.
- Stack: Express backend, SerpAPI (Google Flights/Google Hotels) via SERPAPI_KEY (backend only), NextAuth+RBAC.
- WebTrip (issuing travel agency) integration still under evaluation.
- Central architectural problem ("ponto cego atual"): real ticket cost only recorded post-purchase (stage 03) — addressed by real-time SerpAPI cotação (Module 1).

### RVS V1.0 scope

- 10 modules: Cotação Passagens, Cotação Hospedagem, Confecção, Aprovação, Passagens e Locações, Diárias, Homologação, Pagamentos, Dashboards/Relatórios, Configurações e Parâmetros.
- 6 roles: Administrador, Usuário Comum, Setor de Viagens (SVG), GFIN, Controladoria (CNTR), Auditoria.
- Out of scope for V1.0: ticket issuance/purchase in-system, self-booking, mobile app, approval by value threshold, international travel scenarios.
- Approval: 2 levels, resolved automatically by functional hierarchy per ADR-0004; sector codes DG=7, DEP=7.15, DAF=7.3.
- AS-IS lifecycle (6 stages): Confecção → Aprovação (2 levels, can return) → Passagens e Locações (SVG/WebTrip) → Diárias (advance) → Homologação (participant + manager, can return) → Pagamentos (GFIN). Continuous budget linkage via Índice de Metas from Confecção through Homologação.
- RN-15: automatic budget balance verification during approval. Budget entered manually by Administrator per partnership term (no financial system integration).

## Key stakeholders across both projects

- André Luis Mattos (SCOR) — primary domain SME and validator for SGO 2.0.
- Wellington (GFIN) — financial/accounting SME, verifier.
- Giovanne — decision-maker for RVS open questions and RVS integration scope in SGO 2.0 (GAP-INT-013).
- Adriana Saadi Aragão (DAF) — approver.
- techlead-fsg — technical lead for ADR reviews.
- Process actors: Priscila (GFIN), Kátia (GRH), Ana Paula (SVG), Tesouraria (SFT), GAD, DIREX, Parceiro (OSCIP).
- A CTCEA tem 4 Termos de Parceria ativos + Administração Central; a Priscila (GFIN) refaz manualmente o ciclo de relatórios 5 vezes (uma por unidade), gastando ~14 dias por ciclo mensal; faz esse processo há 10 anos.
- O GAD é o setor de viagens: envia à GFIN, todo mês, uma planilha por unidade (5×) com orçamentos de passagens aéreas, hospedagens em hotéis e locação de automóveis.

## Visual/document standard (both projects)

- Arial 10pt, A4, institutional color palette DARK_BLUE `1F3864` / MID_BLUE `2E75B6` / LIGHT_BLUE `BDD7EE`, structured header/footer with page numbering.

## Current state — SGO 2.0

- 2026-09: wants stack Supabase + Next.js + Clerk; going with keeping the Next.js monolith (no NestJS for now, extraction criteria via ADR); is weighing redoing SGO completely because the documentation changed a lot.

- Integration Module: `Documento_Integracao_SGO_Senior_Rubi_RVS-V2_layout.docx` delivered with institutional layout applied (header, footer, page numbering); all 176 paragraphs preserved intact.
- Integration Module: gaps GAP-INT-001 through GAP-INT-013 formally tracked. GAP-INT-013 is a critical blocker — Giovanne must decide whether RVSIntegrationController enters MVP or is deferred to v1.1/v2. Neither side currently has a technical contract for the RVS integration, and RVS does not yet expose an external API for price consultation.
- GAP-CAR-004 (Encargo Social formula) pending with Wellington. GAP-CAR-005 (mapeamento de conta contábil no Senior) registered as non-blocking.
- Módulo Orçamentário (EP48/26): GAP-PGD-002 (dissídio compound growth rate discrepancy in ANEXO 5) acknowledged as non-blocking for development; provisional value accepted.
- Módulo Orçamentário: GAP-PGD-001 (snapshot model for Previsto × Realizado) non-blocking now, blocking for future phase; owners André and Wellington.
- Módulo Orçamentário: US-PGD-001 (evolution of UC04.06), BDD criteria AC01–AC05, and business rules RN_PGD_001–004 produced and documented in `Adendo_UC04.06_Previsao_Geral_Despesas-Rev01092026.docx`.
- Módulo Orçamentário — Realizado: Plano de Contas integration serves two distinct purposes — for Orçado (Previsto) it supplies only account structure (values are user-input in SGO); for Realizado it must supply the actual posted transactional value per Nível 7 account per period, sourced from ERP Senior via `SeniorIntegrationController`.
- GAP-PGD-007 (Realizado sync trigger) resolved: both manual button and scheduled job (post month-end closing) are required.
- GAP-PGD-008 (retroactive ERP adjustment behavior) resolved: historical Realizado is immutable once the period is closed (snapshot); any ERP adjustment to a closed period is recorded against the current period instead of rewriting history.
- 2026-10-08: decidiu modelo híbrido para o Realizado (competência aberta = carga sob demanda/provisória; fechada = snapshot imutável); escopo do Realizado no adendo UC04.07 = somente despesa (ERP Senior); regime caixa × competência registrado como GAP.
- GAP-PGD-006 (ERP Senior payload contract for posted value per account/period) and GAP-PGD-009 (aggregated vs. line-item granularity of that payload) remain open/blocking, pending definition with the Senior integration technical team.
- Administration Module (EP085/24): GAP-UC0202-002 remains open, pending validation with André (SCOR); conversation reached a branching point without direction selected.
- Schedule: two-scenario timeline produced — sequential team (~34 weeks, spec excluded) vs. two parallel squads (~22 weeks). Critical path: Squad B — Módulos Base → Viagens/Aprovações → Integração e Testes. Orçamentário carries float.
- Schedule: HTML Gantt (PMI/PMBOK format, WBS, CPM, milestones, float indicators) and comparison chart produced for executive/board use.

## Current state — RVS open questions

- #1: WebTrip own API (pending, non-blocking).
- #5: ERP export automation via database — deferred; maintains text-file approach per RN-08 for now.
- #6: NF digital format/validation in homologação (pending).
- #8: TAP ~90-day schedule is a risk — may require scope reduction to v1.1.
- #10: Real hospitality cotação integration (Module 2) with diárias calculation — deferred; module remains as technical demonstration.
- #11: Substitute approver design for periods — non-blocking; governed by IT0051:2026 via Provisional Substitution IT.
- #12: GFIN payment flow — advance vs. post-homologação closing (1 or 2 moments).
- #13: Two-direction balance support in homologação (Restituir/Receber).
- #14: Employee banking data origin — own registry vs. HR source.
- #15: "No PIX for refunds" rule (SICONV) — still applies.
- #16: ERP text-file export cadence — per RVS vs. batch.
- #17: fkidtipoloc=5 case — Rio de Janeiro differentiated daily rate without overnight stay (variation of RN-06/RN-20).

- 2026-09-26: going with keeping SGO 2.0 as a Next.js modular monolith (no NestJS backend for now); considering a full redo of SGO because the documentation changed a lot — pending a delta analysis of the updated docs vs. what is implemented.

- 2026-09-28: preparing a requirements elicitation document for the budget indicator "Anexo 6" (cost-per-employee spreadsheet); wants understanding + questions for the responsible area validated before writing it. Decided: in SGO, Anexo 6 is a generated report (from Cargos e Salários + Parâmetros), view-only — no data entry.

- 2026-09-28: working on requirements elicitation for the "Anexo 6" budget indicator (custo de mão de obra por cargo); decided it is a read-only report generated from Cargos e Salários + Parâmetros (no data entry).

## On the horizon — SGO 2.0

- GAP-INT-013 resolution by Giovanne (RVS integration MVP vs. deferral).
- GAP-CAR-004 resolution by Wellington (Encargo Social formula).
- GAP-UC0202-002 resolution with André (EP085/24 Administration Module).
- UC04.07–UC04.12 (execution and control UCs for Orçamentário) — flagged as next direction.
- Remaining module specifications and acceptance criteria coverage (UC03.16–UC03.38 area, Viagens, Aprovações).
- Módulo de Aprovações EP number (EP??/26) still unresolved.

## On the horizon — RVS

- Resolution of open questions #1, #6, #8, #12–#17 — most awaiting Giovanne.
- Decision on WebTrip API integration.
- Schedule risk assessment — potential scope reduction conversation.
- Technical contract definition between SGO and RVS for the RVSIntegrationController (currently absent on both sides).
