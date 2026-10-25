# Trilha 2027 — Plano-mestre

> **For agentic workers:** este é o plano-mestre. Ele não tem tarefas de código: ele ordena os planos de bloco (P1 a P7), define os contratos entre as frentes e os marcos. Cada bloco tem o próprio plano detalhado, executado com superpowers:subagent-driven-development ou superpowers:executing-plans.

**Objetivo:** colocar em produção, até 30/11/2026, o recorte do SGO 2.0 que importa, revisa e aprova o orçamento 2027 da Administração Central (spec §3.3), com a planilha-modelo como plano B.

**Arquitetura:** monólito modular Next.js com módulos isolados por lint (spec §4.1), PostgreSQL 16 com Prisma, worker com pg-boss, na VPS Hostinger via Easypanel. Duas frentes em paralelo, cada uma dona das próprias pastas (spec §12).

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (versão 1.1). **Backlog:** `docs/backlog/backlog-sgo-v2.md` (label `trilha-2027`). **Memória:** `docs/memoria/memoria-do-projeto.md`.

## Blocos

| Bloco | Frente | Histórias (issue) | Horas | Previsão* | Depende de | Plano |
| --- | --- | --- | --- | --- | --- | --- |
| **P1 Fundação** | A | US-001 #23, US-002 #24, US-003 #25, US-004 #26, US-005 #27, US-006 #28, US-008 #30, US-009 #31, US-010 #32, US-012 #34 | 74 | 26/10 – 11/11 | — | `2026-10-24-trilha-2027-p1-fundacao.md` |
| **P2 VPS** | B | US-122 #145, US-016 #38 | 12 | 26/10 – 27/10 | — (fora do código) | `2026-10-24-trilha-2027-p2-vps.md` |
| P3 Entrega | B | US-013 #35, US-014 #36, US-015 #37, US-119 #141 | 40 | 28/10 – 08/12 | P1 tarefas 1 e 3; GAP-INF-001 | `2026-10-25-trilha-2027-p3-entrega.md` (inclui os contratos C3 e C4) |
| P4 Componentes e cadastros | B | US-021 #43, US-025 #47, US-043 #65, US-044 #66, US-046 #68, US-049 #71, US-050 #72, US-051 #73, US-053 #75 | 96 | 05/11 – 27/11 | P1 completo | a detalhar após P1 |
| P5 Acesso | A | US-026 #48, US-030 #52, US-031 #53, US-032 #54, US-034 #56, US-038 #60 | 74 | 11/11 – 25/11 | P1; contratos C3 e C4; US-025 | `2026-10-25-trilha-2027-p5-acesso.md` (inclui o contrato C6, bloqueio, limite de taxa e E2E mínimo, decisões do PO de 25/10) |
| P6 Orçamento da Adm. Central | A | US-055 #77, US-120 #142, US-121 #143, US-058 #80, US-059 #81, US-060 #82, US-061 #83 | 60 | 25/11 – 11/12 | P4 (contratos C1 e C2), P5 | a detalhar após P5 |
| P7 Go-live | B (+PO) | US-115 #137, US-116 #138, US-117 #139 | 40 | 27/11 – 07/12 | P3, P6 | a detalhar após P4 |

\* Previsão do `docs/backlog/fonte/cronograma.py` com 40 h/semana por frente. A 60 h/semana por frente, a trilha termina por volta de 27/11. **Se em 20/11 o P6 não tiver começado, o PO aciona o plano B** (aprovação de 30/11 sobre a planilha-modelo).

A **US-120** (planilha-modelo) já foi entregue: `docs/modelos/orcamento-adm-central-2027-modelo-v1.0.xlsx`. Fica aberta até o PO validá-la com a GFIN e a GRH.

## Período de fundação (spec §12.3)

Até o merge de P1 tarefa 1 (US-001) e P1 tarefa 4 (US-004), **só a frente A escreve no repositório**, inclusive em pastas que depois serão da frente B (`worker/`, `.github/workflows/`). Nesse período, a frente B executa o P2, que é feito no servidor, fora do repositório.

## Contratos entre as frentes (spec §12.6)

Cada contrato é um PR pequeno com o `index.ts` do módulo (tipos, assinaturas e um adaptador falso), mergeado **antes** das histórias que o consomem.

| Contrato | Dono | Consumidor | Conteúdo mínimo | Abrir antes de |
| --- | --- | --- | --- | --- |
| C1 Estrutura financeira | B (`cad`) | A (`orc`) | `listarArvoreContas()`, `listarArvoreCentrosCusto()`, `ehContaAnaliticaAtiva(classificacao)`, `ehCentroCustoAnalitico(classificacao)`, tipos `NoConta`/`NoCentroCusto` | US-121 |
| C2 Custo de pessoal | B (`cad`) | A (`orc`) | `calcularCustoPosicao(posicao, premissas): SerieMensalComponentes` (spec §6.6, C33) e `obterPremissasExercicio(ano)` | US-121 |
| C3 Componentes de tela | B (`ger`) | A (todas as telas) | `<GradeArvore>`, `<Formulario>` com `Resultado`, `exportarXlsx()` | US-031 |
| C4 E-mail | B (`ger`) | A (`aut`, `adm`) | `enviarEmail(tx, modelo, destinatario, dados)` via *outbox* | US-038 |
| C5 Autorização e auditoria | A (`shared`) | B (todos os casos de uso) | `definirAcao`, `exigir`, `auditar` (entregues no P1) | P4 |
| C6 Catálogo de funcionalidades | A (`adm`) | B (seeds de `cad`, `ger`, `rel`, `int`) | `DeclaracaoFuncionalidade`, `CODIGOS_PERFIL`, `MODULOS_MENU`, `instalarFuncionalidades(tx, itens)` | primeira seed de módulo da frente B (P4) |

## Marcos de controle

| Data | Marco | Se não acontecer |
| --- | --- | --- |
| 27/10 | P2 concluído: mitigações D12 ativas e VPS endurecida | A frente B não sobe ambiente de dev |
| 05/11 | GAP-INF-001 decidido (domínio, storage, SMTP) | O P3 trava: sem hml nem backup |
| 11/11 | P1 na `main` | A frente B só faz infra |
| 16/11 | GAP-CC-001 (DIREX) e premissas da GFIN | A importação usa a minuta como provisória |
| 20/11 | P6 iniciado | **Plano B**: aprovação sobre a planilha |
| 30/11 | Orçamento 2027 aprovado (no sistema ou na planilha) | — |

## Regras que valem para todos os blocos

- Uma história = uma branch `us-NNN-slug` = um PR com `Closes #n` e a label `frente:X`; merge *squash* pelo PO (spec §12.5).
- Commits terminam com `Frente: A` ou `Frente: B` e os trailers de coautoria.
- No início de cada sessão, ler `docs/memoria/memoria-do-projeto.md`; no fim, atualizar estado, pendências e diário.
- Nenhum comando toca `sgo-prod`/`sgo-hml` a partir das sessões de dev (spec §11.5 item 6, D12).
- Ao concluir um bloco, detalhar o plano do bloco seguinte da mesma frente com o writing-plans, partindo das interfaces que estão de fato na `main`.
