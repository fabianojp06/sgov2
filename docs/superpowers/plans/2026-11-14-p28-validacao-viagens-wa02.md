# P28 Validação das viagens (WA02) (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-081 (#103). O Operador de Viagens (SCOR/GAD) pede a validação das viagens da proposta oficializada, o **[Solicitar Validação]** (UC6.02).
- **Pendente de Validação:** as linhas enviadas ficam travadas (RN_WA02_002).
- **Validação (GFIN ou delegado, na Central de Tarefas da US-078):** as viagens passam a entrar no cronograma de desembolso (passo 4, RN_WA02_004).
- **Rejeição:** devolve as linhas, com a justificativa, para nova submissão (FA-A).

**Architecture:**
- **Tabela:** `orc_lote_viagem`, com a situação `EM_VALIDACAO|VALIDADO|REJEITADO`, RLS e `versao`; `orc_viagem.lote_viagem_id` (nulo: Pendente). A situação da linha é a do lote dela.
- **Casos de uso:**
  - `solicitarValidacaoViagens` e `validadoresDasViagens` (o modal mostra o titular e o substituto) em `application/lote-viagem.ts`;
  - o `manipuladorWa02` para a Central de Tarefas.
- **Cronograma (US-075):** as viagens entram só com o lote Validado. Antes disso, a tela avisa.
- **Totalizadores e Valor Global:** continuam com as viagens, como o pessoal na D-P27-4.

**Tech Stack:** o mesmo do P27. Uma migration.

**Spec e fontes:**
- Aprovações V2, UC6.02: RF_VAL_REQ_001 a 004, RNF_VAL_REQ_001 a 003, RN_WA02_001 a 007, E1 a E4 e FA-A.
- Spec: §11.3 (o Operador de Viagens solicita o WA02; o GFIN aprova quando titular), C15 (viagens são aba da proposta; a validação é o WA02) e C16.

## Decisões

- **D-P28-1 (escopo):**
  - **Entra:** solicitar, validar e rejeitar; a trava das linhas enviadas; o cronograma condicionado à validação.
  - **Fica fora, com o motivo:**
    - **Campos do E1** (trechos, período de diária, local de hospedagem, empregado vinculado): não existem no modelo das viagens (Viagens V3). Os obrigatórios do modelo já são exigidos na gravação, então o E1 não tem o que barrar.
    - **Notificação ao operador (FA-A):** a Central de Tarefas mostra a decisão. O e-mail fica como no P26.
    - **Expurgo dos relatórios macro (RN_WA02_007):** o consolidado e a execução orçamentária são da R6. Lá, só as viagens validadas entram.
- **D-P28-2 (quando) [PROVISÓRIO]:** o pedido cabe com a última versão **Oficializada**, a pré-condição do UC6.02.
  - **Rejeição:** como a versão oficial é imutável (RN_WA01_004), "grids reabilitadas para escrita" vira "as linhas voltam a poder ser enviadas". Para corrigir uma viagem, usa-se o Termo Aditivo (US-082): a proposta Oficializada não ganha nova versão (D-P18).
- **D-P28-3 (quais linhas) [PROVISÓRIO]:** todas as viagens da versão que estão Pendentes ou Rejeitadas vão num lote só. A seleção linha a linha do passo 1 fica para quando houver pedido.
- **D-P28-4 (quem):**
  - **Permissão:** a ação `executar` nova em `orc.viagens`, só para o OPERADOR_VIAGENS (RF_VAL_REQ_001).
  - **Modal:** mostra o titular e o substituto do WA02, pelo `resolverAprovador`. Sem aprovador (E2) ou com o próprio operador roteado (E4, RN_WA02_006), mostra o motivo no lugar do botão.
- **D-P28-5 (solicitar):** a varredura junta as falhas.
  - **Falhas possíveis:**
    - versão não Oficializada;
    - nenhuma linha Pendente ou Rejeitada;
    - lote em validação;
    - sem aprovador (E2);
    - mesmo usuário (E4).
  - **Sem falha:** o lote é criado Em Validação, as linhas são ligadas a ele, a solicitação WA02 é roteada e o Histórico registra o pedido.
  - **Concorrência:** a capa sobe, e o segundo pedido recebe o E3 do P26.
- **D-P28-6 (decisão):**
  - **Validar:** o lote vai a Validado e o Histórico registra `HOMOLOGACAO_VIAGENS`.
  - **Rejeitar:** o lote vai a Rejeitado, com a justificativa. As linhas ficam Rejeitadas até o próximo pedido.
  - **Resumo na Central:** a quantidade de viagens e o custo por conta.
- **D-P28-7 (nova versão):** não se aplica: a nova versão só sai de versão em Rascunho ou Em Elaboração, que nunca têm lote. A cópia das viagens não leva o lote.
- **D-P28-8 (selos, RF_VAL_REQ_003):** a grade das viagens mostra o selo da linha: Pendente, Pendente de Validação (amarelo), Validada (verde) ou Rejeitada (vermelho).

## Review Focus

1. **Cronograma antes e depois da validação:** sem as viagens e com elas. Teste no int.
2. **Pedido fora da versão Oficializada, ou sem linha Pendente:** recusado. Teste no int.
3. **Rejeitar e pedir de novo:** o novo lote leva as linhas rejeitadas. Teste no int.
4. **Operador como titular do WA02:** o botão dá lugar ao motivo, e o pedido é recusado (RN_WA02_006). Teste no int e na página.
5. **Orçamentista sem a ação `executar`:** não pede. Teste no int e na página.

---

### Task 1: Lote, pedido e manipulador

- [ ] Migration `202611141200_orc_lote_viagem`, schema, mensagens, caso de uso, a condição no `cronograma.ts`, o seed (a ação `executar` em `orc.viagens` para o OPERADOR_VIAGENS) e os snapshots. Testes de domínio e de integração, com os 5 do Review Focus.

### Task 2: Tela e E2E

- [ ] O botão e o modal na tela de viagens; os selos das linhas; o manipulador na Central; o teste de página.
- [ ] E2E: depois da oficialização do passo 3i, o operador pede; o GFIN valida; o cronograma passa a ter as viagens.
- [ ] PR com `Closes #103` e o comentário 12.12.
