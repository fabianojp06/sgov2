# P23 Totalizadores da proposta de TP (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-074 (#96): a aba Totalizadores da proposta (UC03.02).
- **Árvore de contas:** só leitura, com Orçado, Realizado e Saldo e o semáforo por linha.
- **Origem do orçado:** os lançamentos da versão (pessoal, viagens e bens).
- **Valor Global:** a capa passa a mostrar o calculado (RN_TP_003). Até aqui ele aparecia como 0,00.

**Architecture:**
- **Onde:** no `orc`, sem tabela nova. O Totalizador é o cálculo na leitura (REQ_TOT_002, recalculado ao abrir a aba). Usa o `totalizar()` de `@/shared/totalizer` sobre os nós de conta do C1 (`nosContas`), como o orçamento da Adm. Central.
- **Arquivos:** caso de uso em `application/totalizadores.ts`, domínio em `domain/totalizador.ts` (semáforo da RN_TOT_04) e tela `/orc/totalizadores`.
- **Somas por conta analítica da versão (RN_TOT_03):**
  - **Pessoal:** as `linhas` por componente do motor único (`custoDaPosicao`, cada linha com a sua conta), ano a ano, como na D-P20-4. O ano sem parâmetros fica de fora, com aviso.
  - **Viagens:** a passagem na conta de passagem, a diária na de diária e o transporte na de transporte. Aqui o transporte entra, porque é despesa da conta, embora fique fora do custo estimado da viagem (C19).
  - **Bens:** os ativos, o total na conta do bem.
- **Valor Global:** o total geral, mostrado na lista de propostas (`listarPropostas`) e no cabeçalho das metas (`listarMetas`). É calculado pela mesma função `totaisDaVersao(tx, deps, versaoId)`.

**Tech Stack:** o mesmo do P22. Sem dependência nova e sem migration.

**Spec e fontes:**
- Cadastros V5, UC03.02: REQ_TOT_001 a 003 e RN_TOT_01 a 05.
- Spec: RN_TP_003 e §6.2 (o Valor Global sempre calculado) e C7 (semáforo).

## Decisões

- **D-P23-1 (escopo):**
  - **Entra:** árvore só leitura, totais, semáforo, Valor Global calculado.
  - **Fica fora, com o motivo:**
    - Realizado: ainda não há execução (F5, Integração 2). A coluna mostra 0,00, e o semáforo é verde (E1).
    - Rateio e ISS: US-073.
    - Imprimir e Exportar (REQ_TOT_003): relatórios.
    - Trava "soma das metas = Valor Global" (D-P19-4): fica para o envio (US-079).
- **D-P23-2 (semáforo, RN_TOT_04) [PROVISÓRIO]:**
  - As faixas fixas da RN_TOT_04: verde até 70%, amarelo até 85%, laranja até 95% e vermelho acima.
  - O uso é realizado ÷ orçado. Com orçado zero e realizado zero, é verde; com orçado zero e realizado maior que zero, é vermelho.
  - As faixas por exercício do C7 são do orçamento anual da Adm. Central, e a proposta atravessa exercícios.
- **D-P23-3 (árvore):**
  - Só os ramos com algum valor, para a árvore não ficar com centenas de linhas zeradas.
  - Na proposta sem lançamento, aparece a mensagem do E1 ("Nenhuma despesa localizada para esta versão do projeto.") e o total zerado.
  - Expandir e recolher com `<details>`, sem JavaScript (REQ_TOT_001).
  - Conta lançada que saiu do plano ativo: vai para uma linha "Contas fora do plano ativo", para o total não perder valor.
- **D-P23-4 (versão):** a última versão de cada proposta, com o seletor de proposta pela URL (`?proposta=<id>`). Sem o parâmetro, a lista das propostas leva cada uma à sua aba.
- **D-P23-5 (permissões e sigilo do salário) [PROVISÓRIO]:**
  - **Funcionalidade:** `orc.totalizadores` (ordem 7, `/orc/totalizadores`), só com a ação consultar. ORCAMENTISTA, GFIN, AUDITOR e DIREX consultam.
  - **Sigilo:** a D-P20-5 esconde o custo do pessoal de quem só consulta os empregados.
  - **Quem vê o pessoal:** só quem tem `orc.empregados:incluir` ou `alterar` vê as contas de pessoal e o total.
  - **Para os outros:** o pessoal sai da soma, e a tela avisa que o total exclui o pessoal (restrito). O Valor Global da capa segue a mesma regra.
- **D-P23-6 (Valor Global):** substitui o `Dinheiro.zero()` de `listarPropostas` e `listarMetas`. Faz uma consulta por proposta da lista, o que é aceitável no tamanho atual. Se a lista crescer, fica anotado um cache.

## Review Focus

1. **Pessoal com dois anos, um sem parâmetros:** só o ano com parâmetros soma, e o aviso aparece. Teste no int.
2. **Bem inativo e viagem com transporte:** o inativo não soma; o transporte soma na conta dele. Teste no int.
3. **Sintética soma as filhas (RN_TOT_02):** conferido com duas analíticas sob a mesma sintética.
4. **Quem só consulta não deduz o salário pelo total:** o pessoal sai da soma, com o aviso. Teste no int e na página.
5. **Conta fora do plano ativo:** vai para a linha à parte. Teste de domínio.

---

### Task 1: Cálculo e Valor Global

**Files:**
- Create: `domain/totalizador.ts` e `totalizador.test.ts`, `application/totalizadores.ts` e `totalizadores.int.test.ts`
- Modify:
  - `application/empregados.ts`: exporta `linhasDoEmpregado` (componentes por conta, por ano), sem mudar o custo da lista;
  - `application/propostas.ts` e `application/metas.ts`: o Valor Global;
  - `infrastructure/seed.ts` e os três snapshots.

**Interfaces:**
- **Domínio:**
  - `semaforo(orcado, realizado): 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO'`;
  - `arvoreDeTotais(nos, porConta) → NoTotal[]`, em que `NoTotal = { classificacao, descricao, nivel, orcado, realizado, saldo, semaforo, filhos }`, mais `foraDoPlano`.
- **Aplicação:**
  - `totaisDaVersao(tx, deps, versaoId, comPessoal) → { porConta: Map<string, Dinheiro>; avisos; pessoalRestrito: boolean }`;
  - `obterTotalizadores(ctx, propostaId, deps)`.

- [ ] **Step 1:** testes do domínio:
  - as faixas 70%, 70,01%, 85%, 95% e 95,01%;
  - os casos de orçado zero;
  - a soma das filhas;
  - o fora do plano;
  - a poda dos ramos zerados.
- [ ] **Step 2:** testes int:
  - pessoal em dois anos;
  - viagem com transporte;
  - bem inativo;
  - Valor Global na lista e nas metas;
  - consulta sem o pessoal;
  - proposta vazia (E1).
- [ ] **Step 3:** implementar. Rodar o int do orc e os snapshots.
- [ ] **Step 4:** commit.

### Task 2: Tela e E2E

- [ ] **Step 1:** página `/orc/totalizadores?proposta=<id>`:
  - a árvore em `<details>`, com as colunas Conta, Orçado, Realizado, Saldo e Semáforo (texto e cor);
  - sem botão nenhum (RN_TOT_01);
  - valores negativos entre parênteses (RN_TOT_05).
- [ ] **Step 2:** link "Totalizadores da proposta N" na lista de propostas.
- [ ] **Step 3:** passo 3f do E2E: os totalizadores da cópia mostram o total das viagens e dos bens lançados nos passos 3d e 3e.
- [ ] **Step 4:** PR com `Closes #96` e o comentário 12.12.
