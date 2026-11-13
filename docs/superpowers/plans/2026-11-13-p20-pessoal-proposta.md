# P20 Pessoal da proposta de TP (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-070 (#92). O orçamentista lança na versão da proposta:
- os **empregados**, inclusive as vagas "A CONTRATAR", por cargo, meta e competência, com o custo pelo motor único;
- os **quantitativos por período** (Qtde. Empregados), contados a partir dos empregados.

**Architecture:**
- **Onde:** no `orc`, sobre a US-065 a US-067 (P17 a P19):
  - duas tabelas novas ligadas à **versão** da proposta, com RLS por unidade: `orc_empregado` e `orc_qtde_empregado`;
  - domínio em `domain/empregado.ts`; casos de uso em `empregados.ts` e `qtde-empregados.ts`;
  - telas `/orc/empregados` e `/orc/qtde-empregados` (Cadastros).
- **Custo:** o motor único do `cad` (`MotorCustoPessoal`, C33), pelo `custoDaPosicao` do P15: salário gravado, adicional e benefícios do cargo. Roda ano a ano dentro da competência do empregado.
- **Concorrência:** a do P19. Toda operação sobe a `versao` da capa, e toda recusa vem antes dessa subida.
- **Cópia:** o `copiarLinhasDaVersao` passa a copiar também empregados e quantitativos (RN_DUP_003, "Headcounts com Benefícios"), refazendo o vínculo com a meta pelo número dela.

**Tech Stack:** o mesmo do P17. Sem dependência nova. Uma migration.

**Spec e fontes:**
- **Spec 1.7:** §6.2 (edição só em Rascunho/Em Elaboração), §6.4 (headcount por Proposta/Versão/Meta, "A CONTRATAR", motor único) e C33/C34.
- **`especificacao/` (Cadastros V5 e Catálogo):**
  - UC03.20 a UC03.23 (Qtde. Empregado): RN0145 a RN0148, RN0151 a RN0155, RN0159, RN0194, RN0457, REQ0131 a REQ0133;
  - UC03.24 a UC03.27 (Empregados): RN0183, RN0242, RN0245, RN0248, RN0249, RN0252, RN0254, RN0274, RN_EMP_007, RN_EMP_008, REQ0188, REQ0189, REQ_EMP_001 a 006;
  - Aprovações V2, UC6.01 (WA05).
- **Planos de origem:** P12 (D-P12-3, salário só a quem lança), P15 (D-P15-2/3/5, cargo do cadastro) e P17 a P19.

## Global Constraints

As do P17 a P19 valem todas:
- RLS por unidade;
- Histórico na mesma transação (RN0232);
- nada gravado na frente B;
- dinheiro em `NUMERIC(15,2)` com `Dinheiro`;
- testes pesados com `flock`, um por vez;
- build antes do E2E.

## Decisões deste plano (recomendação; o PO autorizou seguir as recomendações; [PROVISÓRIO] onde marcado)

- **D-P20-1 (escopo):** entram os Empregados (UC03.24 a 27) e a Qtde. Empregados (UC03.20 a 23). Ficam fora:
  - **[Finalizar Lançamentos] e o envio ao WA05:** são da **US-080** (UC6.01), que depende da caixa de aprovações (US-078). O critério "Finalizar lançamentos envia o lote ao WA05" da US-070 passa para lá. A US-070 deixa o lote pronto, mas não o envia.
  - **Elegibilidade de benefícios por empregado** (modal do UC03.24 A1 e UC03.28) e o efeito dos dependentes no custo: os benefícios são os do cargo (D-P15-3). O número de dependentes é gravado, mas não muda o custo [PROVISÓRIO]: a spec não dá a regra do "coeficiente de dependentes".
  - **Hora extra, periculosidade digitada, faixa e nível** (UC03.26, passo 4): o adicional vem do cargo (RN_EMP_007) [PROVISÓRIO].
  - **Vínculo Funcional na grade** (RN_EMP_008): o C2 ainda não expõe o setor do cargo. Fica para um acréscimo do C2, a pedir à frente B na #138.
  - **Valor Global e totalizadores da capa** (RN0274): ficam com a US-074. Os custos ficam prontos aqui.
  - **Imprimir e exportar.**
- **D-P20-2 (empregado):** `orc_empregado`, da versão. Campos:
  - **Meta:** obrigatória na categoria Meta e nula na Consolidada (RN0245, RN_VIA_04, D-P19-7). Só uma meta **ativa** da versão pode ser escolhida (`metasParaLancamento`). A FK é `ON DELETE RESTRICT` para `orc_meta`, o que fecha a RN0136 e a D-P19-6.
  - **Ordem:** sequencial dentro da versão e da meta, recomeçando a cada meta (RN0242). É dada pelo sistema e não muda.
  - **Categoria:** `EMPREGADO`, `ESTAGIARIO` ou `JOVEM_APRENDIZ` (RN0457).
  - **Nome:** opcional, até 120. Vazio grava nulo, e a tela mostra "A CONTRATAR" (RN0249, REQ_EMP_003).
  - **Cargo:** obrigatório, do cadastro de C&S (RN0248), sem FK, como na posição (P15). Só cargo ativo e com Fonte Ativa, regra que vale só na troca de cargo (D-P15-2).
  - **Salário mensal:** a Fonte Ativa decifrada do cargo no momento de salvar, só leitura (RN_EMP_007). Trocar o cargo herda de novo (REQ_EMP_004). Sem a chave da cifra, a gravação é recusada.
  - **Início e fim:** competências.
  - **Dependentes:** de 0 a 20.
- **D-P20-3 (competência):** início e fim são meses (`AAAA-MM`), gravados como o dia 1 do mês. Regras:
  - o início não pode ser anterior ao mês de início da vigência da capa (RN0252);
  - o fim não pode passar do mês de fim da vigência (RN0154, por analogia);
  - o início não pode ser depois do fim.
- **D-P20-4 (custo) [PROVISÓRIO]:** para cada ano da competência, o `custoDaPosicao` do P15 roda com quantidade 1, o salário gravado, os meses do ano dentro da competência e as premissas daquele ano.
  - **Custo total mensal** (REQ_EMP_002) é o custo do primeiro mês da competência; o **custo no período** é a soma dos anos.
  - **Ano sem parâmetros:** fica sem custo, com aviso na tela. Projetar com o ano anterior seria regra sem fonte; as premissas por ano são da US-076.
  - **Reajuste:** o motor aplica o de cada ano sobre o salário gravado, sem acumular entre anos.
- **D-P20-5 (sigilo):** o custo vai só a quem inclui ou altera empregado (D-P12-3: com uma pessoa, o custo revela o salário). O formulário escolhe o cargo por código e nome, sem mostrar salário. A tela de C&S e a posição seguem como estão.
- **D-P20-6 (quantitativo):** `orc_qtde_empregado`, da versão.
  - **Campos:** meta (como na D-P20-2), início e fim (competências, D-P20-3), número do documento (1 a 50, obrigatório, RN0153).
  - **Quantidades** de empregados, estagiários e jovens aprendizes: nunca digitadas. Contam os empregados da mesma versão e meta cuja competência cruza o período (RN0457, REQ0133).
  - **Sobreposição:** proibida para a mesma versão e meta (RN0155). Fica no caso de uso, com a capa travada.
  - **Exclusão:** física (UC03.23). A trava de viagens (RN0145) chega com a US-071.
- **D-P20-7 (ciclo de vida):** incluir, alterar e excluir só com a última versão em Rascunho ou Em Elaboração (RN0183, RN0159), como na D-P19-5. Fora disso, a mensagem do E2 do UC03.27 ou do E1 do UC03.23.
- **D-P20-8 (cópia):** a nova versão e a duplicação copiam empregados e quantitativos com ids novos, a mesma ordem e a meta de destino de mesmo número.
  - **Emenda da revisão 12.12 do #467:** a duplicação pode mudar a capa. Com outra categoria, o pessoal não é copiado. Com outra vigência, só é copiado o que cabe nela.
- **D-P20-9 (exclusão do empregado):** física (UC03.27). A trava de viagens e diárias (RN0254) vira FK `RESTRICT` quando a US-071 ligar a viagem ao empregado. O caso de uso já trata a violação 23503 com a mensagem do E1.
- **D-P20-10 (permissões) [PROVISÓRIO]:**
  - **`orc.empregados`:** Cadastros › Empregados, ordem 3.
  - **`orc.qtde_empregados`:** Cadastros › Qtde. Empregados, ordem 4.
  - **Matriz das duas:** ORCAMENTISTA e ANALISTA_GRH com todas as ações; GFIN, AUDITOR e DIREX só consultar. A ANALISTA_GRH entra porque o §11.3 dá a ela os Empregados, e o WA05 parte dela.

## Review Focus

1. **Duas abas lançando na mesma versão:** a segunda recebe "alterado por outro" e nada fica gravado. Teste de corrida na Task 1.
2. **Competência fora da vigência ou com início depois do fim:** recusada com a mensagem do campo. Teste de domínio.
3. **Meta inativa, de outra versão ou de outra proposta:** recusada como inexistente. Na Consolidada, com meta enviada, a recusa diz que a proposta não opera por metas. Teste de integração.
4. **Excluir meta com empregado ligado:** recusado com a mensagem do E1 do UC03.17 (FK). Teste de integração.
5. **Quem só consulta não vê custo nem salário:** a lista sai sem custo, e o Histórico não grava o salário. Teste de integração e da página.

---

### Task 1: Migration, domínio e casos de uso

**Files:**
- Create: `prisma/migrations/202611132200_orc_empregado/migration.sql`, `src/modules/orc/domain/empregado.ts` (+ teste), `src/modules/orc/application/empregados.ts`, `src/modules/orc/application/qtde-empregados.ts` (+ `.int.test.ts` de cada)
- Modify:
  - `prisma/schema/orc.prisma` (`EmpregadoProposta`, `QtdeEmpregadoProposta`) e `nucleo.prisma` (relações em `Unidade`);
  - `domain/mensagens.ts`;
  - `application/propostas.ts` (cópia) e `governanca.ts` (campos blindados);
  - `infrastructure/seed.ts`;
  - os três testes-retrato (`seed`, `privilegios` e `tela-principal`).

**Interfaces:**
- **Domínio:**
  - `validarEmpregado(bruto, vigencia: { inicio: Date; fim: Date }): Resultado<EmpregadoValidado>`, com `EmpregadoValidado = { categoria; nome: string | null; cargoId: string; inicio: Date; fim: Date; dependentes: number }`;
  - `validarQtde(bruto, vigencia): Resultado<{ inicio; fim; documento }>`;
  - `cruza(a, b)`: os períodos se cruzam;
  - `mesesDoAno(inicio, fim, ano): { mesInicio; mesSaida } | null`.
- **Empregados:**
  - `listarEmpregados(ctx, filtros) → BlocoEmpregados[]`. Cada bloco traz a proposta, a versão, `editavel`, `versaoCapa`, `metas` (as ativas, para o formulário), `empregados` e `totais` por categoria. Cada empregado traz `custoMensal` e `custoPeriodo`, nulos para quem só consulta, e `avisos`;
  - `incluirEmpregado`, `alterarEmpregado` e `excluirEmpregado(ctx, bruto) → Resultado<{ ordem: number; nome: string }>`.
- **Quantitativos:**
  - `listarQtdes(ctx, filtros) → BlocoQtdes[]`;
  - `incluirQtde`, `alterarQtde` e `excluirQtde(ctx, bruto) → Resultado<{ documento: string }>`.
- **Cópia:** `copiarEmpregadosDaVersao(tx, origem, destino, criadoPor)`, chamada pelo `copiarLinhasDaVersao`.

- [ ] **Step 1: Testes de domínio.** Recusas:
  - campos obrigatórios vazios;
  - categoria fora da lista;
  - nome com mais de 120 caracteres;
  - dependentes fora de 0 a 20;
  - competência inválida, antes do início da vigência, depois do fim, ou com início depois do fim;
  - documento vazio ou com mais de 50 caracteres.

  Também: `cruza` e `mesesDoAno` nas bordas (o mesmo mês, a virada de ano e um ano fora).
- [ ] **Step 2: Migration e schema.**
  - CHECKs dos limites, FK `RESTRICT` para versão e meta, triggers de mesma unidade;
  - índice único `(versao_proposta_id, meta_id, ordem) NULLS NOT DISTINCT`;
  - RLS, `REVOKE ALL FROM sgo_sync`, e `GRANT UPDATE` só nas colunas editáveis.
- [ ] **Step 3: Testes de integração** (os do Review Focus, mais estes):
  - "A CONTRATAR" sem nome;
  - ordem por meta;
  - custo igual ao do motor no ano;
  - ano sem parâmetros com aviso;
  - trocar o cargo herda o novo salário;
  - recusa fora de Rascunho e Em Elaboração;
  - quantidades contadas por categoria, sobreposição recusada;
  - nova versão e duplicação copiam empregados e quantitativos;
  - RLS: id de outra unidade é "inexistente".
- [ ] **Step 4: Implementar** até os testes passarem.
- [ ] **Step 5: Commit.**

### Task 2: Telas

**Files:**
- Create: `ui/tela-empregados.tsx`, `ui/form-empregado.tsx`, `ui/tela-qtde-empregados.tsx`, `ui/form-qtde-empregado.tsx`, `application/acoes-empregados.ts` e as páginas `src/app/(sistema)/orc/empregados/page.tsx` e `orc/qtde-empregados/page.tsx`, com os testes das páginas.
- Modify: `orc/index.ts`, e `tela-propostas.tsx` (links "Empregados" e "Qtde. Empregados" da proposta).

- [ ] **Step 1: Testes das páginas:**
  - filtros;
  - um bloco por proposta, quebrado por meta só na categoria Meta (RN0148);
  - colunas Ordem, Empregado ("A CONTRATAR"), Categoria, Cargo, Competência e Custo total mensal (este só para quem lança);
  - totais por categoria;
  - formulário aberto pela URL;
  - exclusão com a confirmação do UC03.27.
- [ ] **Step 2: Implementar.**
- [ ] **Step 3: E2E** em `e2e/orc/propostas.spec.ts`: incluir um empregado "A CONTRATAR" e um quantitativo na proposta de categoria Meta, e limpar no `afterAll`.
- [ ] **Step 4: Commit e PR** (`Closes #92`).
