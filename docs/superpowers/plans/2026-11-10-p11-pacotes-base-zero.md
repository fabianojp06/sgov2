# P11 Pacotes base zero pela tela (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Gestor de Diretoria e a GFIN lançam, alteram e excluem **pacotes base zero** do orçamento da Adm. Central pela tela, com prévia do anual e das 12 parcelas (US-057, #79). A US-056 (posições de pessoal pela tela) fica para um bloco próprio, depois das decisões do PO sobre o cargo do C&S e o sigilo do salário (C24/C34).

**Architecture:**
- **Tudo no `orc`, sem módulo novo e sem mudança na frente B.** O domínio já existe: `orc_pacote` (`PacoteBaseZero`), `calcularPacote` (`src/modules/orc/domain/pacote.ts`, R4, Half-Even, diferença em dezembro), o IPCA de `premissas.ipca` (C2), o veto `contasVetadasEmPacote` e o escopo `resolverEscopo` (C25, R8).
- **Uma migration** (spec §12.7): origem `'TELA'` no CHECK de `orc_pacote` e a coluna `versao` (concorrência otimista, US-011).
- A importação da planilha passa a substituir só os pacotes do CC com `origem <> 'TELA'` (D-P11-7); os lançados pela tela sobrevivem a uma nova importação.

**Tech Stack:** Next.js 16.4.3, React 19.3.1, Prisma 7.10.1, PostgreSQL 16, Zod 4.6.7, Vitest 5.0.5 + Testcontainers, Playwright 1.64.0. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` §6.6 (l.378–396: campos, validações, cálculo R4, interação), §11.3 (l.729–736: quem pode), l.351 (situações editáveis), C25, R8, R15, R16, GAP-ORC-003, GAP-ORC-004 (o UC04.17 não tem EP: toda regra e mensagem do `orc` é **[PROVISÓRIA]**).

## Global Constraints

- Português do Brasil; marca neutra; dinheiro em `Decimal`/`NUMERIC(15,2)` com Half-Even, nunca `number`.
- Toda Server Action e toda página passam pela guarda; escopo conferido **no servidor** (R8), inclusive no CC do registro existente ao alterar e excluir.
- Toda escrita grava o Histórico na mesma transação; conflito de versão pelo núcleo (`MENSAGEM_CONFLITO`, `exigirUmaLinha`).
- Escrita só com o exercício em Rascunho ou Em Elaboração (o trigger `orc_exige_editavel` já garante no banco).
- Toda escrita de pacote começa por `travarExercicio` (FOR UPDATE, antes de tocar `orc_pacote`) e faz `versao + 1` e `atualizadoEm` no exercício, para o envio e a aprovação recusarem uma versão que a GFIN não viu.
- Mensagens do `orc` ficam em `MENSAGENS_ORC` (`src/modules/orc/domain/mensagens.ts`), **[PROVISÓRIAS]** (GAP-ORC-004). Já existentes e reaproveitadas: "O orçamento foi recalculado." (`RECALCULADO`), "CC fora do seu escopo.", `ALTERADO_POR_OUTRO`.
- Testes pesados com `npm run test:int`/`test:e2e` (com `flock`), um por vez (D12). Só arquivos da frente A.

## Decisões deste plano (recomendação; o PO valida no PR do plano)

- **D-P11-1 (quem lança):** funcionalidade nova `orc.pacotes` ("Pacotes base zero" **[PROVISÓRIO]**, grupo do orçamento da Adm. Central): GESTOR_DIRETORIA e GFIN com consultar, incluir, alterar e excluir; DIREX e AUDITOR só consultar. O Orçamentista não lança (a §11.3 dá a ele só as propostas). O Gestor lança só nos CCs da subárvore do seu escopo; a GFIN, em qualquer CC.
- **D-P11-2 (recálculo por operação):** incluir, alterar ou excluir um pacote recalcula **só as linhas daquele pacote** (o pacote não depende de outros registros, só do IPCA das premissas), na mesma transação, e avisa "O orçamento foi recalculado.". Se as premissas mudaram desde o último recálculo do exercício, quem tem escopo (Gestor) recebe **[PROVISÓRIO]** "As premissas do exercício mudaram. Peça à GFIN para recalcular o orçamento antes de lançar." (mesma regra da importação, que hoje recusa nesse caso); a GFIN recalcula o exercício inteiro, como já faz a importação.
- **D-P11-3 (contas):** o seletor oferece só contas **analíticas ativas** do C1 sob o plano oficial, menos `contasVetadasEmPacote` (pessoal 4.1.1.1/4.1.1.2 e as contas usadas pelas premissas, inclusive encargos); o servidor recusa as mesmas contas por chamada direta.
- **D-P11-4 (Histórico):** uma entrada por operação (INSERCAO, ALTERACAO, EXCLUSAO) com `antes`/`depois` do pacote (CC, conta, justificativa, prioridade, quantidade, valor unitário, IPCA, distribuição, mês) — pacote não tem dado sigiloso.
- **D-P11-5 (origem blindada):** pela §6.6, o Gestor edita também o que a planilha trouxe: a tela altera e exclui pacote de qualquer origem, mas nunca muda `origem`/`importacaoId` (entram em `CAMPOS_ORIGEM_BLINDADA`, `src/modules/orc/application/governanca.ts`). Um pacote importado e alterado continua `IMPORTACAO` e é substituído numa reimportação do CC; o formulário avisa **[PROVISÓRIO]** "Este pacote veio da planilha: uma nova importação deste CC o substitui.".
- **D-P11-7 (reimportação, muda a R7 do P6):** a importação da planilha substitui os pacotes do CC com `origem <> 'TELA'` (IMPORTACAO e COPIA, como hoje); os lançados pela tela ficam. Um pacote importado e alterado pela tela continua `IMPORTACAO` e é substituído. Risco para o PO: o Gestor lançar o mesmo item na tela e na planilha.
- **D-P11-8 (saídas):** excluir sempre pode, mesmo com CC/conta inativados ou conta que passou a ser vetada; alterar exige conta válida (pode trocar a conta). Quem tem escopo TOTAL vê os pacotes de CC fora da estrutura ativa. Id de pacote fora do escopo responde **[PROVISÓRIO]** "Pacote não encontrado." (não revela que existe). A decisão da D-P11-2 é pelo tipo de escopo (TOTAL × subárvore), não pelo perfil.
- **D-P11-6 (prévia):** a prévia do anual e das 12 parcelas é calculada no cliente com a mesma função pura `calcularPacote` (sem I/O; o IPCA do exercício vai serializado como texto para a página), e o servidor recalcula ao gravar (o valor gravado é sempre o do servidor).

## Review Focus

1. **Escopo forjado:** Gestor que manda o id de um pacote de outra diretoria, ou troca o CC de um pacote dele para um CC fora do escopo → recusado no servidor.
2. **Exercício fechado:** lançar com o exercício Em Aprovação ou Oficializado → recusado com a mensagem de situação (e o trigger também barra); envio para aprovação com a versão de antes de um pacote alterado → `ALTERADO_POR_OUTRO`.
3. **Totais que não fecham:** a soma das 12 parcelas gravadas é igual ao anual em qualquer valor (centavos que sobram vão para dezembro); prévia do cliente igual ao gravado.
4. **Conta vetada por chamada direta:** conta de pessoal ou de premissa enviada pelo formulário forjado → recusada.
5. **Concorrência:** dois salvamentos do mesmo pacote com a mesma versão → um grava, o outro recebe `MENSAGEM_CONFLITO`.

---

### Task 1: Caso de uso, migration e catálogo (US-057, parte 1)

**Files:**
- Migration: `prisma/migrations/202611101500_orc_pacote_tela/migration.sql` (CHECK da origem com `'TELA'`; `versao int NOT NULL DEFAULT 0 CHECK (versao >= 0)`, sem GRANT novo)
- Modify: `prisma/schema/orc.prisma`, `src/modules/orc/application/importacao.ts` (D-P11-7), `src/modules/orc/domain/planilha.ts` (exportar a validação por linha do pacote, como `validarReceita`), `src/modules/orc/domain/mensagens.ts`, `src/modules/orc/application/governanca.ts`, `src/modules/orc/infrastructure/seed.ts`, `src/modules/orc/index.ts`
- Create: `src/modules/orc/application/pacotes.ts` (`listarPacotes`, `incluirPacote`, `alterarPacote`, `excluirPacote`, `opcoesPacote`), `src/modules/orc/application/acoes-pacotes.ts` (`'use server'`)
- Test: `src/modules/orc/application/pacotes.int.test.ts`

**Interfaces:**
- Produces: `listarPacotes(ctx, exercicioId)` (só os CCs do escopo), `opcoesPacote(ctx, exercicioId)` → `{ ccs, contas, ipca: string | null, situacao }`, `incluirPacote(ctx, entrada)`, `alterarPacote(ctx, id, versao, entrada)`, `excluirPacote(ctx, id, versao)`; todos devolvem `Resultado`.

- [ ] **Step 1:** testes de integração, um por Review Focus e mais:
  - incluir mensal e pontual: linhas gravadas iguais a `calcularPacote`; 12 parcelas fecham o anual; IPCA marcado aplica `premissas.ipca`;
  - justificativa com menos de 10 caracteres, quantidade < 1, valor ≤ 0, mês ausente no pontual → mensagens da validação existente;
  - Gestor no CC do escopo grava; fora do escopo e com id de outra diretoria → "CC fora do seu escopo."; GFIN em qualquer CC;
  - premissas mudadas: Gestor recusado com a mensagem da D-P11-2; GFIN grava e o exercício inteiro é recalculado;
  - exercício fora de Rascunho/Em Elaboração → recusado;
  - Histórico por operação; versão velha → conflito; pacote importado alterado continua `IMPORTACAO`; uma reimportação do CC mantém os pacotes `TELA`.
- [ ] **Step 2:** implementar migration, schema, validação exportada, casos de uso, ações e seed. Ajustar o teste do menu (`src/modules/aut/application/tela-principal.int.test.ts`) e a matriz de autorização entra sozinha.
- [ ] **Step 3:** verificações (typecheck, lint, unidade, arquitetura, `test:int` do orc/aut/adm); commit.

### Task 2: Tela de pacotes com prévia (US-057, parte 2)

**Files:**
- Create: `src/modules/orc/ui/tela-pacotes.tsx`, `src/modules/orc/ui/form-pacote.tsx` (cliente, prévia), `src/app/(sistema)/orc/pacotes/page.tsx`
- Test: teste de unidade da página e do bundle cliente (o `form-pacote` não pode levar código de servidor), `e2e/orc/pacotes.spec.ts`

- [ ] **Step 1:** página com `exigirPagina('orc.pacotes', 'consultar')`: escolha do exercício e do CC (só os do escopo), lista dos pacotes do CC (conta, justificativa, prioridade, anual, distribuição, origem) com Alterar e Excluir na linha (confirmação pela `AcaoConfirmada` do `ger`), formulário de inclusão e de alteração (linha em edição destacada), erros em lista acima do botão e formulário que mantém o digitado.
- [ ] **Step 2:** prévia ao digitar: anual e as 12 parcelas (ou o mês do pontual), com o IPCA do exercício mostrado quando marcado; só leitura com o exercício fechado ou sem permissão de alterar.
- [ ] **Step 3:** E2E: o Gestor da DEP (usuário `gestor.dep`, escopo 4.1, já semeado) inclui um pacote mensal num CC da subárvore, vê o anual e as parcelas, altera para pontual, exclui; um CC fora do escopo não aparece. Deixe o banco do teste como encontrou.
- [ ] **Step 4:** verificações completas (inclusive build e E2E de `e2e/orc`, `e2e/adm`, `e2e/aut`, `e2e/seguranca`); commit; PR `Closes #79`, label `migration`.

### Ordem

A Task 2 depende da Task 1 (interfaces do caso de uso). Um implementador faz as duas em sequência na mesma branch; revisão 12.12 por agente independente antes do merge.
