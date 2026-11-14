# P24 Rateio e ISS da proposta de TP (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-073 (#95): a grade de Rateio/ISS da proposta (UC03.03).
- **A taxa:** a da Administração Central (RN0270), distribuída por competência em contas analíticas.
- **A base:** o orçado de uma conta sintética mandante da própria proposta (RN_RAT_06), sem passar dele (E1).
- **O valor distribuído:** entra nos Totalizadores e no Valor Global (RN_RAT_05).

**Architecture:**
- **Onde:** no `orc`, sobre o P23 (totalizadores).
- **Tabelas, ligadas à versão, com RLS:**
  - `orc_rateio`: a grade, uma por versão, com a conta sintética mandante, o modo (percentual ou valor) e a alíquota de ISS;
  - `orc_rateio_celula`: a conta analítica de destino, a competência, o valor em R$ e o percentual, quando o modo é percentual.
- **Domínio e caso de uso:** o domínio em `domain/rateio.ts`; o caso de uso em `application/rateio.ts`, que usa o `totaisDaVersao` do P23 para a base.
- **Tela:** `/orc/rateio?proposta=<id>`. Uma tabela com uma linha por conta de destino e uma coluna por competência da vigência, e cada célula é um campo. Salva a grade inteira de uma vez.

**Tech Stack:** o mesmo do P23. Uma migration.

**Spec e fontes:**
- Cadastros V5, UC03.03: REQ_RAT_001 a 005, RN_RAT_01 a 07, E1 a E3.
- Spec: §6.6, "Receitas: rateio dos TPs" (base = subtotal de despesas pela sintética mandante; o % definido em cada TP; mês a mês); C1 da #95 ("replicar é ação explícita"); GAP-CAD-001 e GAP-ORC-007 (ISS).

## Decisões

- **D-P24-1 (escopo):**
  - **Entra:**
    - a grade por versão;
    - a escolha da sintética mandante, com a base só leitura;
    - o modo % ou R$;
    - as células por conta analítica e competência;
    - o "Replicar" explícito;
    - a trava do teto (E1) e da sintética sem saldo (E3);
    - a alíquota de ISS só no tipo Contrato (E2: de 2% a 5%);
    - a entrada nos Totalizadores e no Valor Global;
    - a cópia nas versões.
  - **Fica fora, com o motivo:**
    - **Cálculo do ISS** (RN_RAT_02 termina sem a fórmula, GAP-CAD-001; GAP-ORC-007): a alíquota é guardada e a tela mostra "a definir".
    - **Receita na Adm. Central** (aba Receitas – Rateio dos TPs): é do `orc` anual, e o rateio só vira receita confirmada com a oficialização (US-079). Até lá, vale a digitação de transição (C35).
    - **Cronograma de desembolso** (RN_RAT_05): fica com a US-075.
- **D-P24-2 (base, RN_RAT_06 e RN_RAT_07):**
  - **Valor:** o orçado da sintética mandante na versão, a soma das analíticas sob ela nos Totalizadores (pessoal, viagens e bens), **sem o próprio rateio**.
  - **Circularidade [PROVISÓRIO]:** as contas de destino não podem estar sob a sintética mandante, porque senão a base dependeria do rateio.
  - **Escolha:** só leitura, recalculada ao abrir a grade. Base zero é recusada (E3).
  - **Pessoal:** a base sempre inclui o custo do pessoal, mesmo para quem não o vê, porque a trava precisa do valor real. A tela só mostra a base a quem vê o pessoal (D-P20-5). Para os outros, mostra "restrita", e a trava continua valendo.
- **D-P24-3 (modo, REQ_RAT_002) [PROVISÓRIO]:** um modo por grade, não por célula.
  - **Percentual:** cada célula é um % da base (até 4 casas), e o valor é Half-Even.
  - **Valor:** a célula é em R$.
  - **Trocar de modo:** converte as células pela base (REQ_RAT_002).
- **D-P24-4 (trava, E1 e REQ_RAT_005):** a soma de todas as células não pode passar da base. A mensagem tem os dois valores, como no E1.
- **D-P24-5 (replicar, RN_RAT_03 e C1):**
  - Não há preenchimento automático ao salvar. A C1 da #95 manda que replicar seja ação explícita.
  - Cada linha da grade gravada tem a ação "Replicar o primeiro mês preenchido". Ela copia o valor (ou o %) da primeira célula diferente de zero para as células zeradas seguintes da linha, salva e passa pela trava E1. É uma ação do servidor, sem JavaScript, como as outras telas.
  - Célula vazia é zero; não há NULL no banco (RN_RAT_03).
- **D-P24-6 (contas de destino, RN_RAT_01):** analíticas ativas fora da sintética mandante, com até 20 linhas por grade [PROVISÓRIO].
- **D-P24-7 (ISS, E2):**
  - **Contrato:** a alíquota é obrigatória, de 2,00% a 5,00%.
  - **Termo de Parceria:** é imune, sem o campo (UC03.03, "imunidade tributária para a modalidade de TP").
- **D-P24-8 (concorrência e ciclo de vida, RN_RAT_04):** as peças do P20; toda gravação sobe a `versao` da capa. A grade só se edita na última versão em Rascunho ou Em Elaboração, e a versão oficializada fica congelada.
- **D-P24-9 (cópia):**
  - **Nova versão:** copia a grade, com as células cuja competência cabe na vigência.
  - **Duplicação:** copia a grade, sem a alíquota se o tipo mudar.
- **D-P24-10 (permissões) [PROVISÓRIO]:** funcionalidade `orc.rateio` (ordem 8, `/orc/rateio`). ORCAMENTISTA e GFIN lançam (o UC cita os dois); AUDITOR e DIREX consultam.

## Review Focus

1. **Base sem o próprio rateio:** se as contas de destino estiverem sob a mandante, a gravação é recusada. Teste no int.
2. **Trocar de modo:** a conversão de % para R$ e de R$ para % é Half-Even e não estoura o teto por arredondamento. Teste de domínio.
3. **Quem não vê o pessoal:** a trava vale, e a base não aparece. Teste no int e na página.
4. **Vigência encurtada na nova versão:** as células fora dela não vêm. Teste no int.
5. **Totalizadores e Valor Global:** passam a somar as células nas contas de destino. Teste no int.

---

### Task 1: Banco, domínio e casos de uso

**Interfaces:**
- **Domínio:**
  - `validarGrade(bruto, { competencias, base, modo, tipoProposta }) → Resultado<GradeValidada>`;
  - `converter(celulas, base, de, para)`;
  - `replicarLinha(valores: readonly Decimal[]) → Decimal[]`.
- **Aplicação:**
  - `obterRateio(ctx, propostaId, deps)`, que devolve a grade, a base (ou nula, se restrita), as competências e as opções de contas;
  - `salvarRateio(ctx, bruto, deps)`, `replicarRateio(ctx, bruto, deps)` e `excluirRateio(ctx, bruto, deps)`;
  - `copiarRateioDaVersao(tx, origem, destino, criadoPor)`;
  - o `totaisDaVersao` passa a somar as células.

- [ ] **Step 1:** testes do domínio:
  - percentual com Half-Even;
  - E1 com os dois valores na mensagem;
  - E2 nos limites 2,00 e 5,00, inclusivos;
  - o replicar;
  - a conversão sem estouro.
- [ ] **Step 2:** a migration (`202611140500_orc_rateio`), o schema e as mensagens.
- [ ] **Step 3:** testes int:
  - salvar e reabrir;
  - E1 e E3;
  - destino sob a mandante;
  - Contrato com e sem alíquota, e TP sem o campo;
  - nos Totalizadores;
  - quem não vê o pessoal;
  - a versão imutável;
  - a cópia com a vigência encurtada;
  - o Histórico.
- [ ] **Step 4:** seed (`orc.rateio`) e snapshots; commit.

### Task 2: Tela e E2E

- [ ] **Step 1:** a página com a escolha da sintética, a base, o modo, a grade (linhas × competências), o Replicar e o ISS. Testes da página.
- [ ] **Step 2:** link "Rateio/ISS da proposta N" na lista; passo 3g do E2E, com uma linha de rateio que aparece nos Totalizadores.
- [ ] **Step 3:** PR com `Closes #95` e o comentário 12.12.
