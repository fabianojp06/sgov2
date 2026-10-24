---
name: "tooling"
description: "Document generation workflow, widget conventions, and available MCP connectors for JAIF project deliverables"
---

- Document generation workflow: Node.js `docx` library → `present_files` for DOCX output
- `soffice.py` is used for PDF conversion; `pdftoppm` for previews
- DOCX generation requires `convertInchesToTwip` for margins and `ShadingType.CLEAR` for cell backgrounds
- Interactive widgets are built with `visualize:show_widget` using fully self-contained HTML/CSS/JS — no external fonts or stylesheets
- MCP connectors available: Supabase, Vercel, Resend, Lovable, Lucid
