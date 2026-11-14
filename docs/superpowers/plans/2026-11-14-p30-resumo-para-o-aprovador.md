# P30 Resumo para o aprovador: o que mudou desde a versão anterior (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a parte determinística da US-084 (#106, IA-13). Na Central de Tarefas, a solicitação WA01 passa a mostrar o que mudou em relação à versão anterior da proposta, com o impacto no total, no teto e no rateio e os pontos de atenção.

**Architecture:**
- **Domínio:** `domain/comparacao.ts`, com `compararVersoes(atual, anterior)`. É uma função pura: as diferenças por conta, as contas novas e as retiradas, a variação do total, do rateio e dos tetos, e os pontos de atenção.
- **Base da comparação:** a versão de número anterior da mesma proposta. Se ela tem o snapshot da oficialização, os valores vêm dele (imutáveis); senão, são calculados na hora, como os totalizadores.
- **Saída:** o resumo do `manipuladorWa01` ganha os itens da comparação, depois dos que já existem.
- **Sem tabela.**

**Spec e fontes:**
- **Spec §6.8, IA-13:** "mostra o que mudou em relação à versão anterior (diferença entre snapshots), o impacto no total, no teto e no rateio, e os pontos de atenção".
- **Backlog:** "diferença entre snapshots calculada pelo sistema".

## Decisões

- **D-P30-1 (escopo):**
  - **Task 1:** a parte determinística.
  - **Task 2:** a ajuda de IA para redigir a recusa. O GAP-IA-001 foi liberado pelo PO em 11/11 (P14), e a infraestrutura de IA é a da US-019.
- **D-P30-2 (base) [PROVISÓRIO]:** a "versão anterior" é a de número imediatamente anterior. Na primeira versão, o resumo diz "Primeira versão: sem comparação".
- **D-P30-3 (teto e rateio) [PROVISÓRIO]:** a proposta não tem teto global no modelo. O "teto" é a soma dos tetos de viagens por conta sintética (US-071); o "rateio" é a soma das células do Rateio/ISS (US-073).
- **D-P30-4 (pontos de atenção) [PROVISÓRIO]:**
  - conta nova;
  - conta retirada;
  - conta que variou mais de 20%;
  - Valor Global que variou mais de 10%.

  As faixas são constantes do domínio, até a GFIN definir outras.
- **D-P30-5 (sigilo):** o resumo do WA01 já leva o pessoal, porque o aprovador homologa o custo (D-P26). A comparação segue a mesma regra.

## Review Focus

1. **Primeira versão:** sem comparação, sem erro. Teste no int.
2. **Versão anterior oficializada:** usa o snapshot, mesmo que os parâmetros tenham mudado depois. Teste no int.
3. **Conta nova, retirada e alterada:** cada uma no seu item, em ordem de conta. Teste de domínio.
4. **Valor zero na anterior:** a variação percentual não divide por zero ("conta nova"). Teste de domínio.
5. **Arredondamento:** as diferenças em Dinheiro, sem `number`. Teste de domínio.

---

- **D-P30-6 (IA na recusa) [PROVISÓRIO]:**
  - **Caso:** `orc.ia_recusa`, declarado em `ia-casos.ts` e instalado inativo e com teto zero, como os do P14. A funcionalidade fica fora do menu, só com `executar`, para GFIN e DIREX (os aprovadores do WA01).
  - **Mensagem (minimização, §4.4):** só a descrição da solicitação, os itens do resumo (os mesmos que o aprovador vê) e o rascunho digitado, entre as marcas. Nunca nomes de pessoas.
  - **Resposta:** um texto de 15 a 1000 caracteres e até 5 pontos.
  - **IA sugere, não grava:** "Usar este texto" só preenche o campo, que continua editável. Se o texto usado não for alterado, a rejeição vai ao Histórico com `origem = SUGESTAO_IA`.
  - **Onde aparece:** só no WA01 pendente, para quem decide e tem a permissão do caso. O `apr` recebe a ajuda como um elemento pronto da página, porque não importa o `orc`.

### Task 1: Comparação e resumo

- [ ] `compararVersoes` com os testes de domínio (Review Focus 3, 4 e 5); o resumo do WA01 com o teste de integração (1 e 2).
- [ ] PR com `Refs #106` e o comentário 12.12.

### Task 2: Ajuda da IA para redigir a recusa

- [ ] O caso `orc.ia_recusa`, `sugerirRecusa` com teste de integração (com o provedor falso: a mensagem sem nomes, só no WA01 pendente, a permissão), a marca `sugestaoIa` na decisão do apr e o componente da ajuda na Central, com teste de página.
- [ ] PR com `Closes #106` e o comentário 12.12.
