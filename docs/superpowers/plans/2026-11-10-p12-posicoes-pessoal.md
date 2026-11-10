# P12 Posições de pessoal pela tela (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Gestor de Diretoria e a GFIN lançam, alteram e excluem **posições de pessoal** do orçamento da Adm. Central pela tela, com prévia do custo (massa, férias + 13º, encargos, benefícios, anual) (US-056, #78). Segue o molde do P11 (pacotes base zero, #362).

**Architecture:**
- **Tudo no `orc` (e na tela do Histórico do `adm`), sem mudança na frente B.** O custo vem do motor único `calcularCustoPosicao` do `cad` (C33), já injetado em `DepsOrc.custoPessoal` e usado por `recalcularExercicio` (`src/modules/orc/application/calculo-linhas.ts`).
- **Uma migration** (spec §12.7): origem `'TELA'` no CHECK de `orc_posicao`, coluna `versao` e GRANT de UPDATE por coluna, como a `202611101500_orc_pacote_tela`.
- A importação da planilha passa a substituir só as posições do CC com `origem <> 'TELA'` (como os pacotes, D-P11-7).

**Tech Stack:** Next.js 16.4.3, React 19.3.1, Prisma 7.10.1, PostgreSQL 16, Zod 4.6.7, Vitest 5.0.5 + Testcontainers, Playwright 1.64.0. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` §6.4 (motor C33), §6.6 (campos, validações e cálculo da posição; interação), §11.3, D10 (salário: mascaramento por perfil), C24, C34 (cargo e salário em texto livre na trilha 2027), C25, R8, GAP-ORC-004 (UC04.17 sem EP: regras e mensagens do `orc` **[PROVISÓRIAS]**).

## Global Constraints

- Português do Brasil; marca neutra; dinheiro em `Decimal`/`NUMERIC(15,2)` com Half-Even, nunca `number`.
- Toda Server Action e toda página passam pela guarda; escopo conferido **no servidor** (R8), inclusive no CC do registro existente ao alterar e excluir.
- Toda escrita grava o Histórico na mesma transação; conflito de versão pelo núcleo (`MENSAGEM_CONFLITO`, `exigirUmaLinha`).
- Toda escrita de posição começa por `travarExercicio` e faz `versao + 1` e `atualizadoEm` no exercício (mesma regra do P11).
- Validações da posição são as da importação (`src/modules/orc/domain/planilha.ts`: cargo 1–120, quantidade 1–9999, salário > 0 e < R$ 1.000.000,00, 1 ≤ início ≤ saída ≤ 12, observação ≤ 500), exportadas e reaproveitadas, como o P11 fez com o pacote.
- Testes pesados com `npm run test:int`/`test:e2e` (com `flock`), um por vez (D12). Só arquivos da frente A.

## Decisões do PO (10/11/2026, pelas recomendações)

- **D-P12-1 (cargo, decisão (a)):** cargo em **texto livre** (C34). A escolha pelo cadastro de C&S, com o salário vindo da Fonte Ativa (C24 e o 1º critério da #78), fica para depois de 30/11, com a tela de correspondência da C34. Por isso o PR usa `Refs #78`, não `Closes`.
- **D-P12-2 (quem lança):** funcionalidade nova `orc.posicoes` ("Posições de pessoal" **[PROVISÓRIO]**): GESTOR_DIRETORIA e GFIN com consultar, incluir, alterar e excluir; DIREX e AUDITOR só consultar. Gestor só na subárvore do seu escopo; GFIN em qualquer CC. Mesmas regras de saída da D-P11-8 (excluir sempre pode; id fora do escopo → "Posição não encontrada." **[PROVISÓRIO]**).
- **D-P12-3 (salário na tela, decisão (b)):** quem tem `orc.posicoes` com incluir ou alterar vê o salário e a prévia em claro; quem só consulta vê o salário como `VALOR_MASCARADO` (`'•••'`, do contrato do `cad`) e só os totais da posição (anual), nunca o salário individual. A máscara é aplicada **no servidor** (`listarPosicoes` não devolve o salário a quem não pode ver).
- **D-P12-4 (Histórico, decisão (c)):** uma entrada por operação (INSERCAO, ALTERACAO, EXCLUSAO) com `antes`/`depois` da posição, **com o salário**. A tela de consulta do Histórico (`src/modules/adm`) mascara `salarioMensal` de `orc.posicoes` para quem não tem incluir/alterar em `orc.posicoes`, por uma função pura `mascararHistoricoOrc` no `orc` (mesmo formato de `mascararHistoricoCad`). Na mesma passada, a tela do Histórico passa a aplicar também `mascararHistoricoCad` (contrato do `cad` já pronto, D-P8-10), com o registro da consulta auditada de `cad.salarios` quando `contemSalario` vier true para quem tem a permissão.
- **D-P12-5 (recálculo):** como a D-P11-2: recalcula só as linhas da posição na mesma transação e avisa "O orçamento foi recalculado."; premissas mudadas → Gestor recusado com a mensagem do P11, GFIN recalcula o exercício inteiro.
- **D-P12-6 (prévia):** calculada **no servidor** por uma Server Action só de leitura (`previaPosicao`, sem gravar e sem Histórico), com o mesmo `deps.custoPessoal.calcularCustoPosicao` e as premissas do exercício, chamada com *debounce* de 400 ms. Assim o motor fica um só e as premissas (encargo, benefícios) não vão para o cliente. A prévia exige incluir ou alterar e respeita o escopo.
- **D-P12-7 (origem blindada e reimportação):** `origem`/`importacaoId` entram em `CAMPOS_ORIGEM_BLINDADA`; posição importada e alterada continua `IMPORTACAO` e é substituída numa reimportação do CC, com o aviso **[PROVISÓRIO]** "Esta posição veio da planilha: uma nova importação deste CC a substitui."; as `TELA` ficam, e o relatório da importação mostra quantas ficaram.

## Review Focus

1. **Salário vazado:** usuário só de consulta (AUDITOR) recebe o salário em `listarPosicoes`, na prévia ou no Histórico → não pode (teste de integração em cada caminho).
2. **Escopo forjado:** Gestor manda id de posição de outra diretoria ou troca o CC para fora do escopo → recusado no servidor.
3. **Exercício fechado:** lançar com o exercício Em Aprovação ou Oficializado → recusado; envio para aprovação com a versão de antes → `ALTERADO_POR_OUTRO`.
4. **Prévia ≠ gravado:** a prévia de uma entrada é igual às linhas gravadas para ela (mesmo motor, mesmas premissas).
5. **Concorrência:** dois salvamentos da mesma posição com a mesma versão → um grava, o outro recebe `MENSAGEM_CONFLITO`.

---

### Task 1: Caso de uso, migration, catálogo e Histórico mascarado (US-056, parte 1)

**Files:**
- Migration: `prisma/migrations/202611101800_orc_posicao_tela/migration.sql`
- Modify: `prisma/schema/orc.prisma`, `src/modules/orc/application/importacao.ts`, `src/modules/orc/domain/planilha.ts`, `src/modules/orc/domain/mensagens.ts`, `src/modules/orc/application/governanca.ts`, `src/modules/orc/infrastructure/seed.ts`, `src/modules/orc/index.ts`, `src/modules/adm/application/historico.ts` (ou a tela/ação que monta as linhas)
- Create: `src/modules/orc/application/posicoes.ts` (`listarPosicoes`, `incluirPosicao`, `alterarPosicao`, `excluirPosicao`, `opcoesPosicao`, `previaPosicao`), `src/modules/orc/application/acoes-posicoes.ts` (`'use server'`), `src/modules/orc/domain/mascara-historico.ts` (`mascararHistoricoOrc`)
- Test: `src/modules/orc/application/posicoes.int.test.ts`, `src/modules/orc/domain/mascara-historico.test.ts`, ajuste em `src/modules/adm/application/historico.int.test.ts`

- [ ] **Step 1:** testes: inclusão grava as linhas iguais às do motor; validações; escopo (Gestor dentro/fora, GFIN); premissas mudadas; exercício fechado; Histórico com salário; conflito de versão; importada alterada continua `IMPORTACAO`; reimportação mantém `TELA`; os itens 1, 4 e 5 do Review Focus.
- [ ] **Step 2:** implementar. Ajustar o teste do menu (`tela-principal.int.test.ts`); a matriz de autorização entra sozinha.
- [ ] **Step 3:** typecheck, lint, unidade, arquitetura, `test:int` de orc/aut/adm; commit.

### Task 2: Tela de posições com prévia (US-056, parte 2)

**Files:**
- Create: `src/modules/orc/ui/tela-posicoes.tsx`, `src/modules/orc/ui/form-posicao.tsx`, `src/app/(sistema)/orc/posicoes/page.tsx`
- Test: unidade da página e do bundle cliente; `e2e/orc/posicoes.spec.ts`

- [ ] **Step 1:** página com `exigirPagina('orc.posicoes', 'consultar')`, no molde de `/orc/pacotes`: exercício, CC (só do escopo), lista (cargo, quantidade, salário ou `•••`, início–saída, anual, origem) com Alterar e Excluir (`AcaoConfirmada`), formulário de inclusão/alteração com linha destacada, erros em lista acima do botão, formulário que mantém o digitado.
- [ ] **Step 2:** prévia ao digitar (D-P12-6): massa, férias + 13º, encargos, benefícios e anual; só leitura com o exercício fechado ou sem permissão.
- [ ] **Step 3:** E2E: `gestor.dep` inclui uma posição num CC da subárvore, vê a prévia, altera, exclui; um usuário só de consulta vê `•••`. Deixar o banco como encontrou.
- [ ] **Step 4:** verificações completas (build e E2E de `e2e/orc`, `e2e/adm`, `e2e/aut`, `e2e/seguranca`); commit; PR `Refs #78`, label `migration`.
