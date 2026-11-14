# P29 Pré-visualização da proposta (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-068 (#90): a pré-visualização da proposta (UC03.38, "Relatório de Pré-Visualização do TP"). É um documento só leitura com todas as seções e os totais da última versão, disponível desde o Rascunho, para revisar antes do envio.

**Architecture:**
- **Caso de uso:** `obterPreVisualizacao(ctx, propostaId)` em `application/pre-visualizacao.ts` compõe o que já existe:
  - a capa e as metas;
  - os quantitativos de pessoal por período (`contarNoPeriodo`, US-070);
  - a árvore de contas com os valores (`totaisDaVersao` e `montarArvore`, US-074).
- **Tela:** `ui/tela-pre-visualizacao.tsx` e a página `/orc/previa?proposta=`; o link sai da lista de propostas.
- **Sem tabela e sem migration.**

**Tech Stack:** o mesmo do P28.

**Spec e fontes:**
- **UC03.38, o "Corpo" do relatório:**
  - Proposta: número, nome, versão, Valor Global, período inicial e final.
  - Meta: nome e valor.
  - Empregados: período e as quantidades por categoria, com as somas.
  - Contas: sintética, analítica, período, valor e fórmula, com a soma das analíticas na sintética, em ordem crescente.
  - Rodapé com o título "Relatório de Pré-Visualização do TP".
- O resto do texto do UC03.38 descreve o demonstrativo de provisões (cópia de outro caso de uso) e não se aplica.

## Decisões

- **D-P29-1 (acesso) [PROVISÓRIO]:** quem consulta a proposta (`orc.propostas:consultar`) pré-visualiza, em qualquer situação, desde o Rascunho. Não há funcionalidade nova no menu: o link fica na linha da proposta.
- **D-P29-2 (sigilo):** o custo do pessoal só aparece para quem lança os empregados (D-P23-5). Para os demais, os valores e o total vêm sem ele, com a nota.
- **D-P29-3 (fórmula) [PROVISÓRIO]:** não há cadastro de fórmulas por conta. A coluna mostra a origem do valor: Pessoal (motor de pessoal), Viagens, Bens ou Rateio/ISS. Uma conta pode ter mais de uma origem.
- **D-P29-4 (período):** o período de cada conta é a vigência da proposta. Os lançamentos não têm período próprio por conta.
- **D-P29-5 (saída):** imprimir pelo navegador (CSS de impressão), sem a barra do sistema. A exportação em PDF/XLSX fica com o padrão de relatórios da frente B (rel), quando existir.

## Review Focus

1. **Quem não vê o pessoal:** nem o valor nem a origem "Pessoal" aparecem. Teste no int.
2. **Proposta de outro TP (RLS) ou id inválido:** página 404. Teste na página.
3. **Soma da sintética:** igual à soma das analíticas, e o total igual ao Valor Global dos totalizadores. Teste no int.
4. **Categoria Consolidada:** sem a seção de metas. Teste na página.
5. **Versão sem lançamentos:** as seções vazias com o texto "Nenhum…", sem erro. Teste no int.

---

### Task 1: Caso de uso, tela e página

- [ ] `obterPreVisualizacao`, a tela, a página e o link na lista. Teste de integração (Review Focus 1, 3 e 5) e de página (2 e 4).
- [ ] E2E: o Orçamentista abre a pré-visualização da cópia e vê as seções e o total.
- [ ] PR com `Closes #90` e o comentário 12.12.
