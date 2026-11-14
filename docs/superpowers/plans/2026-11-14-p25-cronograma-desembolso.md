# P25 Cronograma de desembolso da proposta de TP (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-075 (#97): o cronograma de desembolso da proposta (UC04.01), só leitura e calculado sempre a partir dos lançamentos da versão (REQ_CD_003). Uma linha por competência da vigência, com:
- a descrição gerada pelo servidor (REQ_CD_002);
- o desembolso do mês;
- o acumulado (RN0251);
- o % acumulado sobre o Valor Global (RN0252);
- o repasse do ciclo de 12 meses (RN0253);
- o fechamento de cada ano (RN0254).

**Architecture:**
- **Onde:** no `orc`, sem tabela.
- **Domínio:** `domain/cronograma.ts`, puro: a série mensal mais as somas, os percentuais e as quebras.
- **Caso de uso:** `application/cronograma.ts` monta a série mensal da versão a partir das mesmas fontes do P23, mês a mês.
- **Tela:** `/orc/cronograma?proposta=<id>`.
- **Recalculado ao salvar as abas:** não há o que gravar. A tela lê na hora, então reflete a última gravação (critério da #97).

**Tech Stack:** o mesmo do P24. Sem migration.

**Spec e fontes:** Catálogo, UC04.01 (REQ_CD_001 a 005, RN_CD_001 a 003, RN0200, RN0250 a 0254, RNF_CD_001 a 003), RN_RAT_05 e o critério da #97. O adendo UC04.06 (previsão de despesas) não está na base de especificação (o Catálogo diz isso, na linha 24). A "previsão de despesas" da US fica como a mesma série por conta, numa segunda tabela.

## Decisões

- **D-P25-1 (escopo):**
  - **Entra:** cronograma mensal com as colunas e quebras acima; a tabela "Previsão de despesas por conta" (conta × ano, com o total); filtro por meta (RN0250: sem meta, o cabeçalho diz "Todos"). Com uma meta escolhida, entram só os lançamentos dela; o rateio, que não tem meta, só aparece em "Todos".
  - **Fica fora, com o motivo:**
    - Exportar (REQ_CD_004 e 005, RN0200, RN0259): relatórios.
    - Agrupadores como subtotais (RF_PLA_REQ_006): o cadastro de agrupadores é da frente B, e o uso nos relatórios fica com eles.
    - O adendo UC04.06: não está na base.
- **D-P25-2 (mês de cada lançamento):**
  - **Pessoal:** o `totalMes` do motor, ano a ano (D-P20-4). Quem não vê o pessoal recebe o cronograma sem ele, com aviso (D-P23-5).
  - **Bens:** no mês da data do bem.
  - **Rateio:** na competência da célula.
  - **Viagens [PROVISÓRIO]:** não têm data (GAP-CAD-002). O custo de cada viagem (passagem, diária e transporte) é **distribuído igualmente pelos meses da vigência**. A parcela é arredondada para baixo, e o resto dos centavos vai para o último mês: a soma bate exato (RN_CD_002) e nenhum mês fica negativo. A tela avisa que as viagens foram distribuídas por igual.
- **D-P25-3 (exatidão, RN_CD_002 e RNF_CD_003):** a soma dos meses é igual ao total dos Totalizadores (P23), com o mesmo filtro de pessoal. Teste de propriedade com vigências de 1 a 60 meses.
- **D-P25-4 (descrições, REQ_CD_002):** "Parcela N – MM/AAAA" e, no fechamento, "Total de AAAA". Nenhum campo de texto.
- **D-P25-5 (% acumulado, RN0252):** acumulado ÷ Valor Global × 100, com 2 casas Half-Even. Com o Valor Global zero, mostra "—".
- **D-P25-6 (repasse, RN0253):** nas linhas 12, 24, 36…, a soma dos 12 meses do ciclo. A última linha de uma vigência que não fecha 12 meses também mostra a soma do ciclo incompleto [PROVISÓRIO]. Nas demais linhas, um hífen.
- **D-P25-7 (fechamento anual, RN0254):** ao fim de cada ano civil da vigência, uma linha "Total de AAAA". O ano é o civil, não o ciclo do contrato, porque a regra diz "por ano".
- **D-P25-8 (permissões):** funcionalidade `orc.cronograma` (ordem 9, `/orc/cronograma`), só consultar. ORCAMENTISTA, GFIN, AUDITOR e DIREX.

## Review Focus

1. **Soma dos meses = Valor Global:** com pessoal, viagens, bens e rateio juntos. Teste no int.
2. **Viagens em vigência de 7 meses:** o resto dos centavos fica no último mês. Teste de domínio.
3. **Ciclo incompleto e quebra de ano:** vigência de 03/2027 a 05/2028. Teste de domínio.
4. **Quem não vê o pessoal:** o cronograma sai sem ele, com aviso. Teste no int.
5. **Vigência de 60 meses:** o cálculo continua puro e rápido (RNF_CD_001).

---

### Task 1: Cálculo

**Interfaces:**
- **Domínio:**
  - `distribuirIgual(valor, meses) → Dinheiro[]`;
  - `montarCronograma(competencias, porMes: Map<string, Dinheiro>, valorGlobal) → LinhaCronograma[]`, em que `LinhaCronograma = { tipo: 'MES' | 'ANO', descricao, competencia?, desembolso, acumulado, percentualAcumulado: Percentual | null, repasseCiclo: Dinheiro | null }`.
- **Aplicação:** `seriesDaVersao(tx, deps, versaoId, comPessoal, competencias) → { porMes, porContaAno, avisos, semPessoal }` e `obterCronograma(ctx, propostaId, filtros, deps)`.

- [ ] **Step 1:** testes do domínio (Review Focus 2, 3 e 5).
- [ ] **Step 2:** testes int (Review Focus 1 e 4; meta).
- [ ] **Step 3:** implementar, com seed e snapshots; commit.

### Task 2: Tela e E2E

- [ ] **Step 1:** a página, com as duas tabelas e as linhas de ano em destaque, e o teste da página.
- [ ] **Step 2:** o link na lista de propostas e o passo 3h do E2E (o desembolso da cópia soma o Valor Global).
- [ ] **Step 3:** o PR com `Closes #97` e o comentário 12.12.
