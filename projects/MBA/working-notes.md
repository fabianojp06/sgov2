---
name: "working-notes"
description: "PDF-reading workflow, tools, repository files, and how Fabiano prefers tasks handled in this project"
---

## PDF handling

- All PDFs in this project are scanned image-based files with no text layer; `pdftotext` is ineffective on them
- Reliable reading workflow: install PyMuPDF → render pages to PNG at 1.5x matrix → read the images visually
- For longer PDFs (40–60+ pages), a sampling strategy (pages 1, 5, 10, 15, 20, …) works well to map structure before full sequential reads
- Uses PyMuPDF (`pymupdf.open()`, `page.get_pixmap()`) for reading the scanned PDFs
- Output files are saved to `/mnt/user-data/`

## Repository files

- Main slides (42 pages): `1ffa319b866b477983b3ba28b3b32f4e.pdf`
- Leitura Digital / textbook (61 pages): `8afeae5d5faa47d6927a0ad9d44030c5.pdf`
- Desafio Profissional response (8 pages): `23dc082d7cfd4147a2d7bfcc8a769753.pdf`
- Desafio enunciado (5 pages): `486bb9d54c844800a8b697cd797c7f60.pdf`
- Interactive HTML outputs use tabbed navigation: Visão Geral, Mapa Mental, SCALE & IDEAS, Insights, Desafio, Linear vs. ExO

## Ways of working

- Fabiano communicates concisely, using slash commands (`/posmba`) to activate project context and precise directive phrases to scope tasks
- Tasks tend to escalate in complexity across a session: summarize → expand → visualize
- Prefers comprehensive, structured outputs covering all repository content rather than partial treatments
- For quizzes, expects the correct answer letter plus a brief conceptual explanation tied to course terminology
