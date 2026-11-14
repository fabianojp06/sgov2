# P32 — Realizado por arquivo (US-085, parte 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** carregar o realizado por TP × conta analítica × competência a partir de um arquivo, com as regras do OxR V2 (RN_OXR_003 a 007), e expor a leitura à frente B.

**Architecture:** quatro tabelas por unidade no `orc` (carga, realizado, ajuste, pendência) e uma global (competência fechada). A carga é um caso de uso do `orc` numa transação só (atômica, RN_OXR_005), dentro do `emUnidade` do TP. A leitura `realizadoPorTp` é a porta pública. O `realizado` do Consolidado deixa de ser zero.

**Tech Stack:** Prisma 7, PostgreSQL 16 com RLS, `lerPlanilhasSegura` do `ger` (C4), Next.js 16 (Server Actions), Vitest e Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` §6.6 e linha 361, mais o documento **Orçado x Realizado V2** (`especificacao/`, seções 3.1, 4, 5 e 7; AC06 e AC07). Issue #107; pedido da frente B na #138.

## Global Constraints

- Dinheiro em `NUMERIC(15,2)`, Half-Even, nunca `number`.
- **RN_OXR_003:** valor só em conta analítica; sintética não se grava.
- **RN_OXR_004:** conta desconhecida vira pendência, com conta e valor, sem alterar outra conta.
- **RN_OXR_005:** mês aberto, a carga substitui; atômica: se falhar, o anterior permanece.
- **RN_OXR_006:** mês fechado não muda; a diferença vira ajuste no mês aberto seguinte, com o mês de origem.
- **RN_OXR_007:** toda execução vai ao Histórico, com data e hora, usuário, status e totais.
- **RN_OXR_008:** realizado da analítica no mês = carga + ajustes lançados no mês.
- Marca neutra; textos em pt-BR; uma migration (`202611141500_orc_realizado`, posterior à `202611141400` da frente B).

## Decisões [PROVISÓRIAS] (para o PO validar)

- **D-P32-1, layout do arquivo** (GAP-PGD-006/009 segue aberto):
  - um .xlsx lido pelo `lerPlanilhasSegura`, aba `Realizado`;
  - colunas `Conta`, `Competência` e `Valor`, cabeçalho até a linha 5;
  - a conta é a classificação do C1;
  - a competência é `AAAA-MM` ou `MM/AAAA`;
  - o valor tem até 2 casas e pode ser negativo (estorno);
  - linhas repetidas de conta × competência são somadas (o ERP manda o total pago por conta e mês, seção 4).

  Quando o payload do Senior for definido, só o leitor muda.
- **D-P32-2, carga por TP:** o usuário escolhe o TP e envia o arquivo dele (A1 do OxR é na tela do TP). Qualquer erro de linha (competência inválida ou fora da vigência, valor inválido, conta vazia) reprova o arquivo inteiro, com a lista de erros, e nada é gravado. O erro de leitura também vai ao Histórico (RN_OXR_007, status).
- **D-P32-3, substituição:** para cada competência **aberta** presente no arquivo, o realizado do TP naquela competência é apagado e regravado. As competências ausentes do arquivo ficam como estão. As pendências do TP nas competências presentes no arquivo também são substituídas.
- **D-P32-4, fechamento:**
  - a competência fecha por uma ação da GFIN no SGO (`orc.realizado:aprovar`), para todos os TPs;
  - só fecha competência anterior ao mês corrente;
  - não há reabertura nesta parte;
  - a fonte diz só "após o fechamento mensal" (GAP-PGD-007).
- **D-P32-5, ajuste:**
  - para competência fechada no arquivo, a diferença por conta é o valor do arquivo menos (a carga gravada da competência + os ajustes já lançados com essa origem);
  - diferença não zero vira ajuste na primeira competência aberta posterior à origem;
  - recarregar o mesmo arquivo não gera ajuste novo.
- **D-P32-6, conta sintética no arquivo:** vira pendência com o motivo "conta sintética" (RN_OXR_003), como a desconhecida.
- **D-P32-7, permissão `orc.realizado`:**
  - funcionalidade no ADM_CENTRAL, ordem 12, rota `/orc/realizado`;
  - ações `consultar`, `executar` (carregar) e `aprovar` (fechar a competência);
  - a GFIN tem as três; DIREX e AUDITOR só consultam.
- **D-P32-8, Consolidado:** o realizado do TP passa a ser a soma de realizado + ajustes de todas as competências. A forma de `LinhaConsolidado` e `ComparativoTp` não muda.
- **D-P32-9, fora desta parte:**
  - reprocessar pendências depois da Integração 1;
  - o previsto (`previsto?`) na porta;
  - a grade Orçado × Realizado (US-086 em diante);
  - a integração direta com o Senior.

## Review Focus

1. Carga num mês fechado com valor igual ao já gravado: não gera ajuste (idempotência).
2. Carga que falha no meio (erro de linha, conflito): nada muda, nem as pendências.
3. Usuário de outro TP: a RLS não deixa ler nem gravar o realizado alheio.
4. Conta inativa (soft delete) com realizado: é aceita, não vira pendência (RN_OXR_001).
5. Competência fechada logo depois de uma carga do mesmo mês: o ajuste seguinte usa o valor gravado antes do fechamento.

---

### Task 1: migration e modelos

**Files:**
- Create: `prisma/migrations/202611141500_orc_realizado/migration.sql`
- Modify: `prisma/schema/orc.prisma`

**Tabelas:**
- `orc_realizado_carga` (`id`, `unidade_id`, `arquivo`, `linhas`, `total`, `pendencias`, `ajustes`, `competencias text[]`, `carregado_por`, `carregado_em`);
- `orc_realizado` (`unidade_id`, `conta`, `competencia date`, `valor`, `carga_id`), único em (`unidade_id`, `conta`, `competencia`);
- `orc_realizado_ajuste` (`unidade_id`, `conta`, `competencia_origem`, `competencia_lancamento`, `valor`, `carga_id`);
- `orc_realizado_pendencia` (`unidade_id`, `conta_erp`, `competencia`, `valor`, `motivo` com CHECK `CONTA_DESCONHECIDA`/`CONTA_SINTETICA`, `carga_id`);
- `orc_competencia_fechada` (`competencia date` PK, `fechada_por`, `fechada_em`), sem RLS: é global.

**Restrições:**
- CHECK de competência no dia 1;
- RLS por unidade nas quatro primeiras;
- `sgo_app`: no realizado e na pendência, INSERT, SELECT e DELETE; na carga e no ajuste, só INSERT e SELECT; na competência fechada, INSERT e SELECT;
- `sgo_sync`: nada.

### Task 2: carga (`src/modules/orc/application/realizado.ts`)

- `carregarRealizado(ctx, { propostaId, arquivo }, deps?) → Resultado<ResumoCarga>`, com `exigir(ctx,'orc.realizado','executar')`.
- Leitor e validação puros em `src/modules/orc/domain/realizado.ts`: `validarLinhasRealizado(linhas, vigencia) → Resultado<Map<conta|competencia, Dinheiro>>`.
- `fecharCompetencia(ctx, competencia)` com `aprovar`.
- **Testes de integração** (`realizado.int.test.ts`):
  - AC06: conta desconhecida vira pendência;
  - AC07: Mai fechado com +2.000,00 gera ajuste em Jun, com origem Mai;
  - a recarga de mês aberto substitui;
  - a recarga idêntica de mês fechado não gera ajuste;
  - o erro de linha não grava nada;
  - a RLS barra outro TP;
  - a conta sintética vira pendência;
  - a conta inativa é aceita.

### Task 3: porta, Consolidado, tela e seed

- `realizadoPorTp(ctx, { tp, de, ate })`, com o formato combinado na #138, exportada no `index.ts`.
- `obterConsolidado` e `obterComparativoTps` com o realizado somado.
- A tela `/orc/realizado`: escolher o TP, enviar o arquivo, ver o resumo da última carga, as competências do TP com o realizado, os ajustes e as pendências, e fechar a competência.
- No seed: `orc.realizado`.
- Atualizar as listas exatas: seed, menu e privilégios.
- E2E: passo 3n, com a GFIN carregando o realizado do TP do fluxo e o consolidado mostrando o valor.
