# P31 Consolidado dos TPs (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-101 (#123): o Consolidado dos TPs (spec §6.7), o único lugar onde aparecem vários TPs juntos (orçado, realizado e %), com uma permissão própria e o acesso registrado no Histórico.

**Architecture:**
- **Caminho de leitura de todos os TPs:** `emTodasAsUnidades(ctx, funcionalidade, fn)` em `src/shared/unidade`, a pendência registrada no `em-unidade.ts`.
  - exige a funcionalidade com `consultar`;
  - abre a transação **somente leitura** (`SET TRANSACTION READ ONLY`) com `app.unidades` igual a todas as unidades ativas de TP (`unidade.cc` não nulo).
  - A RLS continua valendo: o caminho só amplia a lista, e só para quem tem a permissão.
- **Caso de uso:** `obterConsolidado(ctx)` em `application/consolidado.ts`. Grava `CONSULTA` no Histórico, com a quantidade de TPs, na mesma transação. O registro é feito antes de devolver os dados, e uma falha no registro aborta a leitura.
- **Tela:** a página `/orc/consolidado`, no menu Administração Central, como "Consolidado dos TPs", só leitura.
- **Sem tabela.** A funcionalidade nova é `orc.consolidado`, só com `consultar`.

**Spec e fontes:**
- **§6.7:** o menu Administração Central reúne o "Consolidado dos TPs (somente leitura): painel e relatórios que somam todos os TPs, inclusive os que o usuário não opera no dia a dia. É o único lugar onde dados de vários TPs aparecem juntos". O acesso "vira uma permissão auditável".
- **§11.3:** a DIREX tem a leitura do Consolidado dos TPs.
- **Backlog:** "Único lugar com vários TPs juntos"; "Acesso auditado".

## Decisões

- **D-P31-1 (quem) [PROVISÓRIO]:** `orc.consolidado:consultar` para a DIREX (§11.3) e o GFIN, que mantém o orçamento da Adm. Central.
- **D-P31-2 (orçado) [PROVISÓRIO]:**
  - **O orçado de cada TP:** é o Valor Global **oficial**, o do snapshot da última versão oficializada.
  - **TP ainda não oficializado:** aparece com a situação da última versão e sem valor.
  - **Motivo:** o número oficial é o que vale para o portfólio. Também não se calcula o pessoal de proposta em elaboração, o que fere o sigilo da D-P23-5.
- **D-P31-3 (realizado):** zero e o % sem valor até a execução (F5, US-085), como os totalizadores (D-P23-1).
- **D-P31-4 (sem atalho):** a linha não leva às telas do TP. O consolidado não dá acesso ao TP: quem quiser operar precisa estar vinculado a ele.

## Review Focus

1. **Usuário sem vínculo com nenhum TP, mas com a permissão:** vê todos os TPs. Teste no int.
2. **Sem a permissão:** 404, e nenhum dado de TP. Teste no int e na página.
3. **A transação é somente leitura:** uma escrita dentro dela é recusada pelo banco. Teste no int.
4. **Cada consulta grava `CONSULTA` no Histórico.** Teste no int.
5. **TP excluído (exclusão lógica) ou unidade inativa:** fica de fora. Teste no int.

---

### Task 1: Caminho, caso de uso e tela

- [ ] `emTodasAsUnidades` (teste no int), `obterConsolidado` (teste no int com os 5 do Review Focus), o seed (funcionalidade e perfis, com os snapshots), a página e o teste de página.
- [ ] PR com `Closes #123` e o comentário 12.12.
