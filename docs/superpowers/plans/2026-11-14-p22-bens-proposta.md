# P22 Bens, serviços e equipamentos (CAPEX) da proposta de TP (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-072 (#94). Na versão da proposta, o orçamentista cadastra os bens, serviços e equipamentos (CAPEX) em contas analíticas, com o valor total = quantidade × unitário (RN0157). A grade é agrupada por conta, e o item copiado de versão anterior é inativado em vez de apagado (RN_PLA_11).

**Architecture:**
- **Onde:** no `orc`, sobre a US-065 a US-071 (P17 a P21):
  - uma tabela nova ligada à **versão** da proposta, com RLS por unidade: `orc_bem`;
  - domínio em `domain/bem.ts` e caso de uso em `application/bens.ts`;
  - tela `/orc/bens` (Cadastros › Bens, Serviços e Equipamentos).
- **Concorrência:** as peças do `pessoal-comum.ts`, como no P20 e no P21. Toda operação sobe a `versao` da capa, e toda recusa vem antes da subida.
- **Cópia:** o `copiarLinhasDaVersao` passa a copiar os bens ativos (RN_DUP_003).

**Tech Stack:** o mesmo do P21. Sem dependência nova. Uma migration.

**Spec e fontes:**
- Cadastros V5: UC03.34 a UC03.37 (RF_PAT_REQ_001 a 013, REQ0288, REQ0290, RN0157, RN0170, RN0179, RN0213, RN0257, RN0411 a 0420, RN_PLA_11 e RN0232).
- Spec §6.1 (só analíticas ativas recebem valor), C26 (5 níveis, analítica no nível 5) e C27 (natureza OPEX/CAPEX como parâmetro local da conta).

## Decisões

- **D-P22-1 (escopo):**
  - **Entra:** bens com incluir, alterar e excluir ou inativar; grade agrupada por conta analítica com o subtotal e o total geral; filtros; cópia nas versões.
  - **Fica fora, com o motivo:**
    - Imprimir, Exportar, carimbo de emissão, cabeçalho do documento e log de extração (RF_PAT_REQ_007, REQ0289, RN0238, RN0316, RN0398, RN_LOG_AQUISICAO): são do demonstrativo e dos relatórios (US-077 e `rel`).
    - RN0385 (só TP Oficializado): vale para o demonstrativo. O lançamento segue as outras abas, na última versão em Rascunho ou Em Elaboração (RN0183).
    - RN0399 (filtro de aditivos): ainda não há aditivo.
    - RN0413 ("limites máximos de CAPEX da capa"): a capa não tem esse limite (D-P19-4). O total geral é mostrado, sem trava.
    - Colunas mensais (RN0302) e o recálculo do cronograma de desembolso (UC03.36, pós-condição): ficam com a US-075.
- **D-P22-2 (tabela `orc_bem`):**
  - **Colunas:**
    - `id`, `unidade_id` e `versao_proposta_id`;
    - `meta_id` (NULL, FK RESTRICT para `orc_meta`);
    - `conta` (classificação, R5), `descricao` (até 200) e `data` (DATE);
    - `quantidade` (inteiro de 1 a 999.999) e `valor_unitario` NUMERIC(15,2) ≥ 0;
    - `ativo` (padrão verdadeiro), `inativado_em` e `origem_id` (o bem da versão anterior de onde veio a cópia, sem FK);
    - `criado_por`, `criado_em` e `versao`.
  - **Valor total:** não é gravado (RN0157, RF_PAT_REQ_009). É calculado na leitura.
  - **No banco:** CHECKs; o trigger `orc_pessoal_mesma_versao`; RLS; `REVOKE ALL FROM sgo_sync`; o UPDATE é por coluna.
- **D-P22-3 (conta, RN0411 e RN0419) [PROVISÓRIO]:**
  - A conta precisa ser **analítica ativa** da estrutura completa.
  - O filtro do grupo Imobilizado e Intangível é a natureza **CAPEX** do parâmetro local da conta (C27). Ela ainda não sai no contrato do `cad`: o pedido está na #138.
  - Até lá, entra qualquer analítica ativa. O filtro fica como ponto de injeção, `contaCapex?: (classificacao) => boolean` nas `DepsOrc`, e vira obrigatório quando a porta existir.
- **D-P22-4 (meta, RN0170 e RN0179):** a regra das outras abas. Na categoria Meta, uma meta ativa da versão é obrigatória; na Consolidada, nenhuma. No alterar, a meta e a conta podem mudar (UC03.36, passo 3: "readequação de metas").
- **D-P22-5 (data, REQ0290):** é obrigatória e fica dentro da vigência da capa (RN0154, por analogia com a competência do pessoal). Na duplicação com outra vigência, só vêm os bens cuja data cabe nela.
- **D-P22-6 (exclusão, RN_PLA_11, UC03.37 A1, critério da #94):**
  - **Bem com `origem_id`** (veio de uma versão anterior, que fica como retrato): é **inativado**, com `ativo = false` e `inativado_em`.
  - **Bem nascido nesta versão:** exclusão física.
  - **Inativo:** sai da grade, dos subtotais e da cópia; não se altera nem se reativa. A grade mostra quantos estão inativos, e o filtro "Exibir inativos" os lista.
  - RN0420 (vínculo com lançamentos financeiros) ainda não tem a que se ligar.
- **D-P22-7 (grade, RF_PAT_REQ_001 a 006, RN0415, RN0417 e RN0413):**
  - Um bloco por proposta. Dentro dele, um grupo por conta analítica, em ordem crescente de classificação.
  - **Grupo:** as linhas Data, Descrição, Quantidade, Valor unitário e Valor total, mais o subtotal da conta. Com a categoria Meta, aparece também a coluna Meta.
  - **Total geral:** o da proposta.
  - **"Exibir valores zerados" (RN0383):** é uma caixa no filtro, ligada por padrão. Desligada, some o bem com total zero e a conta com subtotal zero.
- **D-P22-8 (filtros, RF_PAT_REQ_002):** Tipo, Proposta, Meta, Descrição, Conta (número ou nome), Período (data inicial e final; vazio é a vigência, RN0294) e Exibir inativos.
- **D-P22-9 (cópia nas versões, RN_DUP_003):**
  - **Nova versão:** copia os bens ativos, com `origem_id` = o id de origem.
  - **Duplicação:** é um TP novo. O `origem_id` fica nulo, porque o retrato é de outra proposta. Só copia com a mesma categoria e só os bens cuja data cabe na vigência nova.
- **D-P22-10 (permissões) [PROVISÓRIO]:**
  - Funcionalidade `orc.bens` (ordem 6, `/orc/bens`).
  - **ORCAMENTISTA:** todas as ações.
  - **GFIN, AUDITOR e DIREX:** consultar.
  - Os UC citam o GFIN como ator da consulta (UC03.34).

## Global Constraints

As do P21. Dinheiro em `Dinheiro`; quantidade inteira. Recusa antes da `travarVersao`. Snapshots atualizados à mão. O `@@index` e as FKs com os nomes padrão do Prisma.

## Review Focus

1. **Inativar × excluir:** o bem copiado de V1 é inativado em V2, e o V1 continua intacto. O bem criado em V2 é apagado. Teste no int.
2. **Nova versão a partir de uma versão com inativos:** os inativos não vêm. Teste no int.
3. **Total geral × filtro de zerados:** o total é o mesmo com e sem a caixa, porque só os zeros somem. Teste de domínio.
4. **Duplicação com vigência menor:** o bem com data fora dela não vem. Teste no int.
5. **Concorrência:** a corrida pela mesma `versaoCapa` acaba em um gravado e um ALTERADO_POR_OUTRO.

---

### Task 1: Banco, domínio e casos de uso

**Files:**
- Create: `prisma/migrations/202611140300_orc_bem/migration.sql` e `src/modules/orc/domain/bem.ts`, com `bem.test.ts`
- Modify:
  - `prisma/schema/orc.prisma` (modelo `BemProposta`) e `prisma/schema/nucleo.prisma`;
  - `domain/mensagens.ts`;
  - `application/governanca.ts` (`CAMPOS_ORIGEM_BLINDADA.bem`: `valorTotal`, `ativo`, `origemId`, `inativadoEm`, `tipo`, `unidadeId`, `versaoPropostaId`);
  - `application/deps.ts` (`contaCapex?`);
  - `application/propostas.ts` (chama `copiarBensDaVersao`);
  - `infrastructure/seed.ts` e os três snapshots.
- Create: `application/bens.ts` e `bens.int.test.ts`

**Interfaces:**
- **Domínio:**
  - `validarBem(bruto, vigencia): Resultado<BemValidado>`, com `BemValidado = { conta, descricao, data: Date, quantidade, valorUnitario }`;
  - `totalDoBem(b): Dinheiro`;
  - `agruparPorConta(bens, exibirZerados) → { conta, itens, subtotal }[]`.
- **Aplicação:** `listarBens(ctx, filtros, deps)`, `opcoesBem(ctx, deps)`, `incluirBem`, `alterarBem`, `excluirBem` (devolve `{ descricao, inativado: boolean }`) e `copiarBensDaVersao(tx, origem, destino, criadoPor, comOrigem: boolean)`.

- [ ] **Step 1:** testes do domínio:
  - total 3 × 1.234,56 = 3.703,68;
  - obrigatórios com a mensagem do REQ0290;
  - quantidade 0, 1.000.000 e 1,5 recusadas;
  - data fora da vigência recusada;
  - descrição de 201 caracteres recusada;
  - agrupamento em ordem crescente de conta, com o subtotal (RF 3).
- [ ] **Step 2:** domínio, mensagens, migration e schema.
- [ ] **Step 3:** testes int:
  - incluir na categoria Meta e na Consolidada;
  - conta sintética recusada;
  - ponto de injeção `contaCapex` recusa a conta fora do CAPEX;
  - alterar com troca de meta e de conta;
  - inativar o copiado e excluir o novo (RF 1);
  - nova versão sem inativos (RF 2);
  - duplicação com vigência menor (RF 4);
  - corrida (RF 5);
  - versão imutável;
  - Histórico;
  - consulta (GFIN).
- [ ] **Step 4:** caso de uso, seed e snapshots. Rodar `npm run test:int -- src/modules/orc` e conferir que passa.
- [ ] **Step 5:** commit.

### Task 2: Tela e E2E

**Files:**
- Create: `ui/tela-bens.tsx`, `ui/form-bem.tsx`, `application/acoes-bens.ts`, `src/app/(sistema)/orc/bens/page.tsx` e `ui/paginas-bens.test.ts`
- Modify: `orc/index.ts`, `ui/tela-propostas.tsx` (link "Bens da proposta N") e `e2e/orc/propostas.spec.ts` (passo 3e; o `afterAll` apaga `orc_bem`)

- [ ] **Step 1:** testes da página:
  - grupos por conta com o subtotal e o total geral;
  - a caixa de zerados;
  - a nota de inativos;
  - o formulário com a meta;
  - quem consulta não vê ações.
- [ ] **Step 2:** tela, ações e página. Rodar `npm test`, `lint` e `typecheck`.
- [ ] **Step 3:** E2E. Rodar `npm run build` e `npm run test:e2e -- e2e/orc/propostas.spec.ts`, sem o `flock` por fora, porque os scripts já o pegam.
- [ ] **Step 4:** commit, PR com `Closes #94` e o comentário 12.12.
