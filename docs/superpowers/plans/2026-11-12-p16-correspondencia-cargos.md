# P16 Tela de correspondência entre o cargo em texto e o cadastro de C&S (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a #410 (US-056, C34): uma tela em que a GFIN liga, de uma vez, as posições de pessoal com o cargo em texto ao cargo do cadastro de C&S, sem mudar o salário gravado.

**Architecture:**
- **Nada novo no `cad` nem no banco.** O P16 usa só o contrato de C&S já na `main` (#408): `listarCargosSemSalarioCifrado`, `listarCargosExercicio` (pelo `cargosParaPosicao` do P15) e `beneficiosDoCargo` (pelo `custoDaPosicao`). Nenhuma migration: a coluna `orc_posicao.cargo_id` é do P15 (#413).
- **Caso de uso novo** em `src/modules/orc/application/correspondencia-cargos.ts`, que reaproveita do `posicoes.ts` a regra do cargo escolhido, o retrato do Histórico e a gravação das linhas da posição. Esses trechos passam a ser exportados, sem mudança de comportamento.
- **Recálculo como na alteração pela tela** (D-P12-5): com as premissas iguais às do último cálculo, só as linhas das posições ligadas; mudadas, o exercício inteiro (o escopo é sempre TOTAL aqui).
- **Tela** em `/orc/posicoes/correspondencia?ano=`, com um link na tela de posições. É a mesma funcionalidade `orc.posicoes`, sem item novo no menu nem permissão nova.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL 16, Zod 4, Vitest + Testcontainers, Playwright. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md`:
- C34 (texto livre na trilha 2027; "a C24 entra depois de 30/11, com uma tela de correspondência entre o texto importado e o cadastro de C&S");
- C24 (cargo do cadastro);
- §6.4 (motor único: benefícios e adicional do cargo);
- §6.6 (posição);
- D10 e R24 (salário mascarado; Fonte Ativa só com `cad.salarios:consultar`, com `CONSULTA` no Histórico);
- §12.7 (relação entre frentes por id).

Planos de origem: P12 (D-P12-3 a D-P12-7) e P15 (D-P15-1 a D-P15-6). O UC04.17 não é EP (GAP-ORC-004): regras e mensagens novas são **[PROVISÓRIAS]**.

## Global Constraints

- **Idioma e marca:** português do Brasil; marca neutra.
- **Dinheiro:** só em `Dinheiro`, nunca em `number`.
- **Guarda:** toda página e toda Server Action passam pela guarda. A permissão e o escopo são conferidos **no servidor**.
- **Toda escrita:**
  - começa por `travarExercicio`;
  - grava o Histórico na mesma transação;
  - sobe a versão do exercício.
- **O salário gravado nunca muda** nesta tela. Ele não vai à `descricao` do Histórico; o `antes`/`depois` seguem o `retrato` do P12, que a tela de detalhe mascara.
- **Sem `cad.salarios:consultar`:** nenhum valor da Fonte Ativa nem da faixa vai ao cliente.
- **Tabelas da frente B:** nada grava direto nelas, nem no E2E.
- **Testes pesados:** `npm run test:int` e `npm run test:e2e` (já com `flock`), um por vez (D12). Só arquivos da frente A.

## Decisões deste plano (recomendação; o PO autorizou seguir as recomendações em 12/11)

- **D-P16-1 (quem usa):**
  - Exige `orc.posicoes:alterar` com **escopo TOTAL** (`exigirEscopoTotal`). Na seed, isso é a GFIN.
  - O Gestor de Diretoria e quem só consulta recebem `ErroPermissao`; a página responde 404, como as outras (`naoEncontradoSeNegado`).
  - O link na tela de posições só aparece para quem pode: `podeAlterar`, `opcoes.escopoTotal`, exercício editável e alguma posição em texto.
  - Dar a tela ao ANALISTA_GRH fica para o PO. Seria pela tela de perfis, com `orc.posicoes:alterar`, e isso também abriria a ele a tela de posições.
- **D-P16-2 (o que aparece):**
  - Uma linha por **texto exato** (`cargo`) das posições do exercício com `cargo_id` nulo, em ordem alfabética (`localeCompare` pt-BR). Cada linha traz a quantidade de posições, de CCs distintos e o menor e o maior salário gravado.
  - Quem chega à tela já vê o salário (D-P12-3: tem `alterar`).
  - Posição já ligada não aparece.
- **D-P16-3 (sugestão):**
  - Cargo do cadastro com o **nome igual** ao texto, sem diferença de maiúsculas, acentos e espaços repetidos: `normalizarNome` com NFD, sem marcas combinantes, minúsculas, espaços colapsados e `trim`.
  - Mais de um cargo com o mesmo nome normalizado = sem sugestão.
  - A sugestão só vem pré-escolhida no seletor; a pessoa confirma.
  - O exemplo da #410 ("Analista Orç.") não casa por nome igual e fica sem sugestão. A sugestão por semelhança fica fora (YAGNI).
- **D-P16-4 (cargos da escolha):**
  - Os mesmos da posição (`cargosParaPosicao` do P15): ativos e com Fonte Ativa.
  - A Fonte Ativa e a faixa vão só a quem tem `cad.salarios:consultar`, e só com a chave da cifra, com o `CONSULTA` que o `cargosParaPosicao` já grava. O rótulo da opção ganha "· Fonte Ativa R$ x" nesse caso. A diferença para o salário gravado fica visível pela coluna "Salário gravado" ao lado.
- **D-P16-5 (ligar):**
  - Entrada `{ exercicioId, texto, cargoId, versao }`, em que `versao` é a do **exercício** lida na tela. Qualquer mudança no exercício depois da leitura dá `ALTERADO_POR_OUTRO`.
  - Na transação:
    1. `travarExercicio`;
    2. exercício editável;
    3. versão igual;
    4. cargo pela mesma regra da escolha na posição (existe, ativo, com Fonte Ativa; `validarCargoEscolhido`);
    5. as posições com `cargo_id` nulo e `cargo = texto`; nenhuma = `CORRESPONDENCIA_SEM_POSICOES`;
    6. o custo de cada uma com o cargo (motor antes de qualquer escrita; um erro de uma posição volta com o CC na mensagem e nada é gravado);
    7. `cargo` = nome do cadastro (120 caracteres), `cargo_id` e a versão de cada posição;
    8. as linhas;
    9. um `ALTERACAO` por posição no Histórico.
  - O salário, a quantidade, os meses e a origem não mudam. Uma posição IMPORTACAO continua IMPORTACAO e segue o risco da D-P15-6.
- **D-P16-6 ("manter em texto"):** não há marcação. O texto que a pessoa não liga continua na lista e na posição como está (C34). Nada é gravado.
- **D-P16-7 (fora do P16):**
  - **A exigência do cargo do cadastro na inclusão e na alteração não entra agora.** Pela C34, a C24 entra "depois de 30/11", e o cadastro da GRH pode estar vazio em produção: exigir hoje travaria o lançamento da trilha 2027.
  - A exigência fica para uma issue nova, depois de 30/11 e com o cadastro preenchido. A #78 continua aberta, e o PR do P16 usa `Closes #410` e `Refs #78`.
  - A importação continua em texto e cai nesta tela; passar a aceitar o código do cargo fica com o PO.
- **D-P16-8 (frente B):**
  - Nenhum arquivo da frente B muda, e nenhum contrato novo é pedido.
  - O aviso na #138 sai ao abrir o PR: a tela lê `listarCargosExercicio` e `beneficiosDoCargo` em lote por exercício (um `beneficiosDoCargo` por cargo distinto, pelo cache do P15). Quando o `beneficiosDosCargos` em lote entrar, a troca vale aqui também.

## Review Focus

1. **Duas abas:** a tela foi aberta e outra pessoa alterou uma posição. Ligar deve recusar com `ALTERADO_POR_OUTRO` e não gravar nada.
2. **Erro de motor:** uma das posições do texto dá erro de motor (premissas sem conta de benefício). Deve vir o erro com o CC e nenhuma posição ligada.
3. **Texto com espaços ou caixa diferente:** é outro texto, outra linha. Ligar um não liga o outro.
4. **Cargo inválido:** cargo inativo ou sem Fonte Ativa enviado à mão (fora da lista) deve ser recusado com a mensagem do P15.
5. **Escopo:** Gestor de Diretoria chamando a ação direto deve receber `ErroPermissao`, sem Histórico de alteração.

---

### Task 1: Caso de uso da correspondência (listar e ligar)

**Files:**
- Create: `src/modules/orc/application/correspondencia-cargos.ts`
- Modify: `src/modules/orc/application/posicoes.ts`:
  - exportar `retrato`;
  - extrair de `aplicarCargo` o `validarCargoEscolhido`;
  - extrair de `recalcularPosicao` o `gravarLinhasPosicao`;
  - `escopoTotal` em `OpcoesPosicao`.
- Modify: `src/modules/orc/domain/mensagens.ts`
- Test: `src/modules/orc/application/correspondencia-cargos.int.test.ts`

**Interfaces:**
- Produces:
  - `normalizarNome(s: string): string`;
  - `type ItemCorrespondencia = { texto: string; posicoes: number; ccs: number; salarioMinimo: string; salarioMaximo: string; sugestaoId: string | null }`, com os salários em texto canônico;
  - `type ListaCorrespondencia = { itens: readonly ItemCorrespondencia[]; cargos: CargosPosicao; versao: number; editavel: boolean; rotuloSituacao: string }`;
  - `listarCorrespondencias(ctx, exercicioId, deps?): Promise<ListaCorrespondencia>`. Com o exercício não editável, devolve `itens` e `cargos` vazios, sem chamar `cargosParaPosicao` (sem `CONSULTA` à toa);
  - `ligarCargoPosicoes(ctx, bruto, deps?): Promise<Resultado<{ ano: number; posicoes: number }>>`;
  - em `posicoes.ts`:
    - `validarCargoEscolhido(tx, cache, cargoId, cargoGravado, deps): Promise<Resultado<CargoExercicio>>`;
    - `gravarLinhasPosicao(tx, exercicioId, posicaoId, cc, serie): Promise<void>`;
    - `retrato`;
    - `OpcoesPosicao.escopoTotal: boolean`.
- Mensagens [PROVISÓRIAS]:
  - `CORRESPONDENCIA_SEM_POSICOES`: "Nenhuma posição com esse cargo em texto. Recarregue a tela.";
  - `CORRESPONDENCIA_LIGADA(n)`: "<n> posição(ões) ligada(s) ao cargo do cadastro.";
  - `CORRESPONDENCIA_ERRO_POSICAO(cc, msg)`: "CC <cc>: <msg>".

- [ ] **Step 1: Testes que falham** (`correspondencia-cargos.int.test.ts`, no molde do `posicoes.int.test.ts`, com `custoPessoalFalso` e `cargosExemplo`)
  - **`listarCorrespondencias`:**
    - posições "Analista de orçamento" (2, em 2 CCs), "analista de  ORCAMENTO" (1) e uma já ligada a C002 → dois itens; o primeiro e o segundo sugerem C001; a ligada não aparece; salários mínimo e máximo corretos;
    - GFIN sem `cad.salarios` → `cargos.comSalario` falso e sem `CONSULTA`;
    - Gestor de Diretoria e AUDITOR → `ErroPermissao`.
  - **`ligarCargoPosicoes`:**
    - liga "Analista de orçamento" a C001: as 2 posições ficam com `cargoId` C001, `cargo` = nome do cadastro, salário igual, versão +1; a versão do exercício sobe; 2 `ALTERACAO` com `depois.cargoId`; o texto "analista de  ORCAMENTO" continua sem cargo; as linhas da posição incluem os benefícios do cargo;
    - versão do exercício diferente → `ALTERADO_POR_OUTRO`, nada gravado;
    - cargo C004 (inativo) → `CARGO_INATIVO`; C003 (sem Fonte Ativa) → `CARGO_SEM_FONTE_ATIVA`;
    - texto sem posição → `CORRESPONDENCIA_SEM_POSICOES`;
    - exercício `EM_APROVACAO` → erro de não editável;
    - Gestor de Diretoria → `ErroPermissao`, sem Histórico.
- [ ] **Step 2:** `npm run test:int -- src/modules/orc/application/correspondencia-cargos.int.test.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar.**
  - Refatorar `posicoes.ts` (as extrações acima), com `aplicarCargo` e `recalcularPosicao` chamando os extraídos.
  - Escrever o caso de uso pela D-P16-5.
  - Quando as premissas mudaram (`e.versaoPremissas !== premissas.versao`): gravar as posições e chamar `recalcularExercicio`. No `antes`/`depois` vai `versaoPremissas`, como na alteração.
- [ ] **Step 4:** rodar o teste novo e `posicoes.int.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit.

### Task 2: Tela, ação, link e E2E

**Files:**
- Create:
  - `src/app/(sistema)/orc/posicoes/correspondencia/page.tsx`;
  - `src/modules/orc/ui/tela-correspondencia.tsx`, Server Component;
  - `src/modules/orc/ui/ligar-cargo.tsx`, `'use client'`: seletor + `AcaoConfirmada`.
- Modify:
  - `src/modules/orc/application/acoes-posicoes.ts` (`ligarCargoAcao`);
  - `src/modules/orc/index.ts`;
  - `src/modules/orc/ui/tela-posicoes.tsx` (link);
  - `src/app/(sistema)/orc/posicoes/page.tsx`.
- Test:
  - `src/modules/orc/ui/paginas-correspondencia.test.ts`;
  - `e2e/orc/posicoes.spec.ts` (passo novo).

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `ligarCargoAcao`, com a guarda `orc.posicoes:alterar`. No sucesso, faz redirect para `/orc/posicoes/correspondencia?ano=<ano>&ligadas=<n>`, e a página mostra `CORRESPONDENCIA_LIGADA(n)` em `role="status"`.

- [ ] **Step 1: Testes de página** (molde do `paginas-posicoes.test.ts`)
  - GFIN vê a tabela com o texto, as posições, os CCs e o salário, e o seletor com a sugestão pré-escolhida.
  - Sem `cad.salarios`, a opção não traz "Fonte Ativa".
  - Gestor de Diretoria → 404.
  - Lista vazia: "Nenhuma posição com cargo em texto neste exercício."
  - Exercício não editável: o aviso de situação e nenhum botão.
  - Na tela de posições: o link "Ligar cargos em texto ao cadastro" aparece só para quem tem `alterar` com `escopoTotal`, num exercício editável com posição sem cargo.
- [ ] **Step 2: Implementar.** Tabela com as colunas Cargo em texto, Posições, CCs, Salário gravado (menor a maior) e Cargo do cadastro.
  - A última coluna tem o seletor (a primeira opção é "Escolha o cargo") e o botão "Ligar" com a confirmação `CONFIRMA_LIGAR(texto, n, nome)`: "Ligar as <n> posições com o cargo "<texto>" ao cargo <nome> do cadastro? O salário gravado não muda." [PROVISÓRIO].
  - Sem cargo escolhido, o botão fica desabilitado.
- [ ] **Step 3: E2E**, novo passo no `posicoes.spec.ts`, depois da inclusão em texto pelo Gestor: a GFIN abre a correspondência, liga "Analista de orçamento E2E" a SINT-001 e a posição aparece na lista com o nome do cadastro.
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm test`, depois `npm run test:int` e `npm run test:e2e`. Esperado: tudo verde.
- [ ] **Step 5:** commit, PR (`Closes #410`, `Refs #78`, label `frente:A`), comentário "Revisão de código (12.12)", aviso na #138 (D-P16-8) e merge com o CI verde.
