# P19 Metas da proposta de TP (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-067 (#89): o orçamentista cadastra, altera, inativa e exclui as **metas** de uma versão da proposta, para que as despesas (headcount, viagens) apontem para a entrega física (RN_VIA_04).

**Architecture:**
- **Onde:** no `orc`, sobre a US-065 e a US-066 (P17, P18): tabela nova `orc_meta`, ligada à **versão** da proposta (`orc_versao_proposta`), com RLS por unidade; caso de uso `metas.ts`; domínio `domain/meta.ts`; tela `/orc/metas` (Cadastros › Metas) e o link "Metas" na tela de propostas.
- **Concorrência:** como no P18, toda operação sobre as metas começa subindo a `versao` da capa (`updateMany` condicional + `exigirUmaLinha`). A regra do `copiarLinhasDaVersao` (revisão 12.12 do #445) passa a valer aqui pela primeira vez.
- **Cópia:** o `copiarLinhasDaVersao` (vazio desde o P18) passa a copiar as metas (RN_DUP_003): na nova versão e na duplicação, as metas da versão de origem nascem na de destino, com ids novos.

**Tech Stack:** o mesmo do P17. Sem dependência nova. Uma migration.

**Spec e fontes:**
- **Spec 1.7:** §6.2 (Valor Global sempre calculado; edição só em Rascunho/Em Elaboração, RN_ALT_002); §6.4 (headcount por Proposta/Versão/Meta); §6.7 (o TP é a unidade).
- **`especificacao/` (Cadastros V5 e Catálogo):** UC03.14 a UC03.17 (Manter, Cadastrar, Alterar e Excluir Meta), RN0106, RN0135 a RN0143, RN0149, RN0150, RN0183, RN0232, REQ0024, REQ0030, REQ0126 a REQ0128; RN_DUP_003; RN_VIA_04 (Viagens V3, com o conflito condicional × incondicional registrado no Catálogo).
- **Planos de origem:** P17 (D-P17-1 a 10) e P18 (D-P18-1 a 9).

## Global Constraints

As do P17 e do P18 valem todas:
- RLS por unidade;
- o Histórico na mesma transação (RN0232), sem nada órfão;
- nada gravado na frente B;
- dinheiro em `NUMERIC(15,2)` com `Dinheiro` (nunca `number`);
- testes pesados com `flock`, um por vez; build antes do E2E.

## Decisões deste plano (recomendação; o PO autorizou seguir as recomendações; [PROVISÓRIO] onde marcado)

- **D-P19-1 (a meta é da versão):** a meta pertence a uma `VersaoProposta` (UC03.14: "integrada ao painel de revisões"; §6.4: headcount por Proposta/Versão/Meta). Cada versão tem as suas; a nova versão e a duplicação copiam as da origem (RN_DUP_003). A tela mostra e edita as metas da **última versão** de cada proposta.
- **D-P19-2 (só na categoria Meta):** metas só existem em proposta de categoria `META` (pré-condição do UC03.14). Na `CONSOLIDADA`, a tela diz que a proposta não opera por metas, e o caso de uso recusa.
- **D-P19-3 (campos):**
  - **Número** (texto, 1 a 20, único na versão sem diferença de maiúsculas; imutável depois de criado, UC03.16 passo 4);
  - **Nome** (1 a 200, obrigatório na inclusão e na alteração: o Catálogo marca o conflito REQ0128 × UC03.15, e fica a regra mais estrita);
  - **Valor global** (`Dinheiro`, ≥ 0,00, obrigatório);
  - **Status** (`ATIVO`/`INATIVO`, RN0106; nasce `ATIVO`);
  - **Observação** (opcional, até 1000).
  - **Tipo e Proposta** não são colunas da meta: vêm da proposta mandante e aparecem só leitura (ORIGEM BLINDADA, RN0140) [PROVISÓRIO: o "Tipo" da meta não tem domínio na especificação; lido como o tipo da proposta].
- **D-P19-4 (teto e saldo) [PROVISÓRIO, pergunta ao PO]:** a capa não tem campo de teto (§6.2: o Valor Global é sempre calculado). A tela mostra o **total das metas** (RN0149, soma das ativas) e o **saldo a distribuir** = Valor Global calculado − total das metas (RN0142). A trava rígida (RN0138/RN0150: soma das metas igual ao Valor Global) vai para o **envio** (US-079), como a C6 faz com o teto das viagens. Motivo: o Valor Global só cresce com os lançamentos, e os lançamentos exigem meta (RN_VIA_04, §6.4). Travar a cada meta salva criaria um impasse: não dá para lançar sem meta nem criar meta sem lançamento.
- **D-P19-5 (ciclo de vida):** incluir, alterar e excluir só com a versão em Rascunho ou Em Elaboração (RN0183, RN_ALT_002); fora disso, a mensagem do E2 do UC03.14.
- **D-P19-6 (exclusão física):** a exclusão apaga a linha (UC03.17), na mesma situação da D-P19-5. A RN0136 (sem headcount, viagem ou rateio ligado) vira FK `ON DELETE RESTRICT` nas tabelas das US-070 a 073. Nesta história ainda não há ligação, e o caso de uso já trata a violação de FK (23503) com a mensagem do E1 do UC03.17. A inativação (Status `INATIVO`) é a saída quando a meta já tem lançamentos.
- **D-P19-7 (RN_VIA_04) [PROVISÓRIO até o GAP-VIA-001]:** a meta é obrigatória nas despesas da proposta de categoria `META`. Na `CONSOLIDADA`, que não tem metas (D-P19-2), a exigência incondicional travaria toda viagem. Fica a leitura condicional do UC03.29/31, contra a incondicional do UC03.30. Esta história entrega:
  - a regra de domínio `metaExigida(categoria)`;
  - a lista `metasParaLancamento(versaoId)`, só das ativas;
  - os testes das duas.

  A trava na gravação da viagem é da US-071, e a do headcount é da US-070.
- **D-P19-8 (permissões):** funcionalidade nova `orc.metas` (Cadastros › Metas), com a mesma matriz de `orc.propostas`: ORCAMENTISTA com todas as ações; GFIN, AUDITOR e DIREX só consultar.
- **D-P19-9 (fora):** imprimir e exportar do modal (UC03.16 A2/A3, transversais da frente B); a pesquisa por Tipo fica como filtro da lista (REQ0024, REQ0030), sem relatório próprio (REQ0129, US-077).

## Review Focus

1. **Duas abas salvando metas da mesma versão:** a segunda recebe "alterado por outro" e nada fica gravado. Teste de corrida na Task 1.
2. **Número repetido com caixa diferente (M1 × m1) na mesma versão:** recusado com a mensagem do número. O mesmo número em outra versão ou proposta é aceito. Índice único de expressão + teste.
3. **Meta de proposta de outra unidade (id adivinhado):** a resposta é "inexistente", sem vazar nada (RLS). Teste de RLS na integração.
4. **Nova versão e duplicação com metas:** as metas vêm copiadas com ids novos, e mexer na cópia não muda a origem. Teste na Task 1.
5. **Valor com vírgula e milhar ("1.234,56"), negativo ou com 3 casas:** aceito na forma da tela; recusado se negativo ou com mais de 2 casas. Teste de domínio.

---

### Task 1: Migration, domínio e casos de uso

**Files:**
- Create: `prisma/migrations/202611131200_orc_meta/migration.sql`
- Modify: `prisma/schema/orc.prisma` (model `MetaProposta`, `@@map("orc_meta")`; relação em `VersaoProposta`)
- Create: `src/modules/orc/domain/meta.ts`, `src/modules/orc/domain/meta.test.ts`
- Create: `src/modules/orc/application/metas.ts`, `tests/integracao/orc/metas.int.test.ts`
- Modify: `src/modules/orc/application/propostas.ts` (`copiarLinhasDaVersao` copia as metas), `src/modules/orc/domain/mensagens.ts`, `prisma/seed.ts` (funcionalidade `orc.metas`)

**Interfaces:**
- Produces:
  - `validarMeta(bruto, modo: 'incluir' | 'alterar'): Resultado<MetaValidada>`, com `MetaValidada = { numero: string; nome: string; valor: Dinheiro; status: StatusMeta; observacao: string | null }` (no modo `alterar`, sem `numero`);
  - `metaExigida(categoria: CategoriaProposta): boolean`;
  - `listarMetas(ctx, filtros: { tipo?; proposta?; meta? }, deps?) → readonly BlocoMetas[]`, com `BlocoMetas = { propostaId; numero; objeto; tipo; categoria; versaoId; versaoNumero; situacao; editavel; versaoCapa: number; valorGlobal: Dinheiro; totalMetas: Dinheiro; saldo: Dinheiro; metas: readonly MetaTela[] }`;
  - `incluirMeta(ctx, bruto) / alterarMeta(ctx, bruto) / excluirMeta(ctx, bruto) → Resultado<{ numero: string }>`. O `bruto` traz `versaoCapa`, e no alterar e no excluir também `id` e `versao` da meta;
  - `metasParaLancamento(ctx, versaoId) → readonly { id; numero; nome }[]`.

- [ ] **Step 1: Testes de domínio.**
  - `validarMeta` recusa vazio em número, nome, valor e status (mensagem geral + campo);
  - recusa número > 20, nome > 200, observação > 1000, status fora de ATIVO/INATIVO, valor negativo e valor com 3 casas;
  - aceita "1.234,56";
  - `metaExigida('META') === true`, `metaExigida('CONSOLIDADA') === false`.
- [ ] **Step 2: Implementar `domain/meta.ts`** (padrão do `domain/proposta.ts`: `OBRIGATORIOS`, `ErroCampo`, limites espelhando os CHECKs) e rodar `npm test -- meta`. Esperado: PASS.
- [ ] **Step 3: Migration.**
  - **Tabela** `orc_meta` (`id`, `unidade_id`, `versao_proposta_id` FK RESTRICT, `numero`, `nome`, `valor NUMERIC(15,2) CHECK >= 0`, `status CHECK IN ('ATIVO','INATIVO')`, `observacao`, `criado_por`, `criado_em`, `versao`).
  - **Índices:** único `(versao_proposta_id, upper(numero))`; índice em `unidade_id`.
  - **Integridade:** trigger de mesma unidade da versão (no padrão de `orc_versao_proposta_mesma_unidade`).
  - **RLS:** a política padrão.
  - **Privilégios:** `REVOKE ALL FROM sgo_sync`. O `sgo_app` faz INSERT, SELECT e DELETE, e UPDATE só em `nome`, `valor`, `status`, `observacao` e `versao`.
  - **Schema:** o model no `orc.prisma`, depois `npx prisma generate`.
- [ ] **Step 4: Testes de integração** (`metas.int.test.ts`, no padrão de `propostas.int.test.ts`):
  - **Inclusão:** incluir em Rascunho grava a meta e o Histórico (INSERCAO, com o retrato).
  - **Recusas:**
    - proposta CONSOLIDADA (D-P19-2);
    - versão Em Aprovação (D-P19-5);
    - número repetido com outra caixa;
    - `versaoCapa` antiga (ALTERADO_POR_OUTRO).
  - **Alteração:** muda nome, valor, status e observação, e o Histórico guarda antes e depois. O número enviado é recusado como campo blindado.
  - **Exclusão:** apaga a meta, e o Histórico guarda o antes.
  - **Corrida:** duas inclusões com o mesmo `versaoCapa` em paralelo: uma passa, a outra recebe ALTERADO_POR_OUTRO.
  - **RLS:** um usuário sem a unidade não vê nem altera (inexistente).
  - **Cópia:** `novaVersaoProposta` e `duplicarProposta` copiam as metas com ids novos. Alterar a cópia não muda a origem.
  - **Totais:** `listarMetas` agrupa por proposta (RN0137), filtra por parte do texto (REQ0030) e soma só as ativas.
  - **Lista para lançamento:** `metasParaLancamento` traz só as ativas.
- [ ] **Step 5: Implementar `metas.ts` e o `copiarLinhasDaVersao`.**
  - Seguir o `novaVersaoProposta`: `emUnidade`; leitura da proposta com a última versão; conferência da `versao` da capa; trava com `updateMany`; `auditar` com a funcionalidade `orc.metas`.
  - O retrato da meta vai ao Histórico com `numeroTp` e `versao`.
  - `recusarCamposBlindados` recusa o `numero` no alterar.
  - A violação de unicidade (P2002/23505) vira a mensagem do número. A de FK (23503) vira o E1 do UC03.17.
- [ ] **Step 6: Seed.** `orc.metas` com a matriz da D-P19-8, no padrão de `orc.propostas`.
- [ ] **Step 7: Rodar.** `npm run typecheck`, `npm run lint`, `npm test` e `npm run test:int`. Esperado: tudo verde.
- [ ] **Step 8: Commit.**

### Task 2: Tela

**Files:**
- Create: `src/modules/orc/ui/tela-metas.tsx`, `src/modules/orc/ui/form-meta.tsx`, `src/modules/orc/ui/acoes-metas.ts`, `src/app/(sistema)/orc/metas/page.tsx`
- Modify: `src/modules/orc/ui/tela-propostas.tsx` (link "Metas da proposta N" quando a categoria é Meta), `src/modules/orc/ui/paginas-propostas.test.ts` (ou `paginas-metas.test.ts`), `e2e/orc/propostas.spec.ts`

**Interfaces:**
- Consumes: a Task 1 inteira.

- [ ] **Step 1: Testes da tela** (renderização, no padrão de `paginas-propostas.test.ts`):
  - **Lista:** blocos por proposta, com Número e Objeto no cabeçalho (RN0137) e as colunas Número, Nome, Valor global e Status (RN0135).
  - **Totais:** total das metas e saldo a distribuir (RN0142).
  - **Ações:**
    - "Nova meta", "Editar" e "Excluir" só com permissão e versão editável;
    - sem ações em Em Aprovação;
    - na proposta Consolidada, a nota "Esta proposta não opera por metas".
  - **Filtros:** Tipo, Proposta e Meta (REQ0024).
  - **Formulários:** Proposta e Tipo só leitura (RN0140). No editar, o Número também é só leitura.
- [ ] **Step 2: Implementar.**
  - **Página:** `/orc/metas` com `searchParams` `tipo`, `proposta`, `meta`, `nova=<propostaId>` e `editar=<metaId>`.
  - **Ações:** `acoes-metas.ts` no padrão de `acoes-propostas.ts`, com `definirAcao` e o redirect com aviso.
  - **Exclusão:** `AcaoConfirmada` com a pergunta do UC03.17.
  - Rodar `npm test`. Esperado: PASS.
- [ ] **Step 3: E2E.** No `propostas.spec.ts`, num passo novo:
  1. o orçamentista abre as metas da proposta de categoria Meta;
  2. inclui M1 com R$ 1.234,56;
  3. vê o total;
  4. altera o nome;
  5. cria uma nova versão e vê M1 nela;
  6. exclui M1 da versão nova.

  Rodar `flock -w 1800 /tmp/sgo-processo-pesado.lock npm run build` e depois `npm run test:e2e`. Esperado: verde.
- [ ] **Step 4: Commit, PR com `Closes #89`, revisão 12.12 e merge.**
