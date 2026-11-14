# P26 Central de Tarefas e oficialização da proposta (WA01) (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-078 (#100) e a US-079 (#101), em dois PRs.
- **US-078, no módulo `apr`:** a solicitação de aprovação e a **Central de Tarefas** do aprovador (RF_APR_REQ_002), com aprovar e rejeitar. A rejeição exige justificativa de pelo menos 15 caracteres (RN_WA01_006), e o titular não homologa o que submeteu (RN_WA02_006). Inclui também os badges de situação (RF_APR_REQ_005).
- **US-079, no módulo `orc`:**
  - o avanço Rascunho → Em Elaboração (UC03.10, que não tinha história; a memória do P18 o pôs aqui);
  - o **Enviar para Aprovação** (WA01), com a varredura das matrizes;
  - na aprovação, a oficialização e o snapshot; na rejeição, a volta para Em Elaboração.

**Architecture:**
- **`apr` (US-078):**
  - **Tabela:** `apr_solicitacao`, com fluxo, alvo (tipo e id), unidade, solicitante, aprovador roteado, situação (`EM_APROVACAO|APROVADO|REJEITADO`), justificativa, decidida em e `versao`. Tem RLS por unidade e um índice único parcial que permite uma só `EM_APROVACAO` por alvo (RN_WA01_009).
  - **API pública:** `criarSolicitacao(tx, dados)` para quem submete, e `decidirSolicitacao(ctx, bruto, manipuladores)`.
  - **Manipuladores:** cada fluxo entra com um manipulador `{ aoAprovar(tx, s), aoRejeitar(tx, s, justificativa) }`, injetado pela **página** (camada `app/`, que importa os dois módulos). Assim o `apr` não importa o `orc` e não há ciclo.
- **`orc` (US-079):**
  - **Casos de uso:** `avancarProposta`, `enviarPropostaWa01` e o `manipuladorWa01`.
  - **Envio:** usa o `resolverAprovador` do `adm` (RN_ALC_005) e o `criarSolicitacao` do `apr`.
  - **Snapshot:** tabela `orc_snapshot_versao`, com os totais por conta e o total do Valor Global, em JSON e imutável.
- **Visibilidade (RLS por unidade):** o aprovador roteado precisa ler a proposta. No envio, ele é **vinculado à unidade do TP** (`usuario_unidade`, como o criador na D-P17-3), e a versão do usuário sobe para a sessão recarregar as unidades [PROVISÓRIO].

**Tech Stack:** o mesmo do P25. Duas migrations, uma no `apr` e outra no `orc`.

**Spec e fontes:**
- Aprovações V2, UC6.00: RF_APR_REQ_001 a 006, RN_WA01_001 a 009, E1 a E6.
- Spec: §6.2 (ciclo de vida), §6.5 (workflow e alçadas), §11.3 (GFIN aprova o WA01), §11.4 (alçadas) e C1 (submissão exige 100% das células).

## Decisões

- **D-P26-1 (escopo):**
  - **Entra:** o que está acima.
  - **Fica fora, com o motivo:**
    - **Impostos (UC3.01):** não há grade de impostos ainda (é outra história). A varredura de impostos fica como ponto vazio.
    - **Fração de alocação do headcount (E3):** não existe no modelo (C2 a deixa para a GRH confirmar).
    - **Sincronismo com o ERP Senior (E2, RN_WA01_005):** a integração ainda não existe. No lugar, todas as contas usadas precisam ser **analíticas ativas** do C1 [PROVISÓRIO].
    - **Notificação ao GFIN (RN_WA01_003):** a Central de Tarefas mostra a pendência. O e-mail fica para quando a notificação de workflow for especificada (UC02.20).
    - **IA-13 (resumo para o aprovador):** F4.
    - **WA02 e WA05:** WA05 é a US-080; WA02 não tem história nesta release.
- **D-P26-2 (avançar, UC03.10):**
  - **Situação:** Rascunho → Em Elaboração, só na última versão e por quem tem `orc.propostas:incluir`. Vai ao Histórico e sobe a capa.
  - **Recuar:** não há volta manual para Rascunho; a rejeição do WA01 devolve para Em Elaboração.
- **D-P26-3 (varredura do envio, RN_WA01_001, 002, 005 e 009):** cada falha vira um erro com o texto da exceção do UC6.00, e todas as falhas vêm juntas.
  - situação exatamente Em Elaboração (E4);
  - alçada WA01 com aprovador disponível (E5). Se o único disponível é quem envia, recusa (RN_WA02_006);
  - nenhuma solicitação Em Aprovação para o TP (RN_WA01_009);
  - **rateio (RN_WA01_002 e C1):** se a versão tem grade, todas as linhas têm as competências da vigência **declaradas** (zero digitado conta; vazia não). A mensagem é a do E1;
  - todas as contas usadas são analíticas ativas.
- **D-P26-4 (submissão):** numa transação:
  - a versão vai a `EM_APROVACAO`, e a capa sobe;
  - a solicitação WA01 é criada com o aprovador roteado (titular ou substituto), e o aprovador é vinculado à unidade;
  - o Histórico registra a submissão.
  - Com a versão Em Aprovação, as abas ficam só leitura sozinhas, porque todas exigem Rascunho ou Em Elaboração (RF_APR_REQ_004).
- **D-P26-5 (decisão na Central de Tarefas, US-078):**
  - Só o aprovador roteado decide (`aprovador_id = usuário`). O titular ou o substituto que vira o aprovador fica fixo na solicitação.
  - **Concorrência (E6):** a solicitação tem `versao`, e o segundo a decidir recebe a mensagem do E6.
  - **Justificativa da rejeição [PROVISÓRIO na leitura de "padrões genéricos"]:** pelo menos 15 caracteres, e não pode ser só um caractere ou uma palavra repetidos (ex.: "aaaaaaaaaaaaaaaa", "teste teste teste").
  - **Situação final:** a decisão grava a situação, a justificativa e a data e chama o manipulador do fluxo, na mesma transação. Se o manipulador falhar, nada fica gravado (RNF_WA01_004).
- **D-P26-6 (aprovar o WA01, UC6.00 passo 5):**
  - a versão vai a `OFICIALIZADO`;
  - o snapshot (`orc_snapshot_versao`) guarda os totais por conta **com o pessoal** e o Valor Global (RN_WA01_004);
  - o Histórico registra `HOMOLOGACAO_OFICIAL`, na descrição e no tipo de operação existente (ALTERACAO), porque o enum do Histórico é do núcleo.
  - O botão [Aditivo] (RN_WA01_008) fica com a história de aditivo.
- **D-P26-7 (rejeitar o WA01, FA-A):** a versão volta a `EM_ELABORACAO`, e o Histórico registra a rejeição com a justificativa.
- **D-P26-8 (Central de Tarefas, RF_APR_REQ_002):**
  - **Tela e funcionalidade:** `/apr/tarefas`, funcionalidade `apr.tarefas` (menu Aprovações › Workflows). GFIN e DIREX consultam e executam.
  - **Lista:** pendentes e decididas do usuário como aprovador, com o fluxo, o TP, a versão, o solicitante, o envio e a situação (badge). Filtros por situação, período e TP.
  - **Abrir:** mostra o resumo do alvo (pelo manipulador: Valor Global e totais por conta, só leitura) e as ações Aprovar e Rejeitar.
- **D-P26-9 (badges, RF_APR_REQ_005):** cinza (Rascunho), azul (Em Elaboração), amarelo (Em Aprovação), verde (Oficializado), na lista de propostas e na Central.

## Review Focus

1. **Corrida no envio:** dois envios simultâneos acabam em uma solicitação, pelo índice único parcial e pela capa.
2. **Corrida na decisão (E6):** aprovar e rejeitar ao mesmo tempo acabam em uma decisão só.
3. **Aprovador que não é o roteado** (inclusive o titular quando o substituto foi o roteado): é recusado.
4. **Falha no manipulador:** a solicitação não fica APROVADA com a proposta em Em Aprovação.
5. **Edição durante Em Aprovação:** em todas as abas (metas, pessoal, viagens, bens, rateio), a gravação é recusada. Teste no int, com uma de cada.

---

### Task 1 (US-078): `apr` — solicitação e Central de Tarefas

- [ ] Migration `202611140700_apr_solicitacao`, schema `apr.prisma`, domínio (`justificativaValida`), casos de uso, seed (`apr.tarefas`), snapshots, tela e testes (domínio, int e página).
- [ ] PR com `Closes #100` e o comentário 12.12.

### Task 2 (US-079): `orc` — avançar, enviar, oficializar e rejeitar

- [ ] Migration `202611140800_orc_snapshot_versao`, casos de uso, o manipulador do WA01, o botão na lista de propostas (habilitado só em Em Elaboração e com aprovador disponível, RF_APR_REQ_001 e 006), os badges e os testes (int, com os 5 do Review Focus, e página).
- [ ] E2E: o orçamentista avança e envia; o GFIN (usuário E2E com a alçada) rejeita com justificativa; o orçamentista reenvia; o GFIN aprova; a proposta fica Oficializada e só leitura.
- [ ] PR com `Closes #101` e o comentário 12.12.
