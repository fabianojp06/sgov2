# P21 Viagens da proposta de TP (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a US-071 (#93). Na versão da proposta, o orçamentista (ou o Operador de Viagens) registra o **teto por conta sintética** (Camada 1) e as **viagens** (Camada 2), com o custo da RN_VIA_03, a barreira do teto e o painel analítico do Viagens V3.

**Architecture:**
- **Onde:** no `orc`, sobre a US-065 a US-070 (P17 a P20):
  - duas tabelas novas ligadas à **versão** da proposta, com RLS por unidade: `orc_teto_viagem` e `orc_viagem`;
  - domínio em `domain/viagem.ts` (validação, custo e indicadores, puros); caso de uso em `application/viagens.ts`;
  - tela `/orc/viagens` (Cadastros › Viagens).
- **Concorrência:** a do P19/P20, pelas peças do `pessoal-comum.ts` (`lerVersaoEditavel`, `travarVersao`, `resolverMeta`, `executarPessoal`). Toda operação sobe a `versao` da capa, e toda recusa vem antes dessa subida. A barreira do teto lê as somas antes da trava. É seguro: duas gravações concorrentes partem da mesma `versaoCapa`, e a segunda cai no ALTERADO_POR_OUTRO.
- **Cópia:** o `copiarLinhasDaVersao` passa a copiar os tetos e as viagens (RN_DUP_003).

**Tech Stack:** o mesmo do P20. Sem dependência nova. Uma migration.

**Spec e fontes:**
- Spec: C6 [PROVISÓRIA], C15, C19, C26, C28, §6.1 (só analíticas ativas recebem valor), §11.3 (Operador de Viagens).
- Viagens V3 (ago/2026): campos, painel, REQ_VIA_004 a 007, RN_VIA_02 a 06 e 08, exceções E1, E2 e E4. Pela C15, substitui os UC03.29 a UC03.33.
- Dos UC03.29 a 33 ficam o que o V3 não cobre: a Camada 1 e o E3 (estouro do teto, UC03.30), a blindagem das chaves no alterar (RN_VIA_07, UC03.32) e os textos de confirmação e recusa da exclusão (UC03.33).
- Decisão do PO (13/11/2026, nesta sessão): **o teto é informado** na Camada 1. Ver a D-P21-5.

## Decisões

- **D-P21-1 (escopo):**
  - **Entra:** tetos (Camada 1); viagens com incluir, alterar, copiar e excluir; painel analítico; filtros; cópia nas versões.
  - **Fica fora, com o motivo:**
    - "Tipo de Viagem": só aparece nos UC03.29/32, não no V3 (GAP-VIA-001).
    - Período da viagem e RN_VIA_05: não há campo (GAP-CAD-002).
    - Imprimir e Exportar (REQ_VIA_003 do UC03.29): ficam com o demonstrativo de estimativa de viagens (US-077).
    - Validação WA02 e teto rígido no envio (RN_VIA_01): US-079/080.
    - RN0289 (adiantamentos e diárias liquidadas): ainda não há prestação de contas.
    - RN_VIA_01 do UC03.29 (esconder TP vencido): a tela segue a regra das outras abas, que é editar pela situação da versão.
- **D-P21-2 (tabelas):**
  - **`orc_teto_viagem`:** `id`, `unidade_id`, `versao_proposta_id`, `conta_sintetica` (classificação, R5), `valor` NUMERIC(15,2) > 0, `criado_por`, `criado_em`, `versao`. É único por (`versao_proposta_id`, `conta_sintetica`).
  - **`orc_viagem`:** `id`, `unidade_id`, `versao_proposta_id`, `meta_id` (NULL, FK RESTRICT para `orc_meta`), `localidade` (até 100), `pessoas` e `dias` (inteiros de 1 a 9999), `valor_passagem`, `valor_diaria` e `valor_transporte` NUMERIC(15,2) ≥ 0, `conta_passagem` e `conta_diaria` (classificação), `conta_transporte` (NULL), `criado_por`, `criado_em`, `versao`.
  - **Custo:** não é gravado. A REQ0212 manda não isolar totalizador; o custo é sempre calculado na leitura (RN_VIA_03 read-only).
  - **No banco:** CHECKs; o trigger `orc_pessoal_mesma_versao` é reaproveitado (mesma unidade e meta da mesma versão); RLS; `REVOKE ALL FROM sgo_sync`; o UPDATE é por coluna, só nas editáveis.
- **D-P21-3 (custo, RN_VIA_03 e C19):**
  - passagem = pessoas × valor da passagem;
  - diária = pessoas × dias × valor da diária;
  - **custo estimado** = passagem + diária.
  - **Transporte [PROVISÓRIO]:** o componente é pessoas × valor do transporte, como a passagem, por ser "unitário". Fica fora do custo estimado (C19) e aparece no painel (REQ_VIA_005).
  - Tudo em `Dinheiro` (Half-Even, duas casas, RN_VIA_06).
  - O "valor calculado pela média do último contrato" do V3 não tem fonte de dados: o valor é digitado.
- **D-P21-4 (contas, RN_VIA_02, E1 e C26):**
  - As contas de passagem e de diária são obrigatórias e precisam ser **analíticas ativas** da estrutura completa (`estruturaCompleta`, nível 5).
  - A conta de transporte só é obrigatória com valor de transporte > 0. Com valor zero, não é gravada.
- **D-P21-5 (teto, C6 e decisão do PO de 13/11) [PROVISÓRIO até o André]:**
  - **Camada 1:** o teto é informado por conta sintética ativa, com valor > 0 (E5: teto zero é recusado).
  - **Sem aninhamento:** na mesma versão, uma sintética não pode ser ancestral nem descendente de outra com teto. Assim, cada analítica cai em no máximo um teto.
  - **Viagem sem teto:** a conta de passagem e a de diária precisam estar sob uma sintética com teto. Sem isso, a gravação é recusada, porque a Camada 2 fica bloqueada sem a Camada 1.
  - **Consumido do teto S:** é a soma dos componentes passagem e diária cujas contas estão sob S. O transporte não conta (C19). Ver o Review Focus 1.
  - **Gravar viagem:** se algum teto afetado ficar com consumido > teto, a gravação é recusada com o texto do E3.
  - **Alterar o teto:** o valor novo não pode ficar abaixo do consumido.
  - **Excluir o teto:** recusado enquanto houver viagem com conta sob ele.
  - **Conta sintética no alterar:** fica só leitura. Para trocar, exclui-se o teto e cadastra-se outro.
- **D-P21-6 (meta, RN_VIA_04, E2 e D-P19-7):**
  - Vale a regra do pessoal: na categoria Meta, uma meta ativa é obrigatória; na Consolidada, nenhuma.
  - **No alterar (RN_VIA_07):** a meta e as três contas ficam só leitura. Editam-se a localidade, as pessoas, os dias e os valores.
- **D-P21-7 (copiar, REQ_VIA_007, GAP-VIA-003):** o Copiar abre o formulário de **inclusão** já preenchido com os dados da viagem de origem (`?copiar=<id>`). Nada é gravado antes do Salvar, e o salvar é um incluir comum, com as mesmas barreiras (V3, fluxo B).
- **D-P21-8 (cópia nas versões, RN_DUP_003):**
  - **Tetos:** sempre copiados.
  - **Viagens, na nova versão:** copiadas inteiras.
  - **Viagens, na duplicação:** a regra do pessoal (D-P20-8 emendada). Com outra categoria, não vêm; a meta é refeita pelo número. As viagens não têm período, então a vigência não filtra.
- **D-P21-9 (exclusão):** física, com o texto de confirmação do UC03.33.
- **D-P21-10 (permissões) [PROVISÓRIO]:**
  - Funcionalidade `orc.viagens` (ordem 5, `/orc/viagens`).
  - **ORCAMENTISTA e OPERADOR_VIAGENS:** todas as ações, com os tetos incluídos. O §11.3 diz que o Operador de Viagens cuida da "aba Viagens das propostas".
  - **GFIN, AUDITOR e DIREX:** consultar.
  - O custo de viagem não é dado sensível, então todos os que consultam o veem.
- **D-P21-11 (tela e painel):**
  - Um bloco por proposta (última versão), com:
    - **Camada 1:** tabela dos tetos: conta, descrição, teto, consumido e saldo;
    - **Cartões (REQ_VIA_004 e RN_VIA_08):** Nº de viagens, custo total estimado, custo médio por viagem (total ÷ nº, Half-Even; com zero viagens, mostra "—") e total de pessoas-viagem;
    - **Composição (REQ_VIA_005):** passagens, diárias, transporte e total geral (soma dos três) [PROVISÓRIO];
    - **Ranking (REQ_VIA_006):** custo estimado por localidade, decrescente, como tabela com barra proporcional (sem biblioteca de gráfico);
    - **Grade:** agrupada por meta na categoria Meta (REQ_VIA_002 do UC03.29), com Editar, Copiar e Excluir.
  - **Filtros (REQ_VIA_001):** tipo, proposta, meta e localidade.

## Global Constraints

- Dinheiro em NUMERIC(15,2) e `Dinheiro` (Half-Even); `number` só para inteiros (pessoas, dias).
- Textos da interface em pt-BR; nunca o nome da instituição; "Subconta" não aparece nas telas (C26).
- Toda recusa (Resultado) vem antes da `travarVersao`.
- Os snapshots `seed.int.test.ts`, `privilegios.int.test.ts` e `tela-principal.int.test.ts` são atualizados à mão, sem `prettier --write`.
- No `schema`, o `@@unique` é declarado com `map:` igual ao nome do índice da migration (o CI Migrations compara).

## Review Focus

1. **Teto com transporte:** o transporte não entra no consumido. Teste: viagem cujo transporte passaria do teto é gravada.
2. **Viagem que muda de valor no alterar:** o consumido é recalculado sem contar a própria viagem duas vezes. Teste: alterar para um custo igual ao teto passa; um centavo a mais é recusado.
3. **Conta que deixou de ser analítica ativa:** a viagem gravada continua na lista. Alterar com a conta inativa é recusado com a mensagem do E1, porque as contas são só leitura e a conta precisa ser válida. A saída é excluir e cadastrar de novo. Teste no int.
4. **Teto de sintética ancestral de outra:** é recusado nos dois sentidos. Teste no domínio e no int.
5. **Concorrência:** duas inclusões com a mesma `versaoCapa` acabam em uma gravada e um ALTERADO_POR_OUTRO. Coberto pelo padrão do P20 e testado uma vez.

---

### Task 1: Banco, domínio e casos de uso

**Files:**
- Create: `prisma/migrations/202611140100_orc_viagem/migration.sql`
- Modify: `prisma/schema/orc.prisma` (modelos `TetoViagemProposta` e `ViagemProposta`), `prisma/schema/nucleo.prisma` (relações em `Unidade`)
- Create: `src/modules/orc/domain/viagem.ts` e `viagem.test.ts`
- Modify: `src/modules/orc/domain/mensagens.ts`, `application/governanca.ts` (`CAMPOS_ORIGEM_BLINDADA.viagem` e `.tetoViagem`), `application/propostas.ts` (chama `copiarViagensDaVersao`)
- Create: `src/modules/orc/application/viagens.ts` e `viagens.int.test.ts`
- Modify: `src/modules/orc/infrastructure/seed.ts` e os três snapshots

**Interfaces:**
- **Domínio:**
  - `validarViagem(bruto): Resultado<ViagemValidada>`, com `ViagemValidada = { localidade, pessoas, dias, valorPassagem, valorDiaria, valorTransporte (Dinheiro), contaPassagem, contaDiaria, contaTransporte: string | null }`;
  - `custoDaViagem(v) → { passagem, diaria, transporte, estimado: Dinheiro }`;
  - `indicadores(viagens) → { quantidade, custoTotal, custoMedio: Dinheiro | null, pessoas, passagens, diarias, transportes, totalGeral, ranking: { localidade, custo }[] }`;
  - `validarTeto(bruto)`;
  - `sinteticasAninhadas(a, b): boolean`, por prefixo de segmentos.
- **Aplicação:**
  - `listarViagens(ctx, filtros, deps) → BlocoViagens[]`;
  - `opcoesViagem(ctx, deps) → { analiticas, sinteticas: OpcaoEstrutura[] }`;
  - `incluirViagem`, `alterarViagem`, `excluirViagem`, `incluirTeto`, `alterarTeto` e `excluirTeto`, todas no formato `(ctx, bruto, deps) → Resultado<{ rotulo: string }>`;
  - `copiarViagensDaVersao(tx, origem, destino, criadoPor)`.

- [ ] **Step 1:** testes do domínio:
  - custo 2 × 1.000,00 + 2 × 3 × 250,00 = 3.500,00;
  - custo médio Half-Even (10,00 ÷ 3 = 3,33);
  - ranking decrescente;
  - pessoas 0 e 10000 recusadas;
  - localidade vazia recusada (E4);
  - conta de transporte exigida só com valor > 0;
  - aninhamento: `4.1` × `4.1.2` verdadeiro, `4.1` × `4.10` falso.
- [ ] **Step 2:** implementar `domain/viagem.ts` e as mensagens. Textos literais do V3 e dos UC:
  - E1 (UC03.31): "Seleção inválida. A despesa de viagem deve ser obrigatoriamente associada a uma conta analítica de Nível 7 (Nó Folha).", adaptado para "conta analítica (nível 5)" pela C26;
  - E3 (UC03.30): "Operação Rejeitada: O somatório das viagens operacionais excede o teto orçamentário disponível na Conta Sintética selecionada.";
  - E5: "Erro de Consistência: A Conta Sintética selecionada não possui saldo disponível para custear despesas de deslocamento.";
  - confirmação (UC03.33): "Deseja realmente excluir este registro de viagem do orçamento? Esta ação não poderá ser desfeita.";
  - versão imutável (UC03.33 E2): "Exclusão Rejeitada: Operação bloqueada. A Proposta correspondente já foi submetida ou homologada.".
- [ ] **Step 3:** migration e schema. Rodar `npx prisma migrate diff` só no dev local, para conferir que não há drift.
- [ ] **Step 4:** testes int em `viagens.int.test.ts`:
  - incluir na categoria Meta;
  - Consolidada sem meta;
  - E2 (meta obrigatória);
  - E1 com conta sintética e com conta inativa;
  - sem teto;
  - E3 no incluir e no alterar (Review Focus 2);
  - transporte fora do teto (RF 1);
  - teto aninhado (RF 4);
  - teto abaixo do consumido;
  - excluir teto com viagem;
  - versão imutável;
  - ALTERADO na corrida (RF 5);
  - cópia em nova versão e na duplicação com outra categoria;
  - Histórico de inclusão, alteração e exclusão;
  - consulta (GFIN) sem incluir.
- [ ] **Step 5:** implementar `application/viagens.ts`, o seed (`orc.viagens`) e os snapshots. Depois rodar `npm run test:int -- src/modules/orc` e os três snapshots, e conferir que passam.
- [ ] **Step 6:** commit.

### Task 2: Tela e E2E

**Files:**
- Create:
  - `src/modules/orc/ui/tela-viagens.tsx`, `ui/form-viagem.tsx` e `ui/form-teto-viagem.tsx`;
  - `application/acoes-viagens.ts`;
  - `src/app/(sistema)/orc/viagens/page.tsx`;
  - `ui/paginas-viagens.test.ts`.
- Modify: `src/modules/orc/index.ts`, `ui/tela-propostas.tsx` (link "Viagens da proposta N") e `e2e/orc/propostas.spec.ts` (passo 3d: teto e viagem; o `afterAll` apaga `orc_viagem` e `orc_teto_viagem`).

- [ ] **Step 1:** testes da página:
  - os cartões e a composição com valores formatados em R$;
  - o ranking em ordem;
  - o formulário de copiar vem preenchido e é de inclusão;
  - no alterar, meta e contas vêm só leitura;
  - quem consulta não vê ações;
  - teto sem viagens mostra o saldo igual ao teto.
- [ ] **Step 2:** implementar a tela, as ações (com o padrão `?aviso=` e `?d=`) e a página. Rodar `npm test`, `npm run lint` e `npm run typecheck`.
- [ ] **Step 3:** E2E. Rodar `flock … npm run build` e `npm run test:e2e -- e2e/orc/propostas.spec.ts`.
- [ ] **Step 4:** commit, PR com `Closes #93` e o comentário "Revisão de código (12.12)".
