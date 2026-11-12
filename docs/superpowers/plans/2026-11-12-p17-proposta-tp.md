# P17 Proposta de TP: capa, Versão 1 e CC próprio (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-065 (#87): o Orçamentista cria a proposta de TP (capa, categoria, vigência e CC próprio), que nasce com a Versão 1 em Rascunho e vira uma unidade da RLS; lista as propostas dos seus TPs e exclui (lógico) a que ainda está em Rascunho.

**Architecture:**
- **Módulo `orc`, frente A (D-P17-1).** Os UC03.04 a UC03.07 são do módulo funcional CAD (§3.1), mas o backlog aprovado põe o EP11 inteiro na frente A, e o mapa de código (§12.3) dá à frente A o `orc`. A proposta mora em `src/modules/orc/` e `prisma/schema/orc.prisma`. Pede o "de acordo" da frente B na #138.
- **O TP é a unidade (§6.7, C31).** A criação grava, numa transação:
  1. a `unidade` (código = número do TP);
  2. o vínculo do criador em `usuario_unidade`;
  3. a capa `orc_proposta`;
  4. a `orc_versao_proposta` nº 1 em Rascunho;
  5. o Histórico.
- **CC do TP (C37) na `unidade`.** A coluna `unidade.cc` (classificação do CC) tem índice único parcial `WHERE ativo AND cc IS NOT NULL`. A tabela `unidade` é global e sem RLS, então a lista de CCs livres e a regra RN_TP_001 enxergam todos os TPs sem abrir dado de TP.
- **RLS nas tabelas novas.** As duas tabelas novas têm `unidade_id NOT NULL` e a política padrão da migration `202611041400`. Depois de criar a unidade, a transação refaz o `app.unidades` com a nova incluída, e só então grava a capa.
- **Uma migration**, sem mexer em tabela da frente B.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL 16 (RLS), Zod 4, Vitest + Testcontainers, Playwright. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` 1.7:
- §5 (tabelas de TP com `unidade_id` e RLS);
- §6.1 e C37 (CC próprio por TP);
- §6.2 (capa, valor global calculado, ciclo de vida, edição só em Rascunho/Em Elaboração);
- §6.7 (cada TP é uma unidade);
- §11.3 (o Orçamentista escreve; GFIN, Auditor e DIREX leem);
- §12.7 (relação com a frente B por id/classificação, sem FK).

**Fonte:** `especificacao/` (Cadastros V5):
- UC 3.04 Manter, 3.05 Cadastrar, 3.06 Alterar e 3.07 Excluir Proposta;
- RN_PROP_002/004/005/006, RNF_CAD_REQ_002/004, RN_MAN_002/006;
- Catálogo: RF_TP_001, RN_TP_001/002/003/005/006.

## Global Constraints

- Português do Brasil; marca neutra; dinheiro só em `Dinheiro`.
- Toda página e ação passam pela guarda, com escopo e permissão conferidos no servidor.
- Toda escrita grava o Histórico na mesma transação. Não sobra capa órfã (RNF_CAD_REQ_002).
- As tabelas com `unidade_id` têm RLS. O teste `tests/integracao/rls-unidade.int.test.ts` reprova se faltar.
- Nada grava em tabela da frente B. O CC é lido pelo C1 (`carregarIndiceEstrutura`, `centrosCustoAnaliticosSob`).
- Testes pesados com `npm run test:int`/`test:e2e` (com `flock`), um por vez. O E2E precisa de `npm run build` antes.

## Decisões deste plano (recomendação; o PO autorizou seguir as recomendações; [PROVISÓRIO] onde marcado)

- **D-P17-1 (módulo):** proposta no `orc`, frente A (acima).
- **D-P17-2 (unidade):**
  - a proposta **cria** a unidade (§6.7);
  - `unidade.codigo` = **número do TP**, digitado, obrigatório, único e imutável (RN_TP_001: "número de contrato");
  - `unidade.nome` = objeto, cortado em 120.
- **D-P17-3 (vínculo do criador):** quem cria entra em `usuario_unidade` do TP novo, na mesma transação e com o Histórico. Sem o vínculo, a RLS esconderia a proposta de quem acabou de criá-la. Os demais vínculos continuam pela tela de usuários (US-031).
- **D-P17-4 (campos da capa):**
  - **Obrigatórios:** Tipo (`CONTRATO` | `TERMO_PARCERIA`), Número do TP, Nome/Objeto (até 500), Data de início, Data de término, Categoria (`CONSOLIDADA` | `META`) e CC.
  - **Opcional:** Parceiro/Cliente (até 200) **[PROVISÓRIO]**.
  - **Valor Global:** sem campo. É **calculado** (§6.2, RN_TP_003) e mostrado como `0,00` até existirem lançamentos (R4 seguinte).
- **D-P17-5 (vigência):** término **pelo menos 30 dias depois** do início (RN_TP_002, a regra mais estrita das duas). Mensagem da E2 do UC 3.05 ajustada **[PROVISÓRIO]**.
- **D-P17-6 (status):** sempre nasce em **Rascunho**, Versão 1, com data e hora do servidor (RN_PROP_002 e §6.2). O "Em Elaboração" da RN_PROP_006 fica para o avançar (UC03.10). "Arquivado" fica fora (não está na §6.2).
- **D-P17-7 (CC):**
  - Lista: os CCs analíticos ativos sob a **raiz de TPs**, menos os de `unidade` ativa.
  - A raiz vem da constante `RAIZ_CC_TP = '9'` no `orc` **[PROVISÓRIO]**, até a DIREX/GFIN fixarem a raiz na minuta (C37). Se a frente B oferecer um marcador no cadastro de CCs, a constante sai.
  - A unicidade é garantida pelo índice único parcial. Na corrida, quem perde recebe `CC_DE_OUTRO_TP`.
- **D-P17-8 (escopo da US):**
  - **Entra:** listar (UC 3.04: as propostas dos TPs do usuário, com o selo da situação), cadastrar (UC 3.05) e excluir lógico em Rascunho (UC 3.07: E2 por status; a E1, vínculos, ainda não tem o que bloquear).
  - **Alterar (UC 3.06):** a capa é somente leitura por regra (RF_ALT_REQ_002), então não há tela de alteração.
  - **Fica fora:** clonar o plano de contas (RF_TP_002), equipe e papéis (RF_TP_003) e o encerramento automático (RN_MAN_005).
- **D-P17-9 (permissões):**
  - funcionalidade nova `orc.propostas` (`consultar`, `incluir`, `excluir`), rota `/orc/propostas`;
  - perfis padrão: ORCAMENTISTA com as três; GFIN, AUDITOR e DIREX só `consultar`;
  - quem consulta vê só as propostas dos TPs a que está vinculado (RLS, US-007). A visão de todos os TPs é a US-101.
- **D-P17-10 (exclusão):** a exclusão lógica (RN_MAN_006 e RN_TP_006) marca a capa como excluída, inativa a unidade (libera o CC) e mantém o número ocupado (`unidade.codigo` é único). Os vínculos de usuário ficam (histórico).

## Review Focus

1. **Dois Orçamentistas escolhem o mesmo CC ao mesmo tempo.** Um grava; o outro recebe `CC_DE_OUTRO_TP`, sem unidade nem capa órfã.
2. **Número do TP repetido**, inclusive o de uma proposta excluída. É recusado com mensagem, sem erro 500.
3. **RLS:** um usuário sem vínculo com o TP não vê a proposta (lista vazia) e não consegue excluí-la pelo id (resposta de inexistente).
4. **Falha no meio da criação**, por exemplo o Histórico indisponível: nada fica gravado (nem unidade, nem vínculo, nem capa).
5. **CC fora da raiz de TPs, sintético ou inativo**, mandado à mão: é recusado.

---

### Task 1: Modelo, migration e casos de uso (criar, listar, excluir)

**Files:**
- Modify: `prisma/schema/nucleo.prisma` (`Unidade.cc String?`), `prisma/schema/orc.prisma` (`PropostaTp`, `VersaoProposta`).
- Create:
  - `prisma/migrations/202611122100_orc_proposta/migration.sql`:
    - `unidade.cc` com o índice único parcial;
    - `orc_proposta` e `orc_versao_proposta` com `unidade_id` (FK para `unidade`), RLS e a política padrão;
    - GRANTs: `sgo_app` com INSERT/SELECT; UPDATE só em `excluida_em` e `excluida_por`; UPDATE de `unidade.cc` e INSERT em `unidade` já existentes, conferir;
    - CHECK de `fim >= inicio + 30`.
- Create: `src/modules/orc/domain/proposta.ts` (validação da capa, pura), `src/modules/orc/application/propostas.ts`, `src/modules/orc/application/propostas.int.test.ts`, `src/modules/orc/domain/proposta.test.ts`.
- Modify: `src/modules/orc/domain/mensagens.ts`, `src/modules/orc/infrastructure/seed.ts` (funcionalidade `orc.propostas`).

**Interfaces:**
- Produces:
  - `RAIZ_CC_TP = '9'`;
  - `TIPOS_PROPOSTA = ['CONTRATO', 'TERMO_PARCERIA']` e `CATEGORIAS_PROPOSTA = ['CONSOLIDADA', 'META']`;
  - `validarCapa(bruto): Resultado<CapaValidada>` (domínio, com as mensagens do UC 3.05 E1/E2);
  - `ccsLivresParaTp(ctx, deps?): Promise<readonly { classificacao: string; descricao: string }[]>`;
  - `criarProposta(ctx, bruto, deps?): Promise<Resultado<{ id: string; unidadeId: string; numero: string }>>`;
  - `listarPropostas(ctx, deps?): Promise<readonly PropostaTela[]>`;
  - `excluirProposta(ctx, bruto: { id; versao }, deps?): Promise<Resultado<{ numero: string }>>`.
  - `PropostaTela = { id, numero, tipo, objeto, parceiro, inicio, fim, categoria, cc, situacao: 'RASCUNHO' | …, versaoAtual: number, valorGlobal: Dinheiro, versao: number }`, com `valorGlobal` = `Dinheiro.zero()` até a R4 seguinte.

- [ ] **Step 1: Testes que falham**
  - **Domínio:** campos obrigatórios (E1 com a mensagem completa), vigência com menos de 30 dias (E2), tipo e categoria fora do domínio, número com espaços cortado, objeto acima de 500.
  - **`ccsLivresParaTp`:**
    - com o falso do C1 com `9`, `9.1`, `9.2` e `9.3` (`9.3` inativo) e uma proposta ativa em `9.1`, devolve só `9.2`;
    - depois da exclusão dessa proposta, devolve `9.1` e `9.2`.
  - **`criarProposta`:**
    - grava a unidade (código, nome e CC), o vínculo do criador, a capa e a versão 1 Rascunho, além de um `INSERCAO` em `orc.propostas` com a capa no `depois`;
    - número repetido gera `NUMERO_DUPLICADO`;
    - CC de outro TP ativo gera `CC_DE_OUTRO_TP`;
    - CC `4.3.0` (fora da raiz), `9` (sintético) e `9.3` (inativo) geram `CC_INVALIDO_TP`;
    - com o Histórico falhando (mock), nada fica gravado;
    - quem não tem `orc.propostas:incluir` recebe `ErroPermissao`.
  - **`listarPropostas`:** o criador vê a proposta; outro usuário sem vínculo vê lista vazia (RLS real, `app` como `sgo_app`).
  - **`excluirProposta`:**
    - em Rascunho, marca excluída, inativa a unidade e grava `EXCLUSAO`;
    - versão diferente gera `ALTERADO_POR_OUTRO`;
    - usuário sem vínculo gera inexistente;
    - proposta excluída some da lista.
  - **Corrida:** duas criações com o mesmo CC em paralelo (`Promise.all`) resultam em uma `ok` e uma `CC_DE_OUTRO_TP`.
- [ ] **Step 2:** rodar `npm run test:int -- src/modules/orc/application/propostas.int.test.ts` e `npx vitest run --project unidade src/modules/orc/domain/proposta.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** a migration, o schema, o domínio, os casos de uso e a seed. A violação de índice único (`P2002`/23505) vira `NUMERO_DUPLICADO` ou `CC_DE_OUTRO_TP` pelo nome do índice.
- [ ] **Step 4:** rodar os testes do Step 2 e o `rls-unidade.int.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit.

### Task 2: Tela, ações, menu e E2E

**Files:**
- Create: `src/app/(sistema)/orc/propostas/page.tsx`, `src/modules/orc/ui/tela-propostas.tsx`, `src/modules/orc/ui/form-proposta.tsx`, `src/modules/orc/application/acoes-propostas.ts`, `src/modules/orc/ui/paginas-propostas.test.ts`, `e2e/orc/propostas.spec.ts`.
- Modify: `src/modules/orc/index.ts`.

**Interfaces:** consome a Task 1. Produz `criarPropostaAcao` (guarda `orc.propostas:incluir`) e `excluirPropostaAcao` (guarda `:excluir`), que voltam a `/orc/propostas?aviso=…`.

- [ ] **Step 1: Testes de página**
  - O Orçamentista vê a lista (número, tipo, objeto, categoria, vigência, CC, selo "Rascunho" e valor global `0,00`) e o formulário "Nova proposta", com o seletor de CC só com os livres.
  - Sem CC livre aparece o aviso `SEM_CC_LIVRE_TP` **[PROVISÓRIO]**, sem formulário.
  - O Auditor vê a lista sem formulário nem "Excluir".
  - Sem `consultar`, a página dá 404.
- [ ] **Step 2: Implementar.**
  - Formulário com os campos da D-P17-4. O valor global aparece só leitura (`0,00`).
  - "Excluir" só em Rascunho, com `AcaoConfirmada` e a pergunta do UC 3.07.
- [ ] **Step 3: E2E.**
  - Depende da estrutura sintética `9.x` na seed de referência da frente B (pedida na #138). Até ela entrar, o spec fica com `test.fixme` e o motivo.
  - Roteiro: o Orçamentista cria a proposta com o CC `9.1`; a proposta aparece em Rascunho; o seletor de unidade passa a listar o TP; a proposta é excluída e o CC volta a ficar livre.
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm test`, `npm run test:int`, `npm run build` e `npm run test:e2e`. Esperado: verde.
- [ ] **Step 5:** commit, PR (`Closes #87`, label `frente:A`, migration), revisão 12.12 independente, aviso na #138 e merge com o CI verde.
