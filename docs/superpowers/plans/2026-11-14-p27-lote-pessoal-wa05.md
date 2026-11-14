# P27 Lote de pessoal para homologação (WA05) (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-080 (#102). O analista do GRH finaliza os lançamentos de pessoal da versão, o **[Finalizar Lançamentos]**, e o lote vai para homologação (WA05, UC6.01).
- **Em aprovação:** as telas de pessoal ficam só leitura (RF_APR_REQ_008, RN_WA05_004).
- **Homologação (GFIN, na Central de Tarefas da US-078):** o pessoal passa a entrar no cronograma de desembolso (RN_WA05_005).
- **Rejeição:** devolve o lote para edição.

**Architecture:**
- **Tabela:** `orc_lote_pessoal`, uma por versão, com a situação `EM_ELABORACAO|EM_APROVACAO|HOMOLOGADO`, RLS e `versao`. Sem linha, o lote está Em Elaboração.
- **Casos de uso:**
  - `finalizarLotePessoal` e `aprovadoresDoLote` (o modal mostra o titular e o substituto, RF_APR_REQ_007) em `application/lote-pessoal.ts`;
  - o `manipuladorWa05` para a Central de Tarefas.
- **Trava:** os casos de uso de empregados e de quantitativos recusam a gravação com o lote Em Aprovação ou Homologado (`pessoalTravado`).
- **Cronograma (US-075):** o pessoal entra só com o lote Homologado. Antes disso, a tela avisa que o pessoal entra depois da homologação.
- **Totalizadores e Valor Global:** continuam com o pessoal, porque são a visão do planejamento. Ver a D-P27-4.

**Tech Stack:** o mesmo do P26. Uma migration.

**Spec e fontes:**
- Aprovações V2, UC6.01: RF_APR_REQ_006 a 008, RN_WA05_001 a 005, E1 a E3, FA-A e FA-B.
- Spec: §6.5 (alçadas) e §11.3 (o Analista GRH finaliza o WA05, e o GFIN aprova).

## Decisões

- **D-P27-1 (escopo):**
  - **Entra:** finalizar, homologar e rejeitar; a trava das telas de pessoal; o cronograma condicionado à homologação.
  - **Fica fora, com o motivo:**
    - Regra de 100% de ocupação (E2, RN_WA05_002): a fração de dedicação por meta não existe no modelo (C2, a confirmar com a GRH).
    - Criptografia por coluna (RNF_WA05_004): já é a D10 da spec.
    - Notificação por e-mail: como no P26.
- **D-P27-2 (quem finaliza) [PROVISÓRIO]:**
  - **Permissão:** a ação `executar` nova em `orc.empregados`, só para o ANALISTA_GRH (RF_APR_REQ_006: "visível unicamente para perfis GRH").
  - **Tela:** o botão aparece na tela de empregados, por proposta, com a versão em Rascunho ou Em Elaboração e o lote Em Elaboração.
  - **Modal:** mostra o titular e o substituto da alçada WA05, só leitura (RF_APR_REQ_007).
- **D-P27-3 (finalizar):** a varredura junta as falhas.
  - **Falhas possíveis:**
    - versão não editável;
    - lote já Em Aprovação ou Homologado;
    - nenhum empregado na versão;
    - sem aprovador WA05 (E1);
    - só quem envia é aprovador (RN_WA02_006).
  - **Sem falha:** o lote vai a Em Aprovação, a solicitação WA05 é criada (o aprovador vem do `resolverAprovador`, e a unidade vem da proposta) e o Histórico registra a finalização.
  - **Concorrência (E3):** a capa sobe, e o segundo a finalizar recebe a mensagem do E3.
- **D-P27-4 (efeito da homologação, RN_WA05_005) [PROVISÓRIO]:**
  - **Cronograma:** o pessoal passa a entrar só com o lote Homologado, com aviso enquanto não está.
  - **Totalizadores e Valor Global:** seguem com o pessoal em qualquer situação, porque são a visão de planejamento e a base do rateio.
  - **Consequência:** a soma do cronograma fica abaixo dos Totalizadores enquanto o pessoal não é homologado, e a tela diz isso.
- **D-P27-5 (imutabilidade, RN_WA05_004) [PROVISÓRIO]:**
  - **Em Aprovação e Homologado:** empregados e quantitativos não se alteram. Para mudar o pessoal homologado, cria-se nova versão.
  - **Nova versão e duplicação:** não copiam o lote, e o pessoal nasce Em Elaboração.
- **D-P27-6 (rejeição, FA-B):** o lote volta a Em Elaboração, com a justificativa no Histórico.
- **D-P27-7 (Central de Tarefas):** o manipulador do WA05 entra na página da Central. O resumo mostra a quantidade por categoria e o custo total do pessoal; o aprovador homologa o custo, como no WA01.
- **D-P27-8 (envio do WA01, revisão 12.12) [PROVISÓRIO]:** com empregados na versão, o envio para oficialização exige o lote de pessoal Homologado.
  - **Motivo:** sem isso, a versão oficial (imutável) ficaria com o pessoal fora do cronograma para sempre, porque a finalização exige versão editável.
  - **Também da revisão:** os quantitativos ficam só leitura com o lote travado, como os empregados. O botão [Finalizar] dá lugar ao motivo quando não há aprovador ou quando o próprio GRH seria roteado.

## Review Focus

1. **Empregado e quantitativo com o lote Em Aprovação ou Homologado:** a gravação é recusada. Teste no int.
2. **Cronograma antes e depois da homologação:** sem o pessoal e com ele. Teste no int.
3. **Rejeitar:** o lote volta a ser editável. Teste no int.
4. **Nova versão de uma versão com o pessoal homologado:** o lote nasce Em Elaboração. Teste no int.
5. **Orçamentista sem a ação `executar`:** não finaliza. Teste no int e na página.

---

### Task 1: Lote, finalizar e manipulador

- [ ] Migration `202611141000_orc_lote_pessoal`, schema, mensagens, caso de uso, a trava em `empregados.ts` e `qtde-empregados.ts`, a condição no `cronograma.ts`, o seed (a ação `executar` em `orc.empregados` para o ANALISTA_GRH) e os snapshots. Testes de domínio e de integração, com os 5 do Review Focus.

### Task 2: Tela e E2E

- [ ] O botão e o modal na tela de empregados; o selo do lote; o manipulador na Central; o teste de página.
- [ ] E2E: o analista GRH finaliza; o GFIN homologa; o cronograma passa a ter o pessoal.
- [ ] PR com `Closes #102` e o comentário 12.12.
