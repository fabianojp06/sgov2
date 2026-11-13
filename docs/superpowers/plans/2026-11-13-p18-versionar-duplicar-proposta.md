# P18 Versionar e duplicar a proposta de TP (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-066 (#88).
- **Duplicar (UC03.08):** cria uma proposta **nova e independente**: TP novo, com unidade, número e CC próprios, em Rascunho, Versão 1.
- **Nova versão (UC03.09):** cria a revisão seguinte **da mesma proposta**, em Rascunho.

**Architecture:**
- **Onde:** sobre a US-065 (P17, #440), no `orc`: `propostas.ts`, `domain/proposta.ts` e a tela `/orc/propostas`.
- **Sem migration:** as tabelas e os GRANTs da US-065 bastam. A versão nova é um INSERT em `orc_versao_proposta`; a capa só sobe a `versao` (o GRANT existe).
- **Concorrência:** toda operação sobre as versões começa subindo a `versao` da capa, com `updateMany` condicional e `exigirUmaLinha`. Isso trava a linha da capa até o commit e fecha a lacuna registrada na revisão do #440: uma exclusão ou outra versão concorrente cai em `ALTERADO_POR_OUTRO`.
- **Duplicar reusa a criação:** é uma criação com os campos da origem pré-preenchidos e editáveis. O caso de uso extrai do `criarProposta` o miolo transacional (`gravarPropostaNova`), que os dois usam.
- **Cópia das linhas:** ainda não há linhas de lançamento (US-067, US-070 a 072). O plano cria o ponto de extensão `copiarLinhasDaVersao(tx, origem, destino)`, hoje vazio, que cada história de lançamento preenche. A RN_DUP_003, 007 e 008 viram teste dessas histórias.

**Tech Stack:** o mesmo do P17. Sem dependência nova e sem migration.

**Spec e fontes:**
- **Spec 1.7:** §6.2 (versionar ≠ duplicar; ciclo de vida; edição só em Rascunho/Em Elaboração, RN_ALT_002); C16 (o versionamento é o UC03.09, cuja redação está "a corrigir"); C37 (CC único entre os TPs ativos); §6.7 (o TP é a unidade).
- **`especificacao/` (Cadastros V5 e Catálogo):**
  - UC03.08 Duplicar: fluxo, A1, E1 e E2, RF_DUP_REQ_001 a 004, RNF_DUP_REQ_001 a 003 e RN_DUP_001 a 008;
  - as pistas de versionamento: "Criar Nova Versão … opera sobre Propostas em Rascunho"; o Oficializado muda "via Termo Aditivo ou nova versão em rascunho".
- **Plano de origem:** P17, D-P17-1 a 10.

## Global Constraints

As do P17 valem todas:
- RLS por unidade;
- o Histórico na mesma transação, sem nada órfão;
- nada gravado na frente B;
- testes pesados com `flock`, um por vez; build antes do E2E.

## Decisões deste plano (recomendação; o PO autorizou seguir as recomendações; [PROVISÓRIO] onde marcado)

- **D-P18-1 (de onde se versiona) [PROVISÓRIO até o UC03.09 ser reescrito, C16]:**
  - Só da **última** versão, e só se ela estiver em **Rascunho ou Em Elaboração**.
  - Em Aprovação, Oficializado e Encerrado são recusados com `VERSAO_NAO_PERMITIDA` **[PROVISÓRIO]**. O Oficializado muda por Termo Aditivo (§6.2, F4).
  - A versão nova recebe o número da última mais 1 e nasce em Rascunho.
- **D-P18-2 (a versão anterior):** fica com a situação que tinha, como histórico, e é somente leitura porque só a última versão é editável. Não há estado novo ("Substituída").
- **D-P18-3 (modal de duplicar):**
  - O modal traz o **Número do TP** e o **CC**, este só com os livres. É um desvio da RF_DUP_REQ_002, porque cada TP tem número e CC próprios (C37, D-P17-2).
  - O objeto vem com o prefixo "Cópia de " (RN_DUP_002), cortado em 500.
  - Tipo, categoria, datas e parceiro vêm da origem, editáveis.
  - A validação é a mesma da criação (`validarCapa`, com os 30 dias).
- **D-P18-4 (quem fica vinculado):** só quem duplica (D-P17-3). Os vínculos da origem não são copiados.
- **D-P18-5 (Histórico):**
  - Duplicar grava um `INSERCAO` em `orc.propostas` na proposta nova, com `depois.propostaOrigemId`/`numeroOrigem`, e a descrição "Proposta do TP <novo> duplicada da proposta do TP <origem>". O vínculo vai como na criação.
  - Nova versão grava um `INSERCAO` em `orc.propostas` com `registroId` da capa e `depois: { versao: n, situacao: 'RASCUNHO', versaoAnterior: n-1 }`.
  - Nenhum tipo de operação novo (`TIPOS_OPERACAO`).
- **D-P18-6 (permissão):** `orc.propostas:incluir` para duplicar e para versionar.
- **D-P18-7 (origem):**
  - Proposta excluída não se duplica nem se versiona: é tratada como inexistente.
  - A origem de outra unidade também é tratada como inexistente, pela RLS (só se duplica o que se vê).
  - A origem pode estar em qualquer situação (RN_DUP_001).
- **D-P18-8 (concorrência da origem, RNF_DUP_REQ_003):**
  - A duplicação recebe a `versao` da capa de origem e confere no fim, sem subir.
  - Origem mudada no meio gera `ALTERADO_POR_OUTRO` e nada é gravado.
  - A nova versão recebe `{ id, versao }` e sobe a `versao` da capa.
- **D-P18-9 (fora):** o avançar Rascunho → Em Elaboração (UC03.10), o envio e o snapshot (US-079), a cópia de linhas (cada US de lançamento) e a exclusão de versão (UC03.11). **Para o PO:** o UC03.10 não tem história própria no backlog; propõe-se entrar no plano da US-079.

## Review Focus

1. **Exclusão × nova versão ao mesmo tempo:** só uma vence; a outra recebe `ALTERADO_POR_OUTRO`, sem versão órfã.
2. **Duas novas versões ao mesmo tempo:** só uma vence. Não pode haver dois "V2" (o índice `(proposta_id, numero)` também garante).
3. **Duplicar com o CC da origem ativa:** recusado com `CC_DE_OUTRO_TP`. Duplicar com o número da origem: `NUMERO_DUPLICADO`.
4. **Usuário sem vínculo com a origem:** tentar duplicar ou versionar pelo id dá inexistente.
5. **A tela com a última versão:** a lista mostra a situação e o número da **última** versão. "Excluir" e "Nova versão" agem sobre ela.

---

### Task 1: Casos de uso (duplicar e nova versão) e concorrência

**Files:**
- Modify:
  - `src/modules/orc/application/propostas.ts`:
    - extrair `gravarPropostaNova`;
    - acrescentar `duplicarProposta`, `novaVersaoProposta` e `copiarLinhasDaVersao`;
    - fazer o `excluirProposta` subir a `versao` (já sobe) e travar pela capa;
  - `src/modules/orc/domain/mensagens.ts`;
  - `src/modules/orc/domain/proposta.ts`: `SITUACOES_VERSIONAVEIS = ['RASCUNHO', 'EM_ELABORACAO']` e `objetoDaCopia(objeto)`.
- Test: `src/modules/orc/application/propostas.int.test.ts` e `src/modules/orc/domain/proposta.test.ts`.

**Interfaces:**
- `duplicarProposta(ctx, bruto: { origemId; versaoOrigem; numero; cc; tipo?; objeto?; parceiro?; inicio?; fim?; categoria? }, deps?): Promise<Resultado<{ id; unidadeId; numero }>>`
- `novaVersaoProposta(ctx, bruto: { id; versao }, deps?): Promise<Resultado<{ numero: string; versao: number }>>`
- `dadosParaDuplicar(ctx, id, deps?): Promise<{ origemId; versaoOrigem; tipo; objeto; parceiro; inicio; fim; categoria; numeroOrigem } | null>`: os valores do modal, com o objeto já com "Cópia de ".
- `copiarLinhasDaVersao(tx, origem: { propostaId; versaoId }, destino: { propostaId; versaoId }): Promise<void>`: vazio, com o comentário das histórias que o preenchem.

- [ ] **Step 1: Testes que falham**
  - **Domínio:** `objetoDaCopia('X')` dá "Cópia de X". Acima de 500, corta. "Cópia de Cópia de X" é aceito como está.
  - **Duplicar:**
    - grava unidade nova (número e CC novos), vínculo, capa e V1 em Rascunho, mais o Histórico com a origem;
    - a origem fica intacta: a capa, a versão e o Histórico dela não mudam;
    - o CC da origem ativa dá `CC_DE_OUTRO_TP`; o número da origem dá `NUMERO_DUPLICADO`;
    - origem excluída ou de outra unidade dá inexistente;
    - `versaoOrigem` diferente dá `ALTERADO_POR_OUTRO`, sem nada gravado;
    - sem `incluir`, `ErroPermissao`.
  - **Nova versão:**
    - V1 em Rascunho gera V2 em Rascunho; a `versao` da capa sobe; o Histórico registra;
    - a lista mostra a V2;
    - "Excluir" passa a agir com a versão nova da capa.
  - **Recusas por situação:** forjar no teste, com o `migrator`, a última versão em `EM_APROVACAO`, `OFICIALIZADO` e `ENCERRADO`. Todas dão `VERSAO_NAO_PERMITIDA`. `EM_ELABORACAO` é permitido.
  - **Concorrência:**
    - duas novas versões em paralelo (com a transação concorrente segura pelo `migrator`, como no teste de corrida do P17): uma vence, a outra recebe `ALTERADO_POR_OUTRO`;
    - exclusão × nova versão: o mesmo.
- [ ] **Step 2:** os testes falham. **Step 3:** implementar. **Step 4:** `npm run test:int -- src/modules/orc/application/propostas.int.test.ts` e unidade do domínio passam. **Step 5:** commit.

### Task 2: Tela

**Files:** `src/modules/orc/ui/tela-propostas.tsx`, um novo `src/modules/orc/ui/form-duplicar-proposta.tsx`, `src/modules/orc/application/acoes-propostas.ts`, `src/app/(sistema)/orc/propostas/page.tsx`, `src/modules/orc/ui/paginas-propostas.test.ts` e `e2e/orc/propostas.spec.ts`.

- [ ] **Step 1: Testes de página**
  - Na linha da proposta, com `incluir`, aparecem "Nova versão" (com `AcaoConfirmada`; só quando a última versão é Rascunho ou Em Elaboração) e "Duplicar".
  - "Duplicar" é um link para `?duplicar=<id>`, que abre o formulário com os campos pré-preenchidos, o Número em branco e o CC com os livres.
  - A coluna "Versão" mostra o número da última versão.
  - O Auditor não vê nenhum dos dois.
- [ ] **Step 2: Implementar.**
  - A ação de duplicar redireciona para `/orc/propostas?aviso=duplicada&tp=<novo>`.
  - A ação de nova versão redireciona para `?aviso=versao&tp=<número>`.
  - Textos [PROVISÓRIOS].
- [ ] **Step 3: E2E** (passo novo no `propostas.spec.ts`): o Orçamentista cria uma nova versão (V2 aparece) e duplica para `TP-E2E-002` com o CC `9.2`. As duas aparecem. O `afterAll` apaga também o TP duplicado.
- [ ] **Step 4:** lint, tipos, unidade, arquitetura, `test:int` completo, build e E2E. **Step 5:** commit, PR (`Closes #88`, label `frente:A`), revisão 12.12 independente, aviso na #138 e merge com o CI verde.
