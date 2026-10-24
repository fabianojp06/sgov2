---
name: "ways-of-working"
description: "Analysis principles, documentation standards, workflow patterns, and the toolchain for SGO 2.0 / RVS artifacts"
---

## Core analysis principles

- Never invent or assume business rules. All unknowns must be formally registered as numbered gaps (GAP-XXX-NNN format) and routed to the responsible SME — applied consistently across all modules and both projects.
- Document strictly from existing source documentation. Generate artifacts from what exists; register gaps rather than speculating on absent specifications.
- Surface ambiguities before artifact generation, not after: structured multiple-choice clarifying questions before formal documents are written; decisions confirmed explicitly before proceeding.
- Distinguish blocking vs. non-blocking gaps — track separately what prevents development progress from what can be documented as pending.
- Flag numerical inconsistencies rather than silently adopting stated parameters (e.g. GAP-PGD-002 compound growth discrepancy raised explicitly).
- Two entities sharing a name signals a documentation risk — naming ambiguities (e.g. two entities both called "Tabela Salarial") are flagged proactively and renaming is suggested.

## Established domain distinctions

- "Duplicar" ≠ "Versionar": Duplicar = new independent Proposal entity; Versionar = new revision within the same Proposal. This distinction was formally established and must be preserved.
- Agrupadores de Contas (not synthetic accounts) are the correct pattern for grouping ERP analytical accounts for reporting in SGO, preserving ERP-exclusive account hierarchy integrity.

## Workflow patterns

- Role invocation: Fabiano activates specific analytical modes explicitly (Analista de Negócios/PO, Analista de Processos/Requisitos, Software Architect, DBA); Claude mirrors the active role.
- Iterative, decision-driven workflow: gaps and decisions resolved in batches; Claude identifies contradictions and missing information, raises them structuredly, waits for decisions, then generates artifacts.
- Living specification documents: generated `.docx` files are the canonical artifacts, versioned (V1/V2/V3/Rev.01, month/year suffix, e.g. V3-Jun2026). New canonical versions replace prior ones rather than editing them.
- Gap register as refinement agenda: formal GAP tables double as structured agendas for refinement meetings with SMEs.
- Section completeness standard: UC documents must include Fluxo Principal, Fluxos Alternativos, Fluxos de Exceção, Requisitos Funcionais, Regras de Negócio, Requisitos Não Funcionais, Protótipos, and Classes Envolvidas. Missing sections are flagged as deficiencies.
- Executive vs. technical layering: same content produced in both technical specification form and executive/board presentation form when needed (e.g. Processo Atual × SGO 2.0 comparison at both levels).

## Document generation toolchain

- Document generation: Node.js `docx` library, executed via bash from `/home/claude/`; output to `/mnt/user-data/outputs/`. Visual QA: `soffice --headless --convert-to pdf` → `pdftoppm -jpeg -r 100`.
- `.docx` layout-only modification (header/footer injection): unzip the `.docx`, create header/footer XML files directly in `word/`, register relationships using IDs that avoid conflicts with existing ones, declare content types in `[Content_Types].xml`, inject references into `<w:sectPr>`. Validate with `validate.py --auto-repair` before delivery.
- Spreadsheet reading: Python `openpyxl` with `data_only=True` (required for formula-driven cells); locate files via `find /mnt -iname` when upload path differs from expected.

## Diagrams and source parsing

- Lucidchart diagrams: `Lucid:lucid_create_erd` for class diagrams; `Lucid:lucid_convert_svg_to_diagram` for process flows (product: `"lucidchart"`). SVG must be self-contained with explicit `viewBox` and inline styles.
- Lucidchart JSON parsing: Python — access `data['pages'][0]['items']`, build an `id_to_shape` dict; resolve connections via `line.get('endpoint1', {}).get('connectedTo', None)`.
- Source document parsing: `pandoc [file] -t markdown` for `.docx`; `grep` directly on raw files when pandoc returns limited structure. Notion PDF exports are often ZIP archives — rename to `.zip`, extract, concatenate pages in order. HTML: BeautifulSoup with `get_text(separator='\n')` after decomposing `script`/`style` tags.
- Project knowledge search: `project_knowledge_search` with UC identifiers and business rule codes combined in query strings. Document revision date format (e.g. Rev21052026) in titles is used consistently and should be preserved in search queries.

## PPTX visual standard (comparativo V1×V2)

- The canonical PPTX comparison layout is the one from the original EP084/24 build script (chat 6fe77a09), NOT the EP085 rebuild script — the EP085 one was itself an approximation and must not be used as the reference again. Canonical style: top navy (`1F3864`) bar with breadcrumb ("EPxxx/24 · <module> · SGO 2.0") + right-aligned slide label; Arial font throughout; palette `mid:2E75B6, light:BDD7EE, bg:F4F7FB, red:C0392B/red_l:FDECEA, green:1B6B3A/green_l:E8F5EC, amber:B7770D/amber_l:FFF8E1, gray:5A6474, text:1C2B3A`; cover and closing slides on dark navy bg with a mid-blue left stripe; KPI scorecard slide (red boxes for V1 gaps, green boxes for V2 delivered, `kpi_card` helper with colored top border, big number + label); 3-column comparative tables (Elemento / V1 / V2) with tinted red/green row backgrounds; risk/attention slide uses amber tag + amber-tinted cards; closing slide uses "✓ Bold — detail" checklist lines. Fabiano explicitly flagged (2026-09-17) that reusing the wrong reference script wasted his tokens/time — always locate and use the true original build script via conversation_search before treating any layout request as "same as before."

## Normative sources

- IT0051:2026 (RVS), ERP Senior/Rubi (SGO integration), SICONV rules (RVS payment constraints), ADR-0004 (RVS approval hierarchy).
