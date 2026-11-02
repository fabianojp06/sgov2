# Trilha 2027 · P6 Orçamento da Adm. Central (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar ao sistema o orçamento 2027 da Administração Central, do exercício à oficialização:
- exercício anual, em branco ou copiando o anterior (US-055);
- importação da planilha-modelo com validação linha a linha e custo de pessoal recalculado pelo motor oficial (US-121);
- receitas do rateio dos TPs digitadas na transição (US-060, C35);
- visão por centro de custo com árvore, série mês a mês e linhas CC × conta, com o escopo do Gestor de Diretoria no servidor (US-058, C25);
- teto, semáforo e resultado (US-059);
- envio pela GFIN, aprovação ou rejeição pela DIREX e oficialização com snapshot imutável (US-061, C36);
- E2E do fluxo inteiro.

As telas de lançamento de posições e pacotes (US-056/057) ficam fora da trilha (§3.3): na trilha, posições e pacotes só entram pela planilha.

**Architecture:**
- **`orc` é dono do orçamento da Adm. Central** (`prisma/schema/orc.prisma`, `src/modules/orc/`). Ele consome:
  - o `cad` pelos contratos **C1** (estrutura financeira) e **C2** (custo de pessoal), recebendo o `tx` como primeiro parâmetro, sempre pelo `index.ts`/`servidor.ts` do `cad`;
  - o leitor seguro de .xlsx do `ger` (`lerPlanilhaSegura`, acréscimo ao C3);
  - o `adm` para o CC de escopo do usuário (C25).
- **Valores calculados são gravados** (`orc_linha`): cada posição e cada pacote vira linhas CC × conta com 12 meses. A visão, o teto, o resultado e o snapshot leem dessas linhas. O exercício guarda a `versao` das premissas do C2 usada no último cálculo; se as premissas mudarem, a visão avisa e o envio é recusado até recalcular.
- **Todo cálculo refaz o exercício inteiro** na mesma transação (importação, cópia e "Recalcular"). Um exercício tem algumas centenas de linhas; recalcular tudo evita linhas com versões de premissas diferentes.
- **Ciclo de vida da §6.2:** Rascunho → Em Elaboração → Em Aprovação → Oficializado, com rejeição de volta para Em Elaboração. A edição só vale em Rascunho e Em Elaboração; o banco também recusa (trigger).
- **Escopo do Gestor de Diretoria no servidor:** quem tem CC de escopo vê só os CCs analíticos da subárvore; quem não tem vê a Adm. Central inteira.
- **Componentes cliente nunca importam o `index.ts` do `orc`** (ruling da Task 2b do P5): recebem ações e dados por props da página.

**Tech Stack:** Next.js 16.4.3 (App Router, Server Actions), React 19.3.1, Prisma 7.10.1, PostgreSQL 16, Zod 4.6.7, decimal.js 10.6.0, Vitest 5.0.5 + Testcontainers, Playwright 1.64.0 (contêiner oficial, decisão do PO de 25/10). **Sem dependência nova:** o `exceljs` entrou no compartilhado do P4 (#205) e só é usado nos testes deste bloco, para montar planilhas.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (v1.5): §3.3, §5, §6.1, §6.1a, §6.2, §6.6, §6.7, §10.2, §11.3, §12.3, §12.5–§12.7, §12.12; C7, C25, C33, C34, C35, C36; GAP-ORC-003, GAP-ORC-004, GAP-ORC-007, GAP-CC-001. **Plano-mestre:** `docs/superpowers/plans/2026-10-24-trilha-2027-plano-mestre.md` (P6: US-055 #77, US-120 #142, US-121 #143, US-058 #80, US-059 #81, US-060 #82, US-061 #83). **Contratos C1 e C2:** `docs/superpowers/plans/2026-10-25-trilha-2027-p4-cadastros.md`, Tasks 2 e 3 (assinaturas exatas), e R13/R14 (ordem do cálculo). **Planilha-modelo:** `docs/modelos/orcamento-adm-central-2027-modelo-v1.0.xlsx` e o gerador `docs/modelos/fonte/gerar_planilha_orcamento.py` (layout `ADMC-ORC v1.0`).

A **US-120** (planilha-modelo) já foi entregue e fica aberta até o PO validá-la com a GFIN e a GRH. Este plano não muda a planilha: o layout dela é a interface da importação.

## Decisões pendentes do PO

O PO segue a recomendação quando houver dúvida (memória, 25/10). Cada uma é reversível com o custo indicado.

| # | Decisão | Recomendação | Afeta |
| --- | --- | --- | --- |
| D-P6-1 | Cifra do salário das posições (nota P1 do P4) | **Sem cifra na trilha.** A posição é orçamento, não folha: a mesma informação circula em claro na planilha-modelo entre os gestores. O salário da posição só aparece para quem tem `orc.orcamento:consultar` no escopo. Custo se errado: uma migration de cifra depois de 30/11, no padrão do `cad` (R7 do P4) | Task 1 |
| D-P6-2 | Teto acima da receita confirmada | **Justificativa de pelo menos 15 caracteres**, como a rejeição (C36), gravada no exercício e no Histórico | Task 7 |
| D-P6-3 | Quem enviou pode aprovar? | **Não.** O mesmo usuário com GFIN e DIREX não aprova o que enviou: "Quem enviou o orçamento para aprovação não pode aprová-lo." | Task 8 |
| D-P6-4 | Permissões padrão do `orc` (tabela da Task 1) | **Aprovar** como [PROVISÓRIAS] até o GAP-ORC-004 | Task 1 |
| D-P6-5 | Cópia do exercício com CC ou conta que deixou de ser analítico ativo | **Pula a linha e avisa** (contagem na tela e no Histórico). Recusar a cópia inteira travaria o exercício seguinte por um CC inativado | Task 3 |
| D-P6-6 | O Gestor de Diretoria importa a planilha? | **Não, na trilha.** O gestor preenche a planilha e a entrega à GFIN, que importa (US-121 "Como GFIN"); `orc.importacao` só para a GFIN. Se o Administrador conceder a importação a um usuário com escopo, o escopo vale (R8) e a aba Receitas é recusada (R15) | Tasks 1 e 4b |
| D-P6-7 | "Empregados em dezembro" (§6.6: "nº de posições") | **Soma das quantidades das posições ativas em dezembro** (pessoas, não linhas), [PROVISÓRIA] | Task 6 |

## Global Constraints

- **D12 / spec §11.5 item 6:** nenhuma sessão toca contêineres, redes, volumes ou variáveis de `sgo-prod`/`sgo-hml`.
- **Um processo pesado por vez (D12):** `test:int`, `build` e E2E rodam um de cada vez, com `nice -n 10`. Antes de cada um, `pgrep -af 'vitest|next build|playwright'` sem saída da worktree `/root/sistemas/sgo-b`.
- **Banco (spec §11.5):** antes de todo comando que toca banco, dizer se ele **escreve, apaga ou reseta**, e conferir que `DATABASE_URL`, `MIGRATE_DATABASE_URL` e `SHADOW_DATABASE_URL` apontam para `127.0.0.1:55432`. `migrate dev --create-only` e `migrate diff` só no dev local. Para recriar o banco de dev: `docker compose down -v` (**apaga** o dev local 55432, depois de `grep COMPOSE_PROJECT_NAME .env` mostrar o projeto da frente A), `docker compose up -d --wait`, `npm run db:deploy` e `npm run db:seed` (**escrevem** no dev local).
- **Nada de `git stash`:** o *stash* é compartilhado entre as worktrees.
- **Migrations (spec §12.7):** duas neste bloco, cada uma no seu PR com a label `migration`: `AAAAMMDDHHMM_adm_exibir_no_menu` (Task 0) e `AAAAMMDDHHMM_orc_orcamento` (Task 1). O PO faz o merge de uma por vez; o nome é gerado depois do rebase e **maior que a última da `main`** (`ls prisma/migrations | tail -1`). `REVOKE`/`GRANT`, `CHECK` e *triggers* à mão no `migration.sql`. Depois do `db:deploy` local, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code` sem diferença.
- **Privilégios (B1 do P4):** a `nucleo_privilegios` dá a `sgo_app` **e** a `sgo_sync` `SELECT`, `INSERT`, `UPDATE` e `DELETE` em toda tabela nova. A migration do `orc` faz `REVOKE ALL … FROM sgo_sync` em todas as tabelas do `orc` e ajusta o `sgo_app` à matriz da Task 1. O teste `src/modules/orc/infrastructure/privilegios.int.test.ts` compara `information_schema.table_privileges` com a matriz esperada: privilégio a mais ou a menos reprova.
- **Propriedade (spec §12.3):** este bloco só cria ou altera `src/modules/{orc,adm,aut}/` (no `aut`, só testes do menu na Task 0), `prisma/schema/{orc,adm}.prisma`, `prisma/migrations/`, `src/app/(sistema)/orc/`, `e2e/orc/`, `e2e/aut/` e `e2e/global-setup.ts`. `prisma/seed.ts` só no PR `compartilhado` da Task 1b. O que precisar do `cad` ou do `ger` vira issue com a label `contrato` para a frente B.
- **Relação entre módulos por classificação, sem FK cruzada (§12.7 item 1):** CC e conta são gravados pela **classificação** (a chave imutável do C1, R5 do P4), em `text`. A validação é pelo índice do C1 (`carregarIndiceEstrutura`) no mesmo `tx`.
- **Autorização e auditoria (C5):**
  - toda Server Action com `definirAcao`; toda `page.tsx` de `src/app/(sistema)/orc/` começa com `await exigirPagina(...)` (o teste de arquitetura impõe);
  - todo caso de uso chama `exigir(ctx, funcionalidade, acao)` primeiro e audita com `auditar(tx, evento)` no mesmo `tx`;
  - dinheiro auditado como `Dinheiro`, percentual como `Percentual`;
  - **sem TP no Histórico (revisão de bloco do P5, item 2):** a Adm. Central não é unidade, então o `ContextoAuditoria` do `orc` leva sempre `unidadeId: null`, mesmo com um TP escolhido no seletor (teste em cada tarefa com escrita);
  - **ORIGEM BLINDADA (§5):** a casca de cada caso de uso com escrita confere as chaves do *payload* bruto contra a lista do caso de uso **antes** do *parse* (os *schemas* usam `.strict()`), e a violação gera `ErroDominio('orc.violacao_governanca')`, auditada numa transação própria (padrão M4/M-n4 do P4). Listas (`CAMPOS_ORIGEM_BLINDADA` em `application/governanca.ts`):
    - exercício (criar, avançar, teto, ciclo): `situacao`, `versaoPremissas`, `enviadoPor`, `oficializadoEm`, `tetoEfetivo`;
    - receita: `origem`, `total`, `liquido`, `iss`, `importacaoId` (os `meses` são digitados e não são blindados);
    - importação e recálculo não recebem dados de linha do *payload* (só o arquivo e o id).
- **Testes obrigatórios das diretrizes (spec §10.2), em toda tarefa com escrita:** item 1 (auditoria falhando: nada persiste, com `vi.mock('@/shared/audit', …)`); item 3 (sem permissão: 403 auditado); item 4 (dois saves concorrentes: o segundo recebe "Este registro foi alterado por outro usuário. Recarregue a tela."); item 5 (campo de ORIGEM BLINDADA no *payload*: rejeitado e auditado); item 6 (soma de dinheiro sem *drift*). O item 2 (unidade) não se aplica: a Adm. Central não é unidade (§6.7).
- **Dinheiro:** `Dinheiro`/`Percentual` do kernel, `NUMERIC(15,2)` no banco (séries em `NUMERIC(15,2)[]` com 12 posições), Half-Even. `number` só para ano, mês, quantidade e contagem. O lint barra `parseFloat`, `Math.round` e `.toFixed` em `domain/`.
- **Lint de domínio:** `src/modules/orc/domain/` só importa o próprio módulo e `@/shared/kernel`. Tudo que vem do `cad`, do `ger`, do `adm`, do `totalizer` ou do banco fica em `application/` e chega ao domínio por parâmetro.
- **Serialização das escritas de um exercício:** toda escrita **começa** com `SELECT … FROM orc_exercicio WHERE id = $1 FOR UPDATE` (helper `travarExercicio`, Task 2), antes de qualquer outra escrita: os triggers da Task 1 leem o exercício com `FOR SHARE`, e pegar a trava de linha primeiro evita o *deadlock* (40P01) entre duas escritas; as validações (inclusive as do envio e da aprovação, Task 8) rodam **depois** da trava. Toda escrita **incrementa `orc_exercicio.versao`** (importação, recálculo, receitas, teto e ciclo). As ações que vêm de formulário (teto, receitas, avançar, enviar, aprovar, rejeitar) mandam a `versao` lida e recebem a mensagem de concorrência se ela mudou (§10.2 item 4). **Exceção registrada ao item 4:** importação e recálculo são substituições inteiras e idempotentes; duas simultâneas são serializadas pela trava e o resultado é o de uma só, e o envio feito com a versão de antes delas é recusado.
- **Mensagens [PROVISÓRIAS]** (sem texto nos EPs; o UC04.17 ainda não é EP, GAP-ORC-004), exatas:
  - "Já existe um exercício para o ano <ano>.";
  - "Receitas só podem ser importadas por quem vê toda a Adm. Central." (R15);
  - "Texto não pode começar com =, + ou @." (cargo, observação, justificativa, TP e descrição);
  - "Arquivo maior que 1 MB.";
  - "As premissas do exercício mudaram durante a aprovação. Tente novamente." (R10);
  - "Informe um ano entre 2000 e 2099.";
  - "Não há exercício anterior para copiar.";
  - "Este exercício não pode ser alterado na situação <situação>.";
  - "As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento.";
  - "O orçamento foi recalculado." (§6.6);
  - "CC não é analítico ativo." / "Conta não permitida em pacote base zero." / "CC fora do seu escopo.";
  - "Cargo obrigatório." / "Quantidade inteira, de 1 a 9.999." / "Salário maior que zero." / "Salário mensal precisa ser menor que R$ 1.000.000,00." / "Informe um mês de 1 a 12." / "Mês de início depois do mês de saída.";
  - "Justificativa com menos de 10 caracteres." (§6.6) / "Prioridade obrigatória: Essencial, Importante ou Desejável." / "Informe Sim ou Não em Corrigir pelo IPCA." / "Distribuição obrigatória: Mensal ou Pontual." / "Valor unitário maior que zero.";
  - "Valor em formato inválido. Digite o número na célula, com até 2 casas decimais.";
  - "TP / versão obrigatório." / "Situação obrigatória: Confirmado ou Previsto." / "TP / versão repetido nas linhas <a> e <b>." / "Já existe receita do TP <tp> neste exercício." / "Valor do mês não pode ser negativo." / "Deseja realmente excluir a receita do TP <tp>?";
  - "A planilha tem erros. Nada foi importado." (resumo acima da lista);
  - "Planilha importada: <n> posições e <m> pacotes em <k> CCs, <r> receitas." (sucesso);
  - "Teto maior que a receita confirmada exige justificativa com pelo menos 15 caracteres." / "O teto precisa ser maior que zero.";
  - "Sem teto: não há receita confirmada nem teto manual." (semáforo vazio);
  - "Deseja realmente enviar o orçamento <ano> para aprovação?" / "Deseja realmente aprovar e oficializar o orçamento <ano>?" / "A justificativa da rejeição precisa ter pelo menos 15 caracteres." (C36);
  - "Quem enviou o orçamento para aprovação não pode aprová-lo." (D-P6-3);
  - "Selo: Digitado na transição" (C35, texto do selo das receitas).
- **Marca neutra:** a sigla da instituição não aparece em código, seed, telas nem testes do `orc`.
- **Tamanho:** PR de até cerca de 400 linhas de código de produção (§12.5).
- **Por tarefa:** branch `us-NNN-slug` e título `[US-NNN] …`; `Closes #n` só no PR que prova o último critério de aceite, os anteriores com `Refs #n`; labels `frente:A` e, quando couber, `migration`; commits com `Frente: A` e os trailers de coautoria; push, PR e merge só com confirmação do PO; antes de chamar o PO, o comentário "Revisão de código (12.12)" com as lentes da tarefa e no máximo 2 rodadas de correção.
- Textos de interface, mensagens e logs em português do Brasil.

## Review Focus

1. **Planilha recém-gerada ou salva por outro programa (LibreOffice, Google Sheets).** O modelo é gravado com `fullCalcOnLoad` e **sem valores em cache**, e as 300 linhas de cada aba têm fórmulas nas colunas cinzas. Esperado: a importação lê só as colunas de entrada (amarelas), ignora a linha cujas colunas de entrada estão todas vazias e nunca acusa "fórmula sem resultado" de coluna cinza. Teste na Task 4b.
2. **Número digitado como texto** ("7.500,00", "R$ 350", "1.5e3") ou com 3 casas. Esperado: erro na linha com a mensagem de formato; nunca interpretar "7.500" como 7,5. Teste na Task 4a.
3. **Reimportação parcial.** A GFIN reimporta a planilha de uma diretoria só (com os CCs dela) e depois o arquivo inteiro duas vezes. Esperado: só os CCs presentes no arquivo são substituídos, os outros ficam intactos, e duas importações iguais deixam o mesmo estado. Teste na Task 4b.
4. **Premissas alteradas depois da importação** (GRH preenche os benefícios, GFIN muda o reajuste). Esperado: a visão avisa, o envio é recusado até "Recalcular", e o recálculo muda só os valores, nunca as posições. Testes nas Tasks 6 e 8.
5. **Usuário com escopo pedindo outro CC pela URL** (`/orc/orcamento?cc=4.1.1`) ou chamando receitas, teto, recálculo e aprovação, inclusive com a ação concedida no catálogo. Esperado: CC fora do escopo responde 404 com a negação auditada; os casos de uso que não são por CC recusam no servidor (R15); a DIREX e o Auditor veem tudo. Testes nas Tasks 2, 3, 5, 6, 7 e 8, um por caso de uso.

---

## Rulings do planejamento

- **R1. O C1 e o C2 chegam por injeção.** Os casos de uso recebem `deps.estrutura` (`carregarIndiceEstrutura`, `listarArvoreCentrosCusto` e `listarArvoreContas` do C1) e `deps.custoPessoal` (as do C2), com os reais do `cad` como padrão. Os testes de unidade e de integração do `orc` usam `estruturaFinanceiraFalsa()` e `custoPessoalFalso()` do `cad`; os valores oficiais do motor são provados pela frente B (Task 11 do P4), nunca aqui. O E2E (Task 9) roda com os reais.
- **R2. Classificação como chave.** `cc` e `conta` são `text` com a classificação. Se uma recarga do `cad` inativar um CC ou uma conta já usados (R5 do P4), a visão mostra a linha com o selo "Inativo" e o envio é recusado com a lista ("CC não é analítico ativo." por linha); a GFIN reimporta. O teste fica na Task 8. A árvore da visão vem de `listarArvoreCentrosCusto(tx, { incluirInativos: true })`, convertida em `NoArvore` (com os inativos), para o `totalizarSerie` não lançar `NO_INEXISTENTE` com linha em CC inativo.
- **R3. Linhas calculadas.** `orc_linha` guarda, por posição, uma linha por componente do C2 (`LinhaComponente`: componente, conta, 12 meses) e, por pacote, uma linha na conta do pacote. A soma das linhas de uma posição é igual ao `total` da `SerieMensalComponentes` (sem *drift*).
- **R4. Pacote base zero (§6.6):** `valorAnual = (quantidade × valorUnitario) × (1 + IPCA/100, se corrigir)`, com um único Half-Even no fim (o produto por quantidade inteira é exato). Mensal: `distribuirEm12(valorAnual)` do kernel (diferença em dezembro). Pontual: o valor todo no mês de ocorrência. O IPCA vem das premissas do exercício (C2), nunca da aba Premissas da planilha.
- **R5. A aba Premissas e a aba Resumo da planilha não são importadas.** O sistema usa os parâmetros oficiais do exercício (C2). A importação lê `Pessoal`, `Pacotes base zero` e `Receitas`.
- **R6. Versão do layout pelos cabeçalhos.** O leitor do `ger` acha as colunas pelo nome do cabeçalho (linha 4). A importação faz **três chamadas** a `lerPlanilhaSegura`, uma por aba (`aba: 'Pessoal' | 'Pacotes base zero' | 'Receitas'`), com `colunas` = só as colunas de entrada da Task 4a e `linhaCabecalhoMax: 4`. Os `errosCelula` de cada chamada viram `ErroPlanilha` com a aba e entram no relatório como os erros de validação (nada é gravado). **Premissa do contrato:** o leitor só avalia as colunas pedidas, então fórmula sem resultado numa coluna cinza não gera erro; a frente A confirma isso na revisão de consumidor da Task 4a do P4 e, se não valer, abre issue de contrato antes da Task 4b. A importação exige os cabeçalhos exatos das colunas de entrada do layout `ADMC-ORC v1.0` (lista na Task 4a); cabeçalho ausente → "Planilha fora do layout ADMC-ORC v1.0: a aba <aba> precisa do cabeçalho, até a linha 4, com as colunas <lista>." (o leitor não diz qual coluna falta). Sem `colunasTexto`: um CC de dois segmentos ("4.4") pode vir como número da lista do Excel e é lido certo; TP que o Excel converteu em data é recusado na validação. Conferir a célula `Instruções!E1` pede uma leitura por célula que o leitor não tem: fica como issue não bloqueante para a frente B.
- **R7. Reimportação idempotente por CC (US-121):** numa transação, para cada CC presente nas abas Pessoal ou Pacotes, apaga as posições e os pacotes do exercício nesse CC e grava os do arquivo. Receitas: cada "TP / versão" do arquivo substitui a receita de mesmo TP no exercício; as outras ficam. Tudo ou nada: com qualquer erro, nada é gravado.
- **R8. Escopo (C25).** `ccEscopo` não nulo no usuário → escopo de subárvore (`centrosCustoAnaliticosSob(ccEscopo)` do índice do C1); nulo → Adm. Central inteira. O escopo vale por usuário, não por perfil: a validação do cadastro (P5, Task 6a) só aceita CC de escopo com o perfil Gestor de Diretoria. Com escopo, a visão mostra só os CCs do escopo, e receitas, teto, resultado e aprovação não aparecem.
- **R9. Recálculo.** `orc_exercicio.versao_premissas` guarda a `PremissasExercicio.versao` do último cálculo. Divergência → aviso na visão e envio recusado. "Recalcular" (`orc.orcamento:alterar`) refaz todas as linhas com as premissas atuais e audita a versão antes e depois.
- **R10. Oficialização.** Na mesma transação: confere as pré-condições do envio de novo, muda a situação, grava o snapshot (`orc_snapshot`, JSON canônico com `sha256`), chama `congelarPremissasExercicio(tx, contexto, ano)` (C2) e audita. Depois disso, o banco recusa qualquer escrita no exercício e no snapshot (triggers e `REVOKE`).
- **R11. Receitas na transição (C35).** Toda receita digitada (tela ou planilha) tem `origem = 'MANUAL_TRANSICAO'` e aparece com o selo. A substituição pelo rateio calculado do TP (US-073, F3) fica fora da trilha; o campo `origem` e o JSDoc deixam o caminho registrado.
- **R12. Semáforo pelo `cad`.** As faixas (70/85/95) são parâmetros do exercício no `cad`: `obterParametrosExercicio(ctx, ano)` e `classificarSemaforo` (Task 9a do P4). O painel só aparece sem escopo (R8, R15), e os perfis que o veem (GFIN, DIREX, AUDITOR) já têm `cad.parametros:consultar`. Usuário sem essa permissão vê o painel sem semáforo e o aviso "Sem permissão para ver as faixas do semáforo."; a página confere `ctx.permissoes` antes de chamar, para não gerar negação a cada visita. A Task 7 depende da Task 9a do P4 na `main`, sem issue nova.

- **R15. Escopo também nos casos de uso (não só na tela).** O catálogo é configurável, então a ação concedida não basta. Exigem `Escopo.tipo === 'TOTAL'` (`exigirEscopoTotal(escopo, funcionalidade, acao)`, que lança `ErroPermissao`: a `definirAcao` responde 403 com a mensagem padrão e audita, e a página responde 404, como o `exigir`): `recalcular`, `criarExercicio`, `avancarExercicio`, `definirTeto`, `listarReceitas`, `incluir/alterar/excluirReceita`, `enviarParaAprovacao`, `aprovarExercicio`, `rejeitarExercicio` e `listarTramites`. Com escopo, a negação é a mesma de quem não tem a ação. Na importação, usuário com escopo e aba Receitas preenchida → "Receitas só podem ser importadas por quem vê toda a Adm. Central.".
- **R16. Escopo falha fechado.** `ccEscopo` ausente do índice do C1 ou inativado → escopo `SUBARVORE` com conjunto vazio, nunca `TOTAL`. O `adm` exporta o leitor `obterEscopoCentroCusto(tx, usuarioId)` (Task 2); o valor gravado é a classificação exata (trim e NFC já feitos pelo P5) e passa a ser conferido contra o C1 no cadastro (Task 6). Os valores já gravados em dev que não existam no C1 caem nesta regra; não há dado de produção.
- **R17. Texto que vira fórmula.** Cargo, observação, justificativa, TP e descrição que começam com `=`, `+` ou `@` são recusados na validação ("Texto não pode começar com =, + ou @."); o `-` fica permitido (texto comum em descrições), e a exportação futura do `rel` escapa qualquer célula de texto, obrigação registrada na issue da Task 1.
- **R18. Cópia do exercício:** "exercício anterior" é o **maior ano menor que o novo** que existir, em qualquer situação.
- **R13. `AcaoConfirmada` copiada para `src/modules/orc/ui/`.** O componente do P5 mora em `adm/ui`, e o componente cliente não pode importar o `index.ts` do `adm` (que tem servidor). A Task 3 copia o arquivo com os testes e abre uma issue não bloqueante para a frente B levar o componente ao C3; quando ele chegar, `adm` e `orc` passam a usar o do `ger`. Custo se errado: um arquivo em dois lugares até lá.
- **R14. Assinaturas abreviadas.** Nas Interfaces, `ctx` é sempre `ContextoRequisicao` e `deps?` é sempre `Partial<DepsOrc>` (Task 2); a ação do C6 exigida vem no comentário da linha.

## Ordem e dependências

| # | PR | Depende de | Migration | Lentes extras (§12.12) |
| --- | --- | --- | --- | --- |
| 0 | C6: `exibirNoMenu` em `DeclaracaoFuncionalidade` (R24 do P4) | — | `AAAAMMDDHHMM_adm_exibir_no_menu` | type-design-analyzer |
| 1 | US-055 parte 1 (`Refs #77`): schema do `orc`, privilégios, travas no banco, catálogo e seed | 0 | `AAAAMMDDHHMM_orc_orcamento` | security-review |
| 1b | compartilhado: `prisma/seed.ts` registra `seedOrc` | 1 | — | — |
| 2 | US-121 parte 1 (`Refs #143 #77`): cálculo das linhas e recálculo | 1; **C1 e C2 (contratos) na `main`** | — | silent-failure-hunter |
| 3 | US-055 parte 2 (`Closes #77`): exercícios, cópia, avanço e seletor | 2 | — | security-review |
| 4a | US-121 parte 2 (`Refs #143`): validação da planilha (domínio) | 2 | — | — |
| 4b | US-121 parte 3 (`Closes #143`): importação, tela e relatório | 3, 4a; **`lerPlanilhaSegura` na `main`** (Task 4a do P4) | — | security-review |
| 5 | US-060 (`Closes #82`): receitas digitadas | 3 | — | security-review |
| 6 | US-058 (`Closes #80`): visão por CC com escopo; CC de escopo validado no `adm` | 4b | — | security-review |
| 7 | US-059 (`Closes #81`): teto, semáforo e resultado | 5, 6; **Task 9a do P4 (parâmetros e semáforo) na `main`** (R12) | — | — |
| 8 | US-061 (`Closes #83`): envio, aprovação, rejeição, oficialização e snapshot | 7 | — | security-review, silent-failure-hunter |
| 9 | E2E do P6 (`Refs #77 #80 #81 #82 #83 #143`) | 8; **C1 real, C2 real e seeds do `cad` na `main`** | — | — |

As dependências da frente B são o C1 e o C2 (contratos; Task 2), o `lerPlanilhaSegura` (Task 4b), os parâmetros por exercício com o semáforo (Task 9a do P4; Task 7) e o C1/C2 reais (Task 9). Se algum não estiver na `main` quando a tarefa começar, **ela para e o PO é avisado**; as Tasks 4a e 5 podem andar antes.

**Calendário:** o P6 precisa estar iniciado em 20/11 (marco do plano-mestre). A Task 0 e a Task 1 não dependem da frente B e podem começar logo depois do encerramento do P5. O C2 real chega por volta de 17/11 (P4); até lá, tudo roda com os falsos.

## Estrutura de arquivos

```
prisma/schema/orc.prisma · prisma/migrations/<AAAAMMDDHHMM>_orc_orcamento/       (Task 1)
src/modules/orc/domain/{exercicio,pacote,planilha,resultado,mensagens}.ts       (puros)
src/modules/orc/application/{calculo-linhas,exercicios,importacao,receitas,
  consolidacao,teto,aprovacao,escopo,deps,governanca}.ts                         (casos de uso)
src/modules/orc/application/{acoes-*,entrada-*}.ts                              (Server Actions e entradas)
src/modules/orc/infrastructure/{seed,snapshot}.ts                               (seed C6, JSON canônico)
src/modules/orc/ui/{seletor-exercicio,lista-exercicios,form-exercicio,form-importacao,
  relatorio-importacao,lista-receitas,form-receita,visao-cc,painel-teto,acoes-ciclo}.tsx
src/modules/orc/index.ts
src/app/(sistema)/orc/{exercicios,importacao,receitas,orcamento,aprovacao}/**/page.tsx
src/modules/adm/application/catalogo.ts (Task 0) · src/modules/adm/application/usuarios.ts (Tasks 2 e 6)
e2e/orc/*.spec.ts · e2e/aut/apoio.ts · e2e/global-setup.ts                       (Task 9)
```

---

### Task 0: C6 — `exibirNoMenu` em `DeclaracaoFuncionalidade` (R24 do P4)

A frente B precisa disso para que `cad.salarios` não apareça no menu (Task 12b do P4). É um acréscimo compatível ao C6.

**Files:**
- Modify: `src/modules/adm/application/catalogo.ts`, `src/modules/adm/application/instalar-funcionalidades.ts`, `src/modules/adm/application/catalogo-ativo.ts` (`listarCatalogoAtivo` filtra `exibirNoMenu`), `prisma/schema/adm.prisma` (`Funcionalidade.exibirNoMenu Boolean @default(true) @map("exibir_no_menu")`)
- Create: `prisma/migrations/<AAAAMMDDHHMM>_adm_exibir_no_menu/migration.sql`
- Test: `src/modules/adm/application/catalogo.test.ts`, os testes de integração do menu no `aut` (`carregarTelaPrincipal`) e `src/modules/adm/infrastructure/seed.int.test.ts`

**Interfaces:**
- Produces: `DeclaracaoFuncionalidade.exibirNoMenu?: boolean` (padrão `true`). Funcionalidade com `exibirNoMenu: false` não aparece no menu nem na busca do menu, mas as permissões dela valem normalmente.

- [ ] **Step 1: Testes que falham:**
  - `validarDeclaracoes` aceita `exibirNoMenu: false` e recusa valor que não seja booleano;
  - integração: uma funcionalidade instalada com `exibirNoMenu: false` e permitida ao perfil não aparece em `carregarTelaPrincipal`, e a vizinha com `true` aparece;
  - reinstalar a mesma declaração trocando `exibirNoMenu` atualiza o menu (idempotente).
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/adm && npx vitest run --project integracao src/modules/adm` → FAIL.
- [ ] **Step 3: Implementar.** O menu lê a tabela `funcionalidade` (`listarCatalogoAtivo`), então a coluna `exibir_no_menu boolean NOT NULL DEFAULT true` entra numa migration própria; `instalarFuncionalidades` grava o valor da declaração (padrão `true`). `db:deploy` e `migrate diff` no dev local (**escrevem** no 55432).
- [ ] **Step 4:** suíte do `adm` + lint + typecheck → PASS.
- [ ] **Step 5: PR** "[C6] exibirNoMenu nas funcionalidades do catálogo", labels `frente:A`, `contrato` e `migration`, `Refs #71` (a issue de contrato da frente B, se já existir). Lentes: plano/spec, testes e `type-design-analyzer`.

### Task 1: Schema do `orc`, privilégios, travas no banco, catálogo e seed (US-055 parte 1, `Refs #77`)

**Files:**
- Create: `prisma/schema/orc.prisma`, `prisma/migrations/<AAAAMMDDHHMM>_orc_orcamento/migration.sql`
- Create: `src/modules/orc/infrastructure/seed.ts`, `src/modules/orc/domain/mensagens.ts`
- Modify: `src/modules/orc/index.ts`
- Test: `src/modules/orc/infrastructure/privilegios.int.test.ts`, `src/modules/orc/infrastructure/travas.int.test.ts`, `src/modules/orc/infrastructure/seed.int.test.ts`

**Modelos** (nomes Prisma em PascalCase, tabelas com `@@map`):
- **`OrcamentoExercicio` (`orc_exercicio`):** `id` uuid; `ano` int único (`CHECK 2000..2099`); `situacao` text (`CHECK IN ('RASCUNHO','EM_ELABORACAO','EM_APROVACAO','OFICIALIZADO')`, padrão `RASCUNHO`); `tetoManual` NUMERIC(15,2)? (`CHECK > 0`); `tetoJustificativa` text?; `versaoPremissas` int?; `enviadoPor` uuid?; `versao` int padrão 0; `criadoEm`, `atualizadoEm`, `oficializadoEm?`.
- **`PosicaoOrcada` (`orc_posicao`):** `id`; `exercicioId` (FK); `cc` text; `cargo` text (`CHECK char_length BETWEEN 1 AND 120`, C34); `quantidade` int (`CHECK BETWEEN 1 AND 9999`, a `QUANTIDADE_MAXIMA` do C2); `salarioMensal` NUMERIC(15,2) (`CHECK > 0 AND < 1000000`, o limite do `validarPosicao` do C2; sem cifra: D-P6-1); `mesInicio`, `mesSaida` (`CHECK 1 <= mes_inicio <= mes_saida <= 12`); `observacao` text? (≤ 500); `origem` (`'IMPORTACAO' | 'COPIA'`); `importacaoId` uuid?.
- **`PacoteBaseZero` (`orc_pacote`):** `id`; `exercicioId`; `cc`; `conta`; `justificativa` text (`CHECK char_length(btrim(justificativa)) >= 10`); `prioridade` (`'ESSENCIAL' | 'IMPORTANTE' | 'DESEJAVEL'`); `quantidade` int ≥ 1; `valorUnitario` NUMERIC(15,2) > 0; `corrigirIpca` boolean; `distribuicao` (`'MENSAL' | 'PONTUAL'`); `mesOcorrencia` int? (`CHECK (distribuicao = 'PONTUAL') = (mes_ocorrencia IS NOT NULL)` e `1..12`); `origem`; `importacaoId?`.
- **`LinhaOrcada` (`orc_linha`):** `id`; `exercicioId`; `cc`; `conta`; `origem` (`'PESSOAL' | 'BASE_ZERO'`); `componente` text? (código do C2 nas linhas de pessoal); `posicaoId` uuid? (FK `ON DELETE CASCADE`); `pacoteId` uuid? (FK `ON DELETE CASCADE`); `meses` NUMERIC(15,2)[] (`CHECK cardinality(meses) = 12`); `total` NUMERIC(15,2). `CHECK` de exclusividade: `PESSOAL` ⇔ `posicao_id IS NOT NULL AND pacote_id IS NULL`; `BASE_ZERO` ⇔ o contrário.
- **`ReceitaRateio` (`orc_receita`):** `id`; `exercicioId`; `tp` text (1..60); `descricao` text (≤ 200); `situacao` (`'CONFIRMADO' | 'PREVISTO'`); `origem` text padrão `'MANUAL_TRANSICAO'` (`CHECK IN ('MANUAL_TRANSICAO')` na trilha, R11); `meses` NUMERIC(15,2)[] (12, `CHECK 0 <= ALL(meses)`); `total`; `versao`; `importacaoId?`. Único (`exercicio_id`, `tp`).
- **`ImportacaoPlanilha` (`orc_importacao`):** `id`; `exercicioId`; `arquivoNome`; `arquivoSha256`; `resumo` jsonb; `criadoPor` uuid; `criadoEm`.
- **`TramiteExercicio` (`orc_tramite`):** `id`; `exercicioId`; `de`; `para`; `usuarioId`; `justificativa` text?; `em`.
- **`SnapshotExercicio` (`orc_snapshot`):** `exercicioId` pk (FK); `geradoEm`; `sha256` char(64); `conteudo` jsonb.

**Privilégios do `sgo_app`** (o `sgo_sync` fica sem nada em todas):

| Tabela | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `orc_exercicio` | ✓ | ✓ | só as colunas `situacao`, `teto_manual`, `teto_justificativa`, `versao_premissas`, `enviado_por`, `versao`, `atualizado_em` e `oficializado_em` (o ano nunca muda) | — |
| `orc_posicao`, `orc_pacote`, `orc_linha`, `orc_receita` | ✓ | ✓ | ✓ | ✓ |
| `orc_importacao`, `orc_tramite`, `orc_snapshot` | ✓ | ✓ | — | — |

**Triggers** (todos leem o exercício com `FOR SHARE`, para não depender só da trava consultiva):
- `orc_exige_editavel` (BEFORE INSERT/UPDATE/DELETE em `orc_posicao`, `orc_pacote`, `orc_linha`, `orc_receita`, e BEFORE INSERT em `orc_importacao`): recusa quando o exercício está `EM_APROVACAO` ou `OFICIALIZADO` (`RAISE EXCEPTION USING ERRCODE = 'P0001'`, mensagem `orc.exercicio_nao_editavel`). No UPDATE, confere o exercício de `OLD` **e** o de `NEW` (mover a linha de exercício não escapa da trava).
- `orc_ciclo_exercicio` (BEFORE UPDATE/DELETE em `orc_exercicio`):
  - recusa qualquer mudança com `OLD.situacao = 'OFICIALIZADO'`;
  - mudança de `situacao` só pelas transições da §6.2 (`RASCUNHO→EM_ELABORACAO`, `EM_ELABORACAO→EM_APROVACAO`, `EM_APROVACAO→EM_ELABORACAO`, `EM_APROVACAO→OFICIALIZADO`);
  - em `EM_APROVACAO`, só mudam `situacao`, `versao`, `atualizado_em`, `enviado_por` e `oficializado_em`.
- `orc_tramite_guarda` (BEFORE INSERT em `orc_tramite`): recusa trâmite de exercício `OFICIALIZADO` cujo `para` não seja `OFICIALIZADO` (o trâmite da oficialização entra na mesma transação).
- `orc_snapshot_unico` (BEFORE INSERT em `orc_snapshot`): exige o exercício `OFICIALIZADO` na mesma transação.

**Catálogo (C6), módulo `ADM_CENTRAL`, grupo "Orçamento da Adm. Central"** [PROVISÓRIO, D-P6-4]:

| Código | Nome | Rota | Ações | Perfis padrão |
| --- | --- | --- | --- | --- |
| `orc.orcamento` | Orçamento da Adm. Central | `/orc/orcamento` | consultar, alterar | GFIN: as duas; DIREX, AUDITOR, GESTOR_DIRETORIA: consultar |
| `orc.exercicios` | Exercícios | `/orc/exercicios` | consultar, incluir, alterar | GFIN: todas; DIREX, AUDITOR: consultar |
| `orc.importacao` | Importar planilha | `/orc/importacao` | consultar, executar | GFIN: as duas (D-P6-6) |
| `orc.receitas` | Receitas – Rateio dos TPs | `/orc/receitas` | consultar, incluir, alterar, excluir | GFIN: todas; DIREX, AUDITOR: consultar |
| `orc.aprovacao` | Envio e aprovação | `/orc/aprovacao` | consultar, executar, aprovar | GFIN: consultar, executar; DIREX: consultar, aprovar; AUDITOR: consultar |

Cada funcionalidade tem `ajuda` com uma frase do que a tela faz (o `seed.int.test.ts` confere que não está vazia).

- [ ] **Step 1: Testes que falham:**
  - **matriz de privilégios** acima, por `information_schema.table_privileges`, para `sgo_app` e `sgo_sync`, afirmando também a ausência de `TRUNCATE`, `TRIGGER` e `REFERENCES` (o `TRUNCATE` passaria por cima dos triggers de DELETE);
  - **travas:**
    - exercício `EM_APROVACAO` → `INSERT` em `orc_posicao` e em `orc_importacao` como `sgo_app` falham com `orc.exercicio_nao_editavel`;
    - `EM_APROVACAO` → `UPDATE orc_exercicio SET teto_manual = 1` e `SET versao_premissas = 9` falham; `SET situacao = 'EM_ELABORACAO'` passa;
    - `RASCUNHO` → `UPDATE … SET situacao = 'OFICIALIZADO'` falha (transição fora da §6.2);
    - `OFICIALIZADO` → qualquer `UPDATE`/`DELETE` em `orc_exercicio` falha; `DELETE` em `orc_linha` e em `orc_receita` dele falha; `UPDATE orc_receita SET exercicio_id = <editável>` de uma receita dele falha;
    - `INSERT` em `orc_tramite` de exercício `OFICIALIZADO` com `para = 'EM_ELABORACAO'` falha;
    - `INSERT` em `orc_snapshot` de exercício `RASCUNHO` falha; `DELETE FROM orc_snapshot` como `sgo_app` → `permission denied`;
  - **CHECKs:** `meses` com 11 posições; `mes_inicio 5, mes_saida 4`; pacote `PONTUAL` sem mês; receita com mês negativo; linha `PESSOAL` com `pacote_id` → todos recusados;
  - **seed:** as 5 funcionalidades com o módulo `ADM_CENTRAL`, as ações e os perfis da tabela; duas execuções não mudam nada; o Administrador não recebe permissão do `orc` (RN_SEED_003 só reserva `ADMINISTRACAO`, então conferir que o padrão do Administrador não inclui o `orc`).
- [ ] **Step 2:** `npx vitest run --project integracao src/modules/orc` → FAIL.
- [ ] **Step 3: Implementar.** Schema; a parte do Prisma da migration sai de `npx prisma migrate diff --from-schema <schema sem o orc> --to-schema prisma/schema --script`, que roda **sem banco**; triggers e `REVOKE`/`GRANT` à mão; `seedOrc(tx)` chama `instalarFuncionalidades(tx, FUNCIONALIDADES_ORC)` do `adm` e é exportada pelo `index.ts`. `mensagens.ts` nasce com os textos que a Task 1 usa, e cada tarefa acrescenta os seus. Como a revisão de segurança pediu, o trâmite e o snapshot só entram na transação que mudou a situação (`xmin` da linha do exercício), e a oficialização exige snapshot e trâmite no commit (constraint trigger adiado).
- [ ] **Step 4:** `npm run db:deploy` no dev local (**escreve** no 55432); `migrate diff` sem diferença; suíte do `orc` + `test:arq` + lint + typecheck → PASS.
- [ ] **Step 5: PR** "[US-055] Schema do orçamento da Adm. Central, travas no banco e catálogo (parte 1/2)", `Refs #77`, labels `frente:A` e `migration`. Junto (com confirmação do PO), abrir para a frente B:
  - a issue **não bloqueante** de leitura de célula (R6);
  - a issue **não bloqueante** de escapar texto que começa com `=`, `+`, `-` ou `@` nas exportações (R17), citando o vetor que a validação deixa passar por permitir o `-` (ex.: `-2+3+cmd|' /C calc'!A0`);
  - a issue **não bloqueante** de levar a `AcaoConfirmada` ao C3 (R13).

  Lentes: plano/spec, testes, segurança e `security-review`.

### Task 1b: PR compartilhado — `seedOrc` no orquestrador

- [ ] **Step 1:** `prisma/seed.ts` chama `seedOrc` depois de `seedAdm` e das seeds do `cad`, na mesma transação do orquestrador. `npm run db:seed` duas vezes no dev local (**escreve** no 55432): a segunda não muda nada (`seed.int.test.ts` já prova; aqui, conferir à mão o menu "Administração Central" para o usuário GFIN de dev).
- [ ] **Step 2: PR** "Compartilhado do P6: seed do orc no orquestrador", labels `compartilhado` e `frente:A`, `Refs #77`. Lentes: plano/spec.

### Task 2: Cálculo das linhas e recálculo do exercício (US-121 parte 1, `Refs #143 #77`)

**Files:**
- Create: `src/modules/orc/domain/pacote.ts`, `src/modules/orc/application/{deps,escopo,calculo-linhas}.ts`
- Modify: `src/modules/adm/index.ts`, `src/modules/adm/application/usuarios.ts` (`obterEscopoCentroCusto`)
- Test: `src/modules/orc/domain/pacote.test.ts`, `src/modules/orc/application/{calculo-linhas,escopo}.int.test.ts`

**Interfaces:**
- Consumes: C2 (`calcularCustoPosicao`, `obterPremissasExercicio`, `PremissasExercicio`, `SerieMensalComponentes`, `custoPessoalFalso`, `premissasExemplo`); C1 (`carregarIndiceEstrutura`, `estruturaFinanceiraFalsa`); `distribuirEm12`, `Dinheiro`, `Percentual`, `Resultado` do kernel.
- Produces:

```ts
// domain/pacote.ts (puro)
export type Prioridade = 'ESSENCIAL' | 'IMPORTANTE' | 'DESEJAVEL';
export type DadosPacote = {
  quantidade: number; valorUnitario: Dinheiro; corrigirIpca: boolean;
  distribuicao: 'MENSAL' | 'PONTUAL'; mesOcorrencia: number | null;
};
// R4: um Half-Even no fim; mensal por distribuirEm12; pontual no mês.
export function calcularPacote(p: DadosPacote, ipca: Percentual): { valorAnual: Dinheiro; meses: readonly Dinheiro[] };

// application/deps.ts
export type DepsOrc = {
  cliente: PrismaClient;
  agora: () => Date;
  estrutura: { carregarIndiceEstrutura: typeof carregarIndiceEstrutura; listarArvoreCentrosCusto: typeof listarArvoreCentrosCusto;
    listarArvoreContas: typeof listarArvoreContas };
  obterEscopo: typeof obterEscopoCentroCusto; // do adm (R16)
  custoPessoal: { calcularCustoPosicao: typeof calcularCustoPosicao; obterPremissasExercicio: typeof obterPremissasExercicio;
    garantirPremissasExercicio: typeof garantirPremissasExercicio; congelarPremissasExercicio: typeof congelarPremissasExercicio };
};
export function resolverDeps(deps?: Partial<DepsOrc>): DepsOrc; // padrão: prisma e as funções reais do cad

// application/escopo.ts (R8, R15, R16). O CC de escopo vem do adm: acréscimo ao index do adm nesta tarefa.
export type Escopo = { tipo: 'TOTAL' } | { tipo: 'SUBARVORE'; raiz: string; ccs: ReadonlySet<string> };
export function resolverEscopo(tx: TxCliente, ctx: ContextoRequisicao, indice: IndiceEstruturaFinanceira, deps: Pick<DepsOrc, 'obterEscopo'>): Promise<Escopo>;
// adm: o leitor fica em src/modules/adm/application/escopo-cc.ts (usuário inexistente lança, nunca vira "sem escopo").
export function exigirEscopoTotal(escopo: Escopo, funcionalidade: string, acao: Acao): void; // lança ErroPermissao (R15)
// Sem carregar o índice; roda ANTES do travarExercicio: ordem permissão → escopo → trava (não vaza a existência do exercício).
export function exigirSemEscopo(tx: TxCliente, ctx: ContextoRequisicao, deps: Pick<DepsOrc, 'obterEscopo'>, funcionalidade: string, acao: Acao): Promise<void>;
// adm (index.ts): export function obterEscopoCentroCusto(tx: TxCliente, usuarioId: string): Promise<string | null>;

// application/calculo-linhas.ts (interno ao módulo; recebe o tx de quem chama)
export type ResumoRecalculo = { posicoes: number; pacotes: number; linhas: number; versaoPremissas: number; avisos: readonly string[] };
// Lança ErroRecalculo (erros por campo) em vez de devolver falha: dentro da transação de quem chama, desfaz a cópia e a
// importação já gravadas; o caso de uso converte em falha fora da transação. Confere a situação.
export function recalcularExercicio(tx: TxCliente, exercicioId: string, deps: DepsOrc): Promise<ResumoRecalculo>;
export class ErroRecalculo extends ErroDominio { readonly erros: readonly ErroCampo[] }
export function travarExercicio(tx: TxCliente, id: string): Promise<ExercicioTravado>; // FOR UPDATE; id fora do uuid = inexistente
// Caso de uso da ação "Recalcular" (orc.orcamento:alterar): trava o exercício, exige editável, recalcula e audita a versão antes e depois.
export function recalcular(ctx: ContextoRequisicao, exercicioId: string, deps?: Partial<DepsOrc>): Promise<Resultado<ResumoRecalculo>>;
```

- [ ] **Step 1: Testes de domínio (falham), em `pacote.test.ts`:**
  - 12 × 350,00 com IPCA de 4% → anual 4.368,00 e 364,00 em cada mês;
  - 1 × 1.000,00 com IPCA de 4%, mensal → anual 1.040,00; janeiro a novembro 86,67; dezembro 86,63; soma dos meses = anual;
  - 3 × 99,99 sem IPCA, pontual em julho → 299,97 em julho e zero nos outros meses;
  - 1 × 0,50 com IPCA de 5% → 0,525 → 0,52, e 1 × 2,50 com 5% → 2,625 → 2,62 (Half-Even; Half-Up daria 0,53 e 2,63);
  - pontual sem mês, ou mensal com mês → erro de programação (`ErroDominio('orc.pacote_invalido')`: a validação de entrada fica na Task 4a).
- [ ] **Step 2: Integração (falha), em `calculo-linhas.int.test.ts`,** com `custoPessoalFalso([premissasExemplo(2027)])` e `estruturaFinanceiraFalsa()`:
  - uma posição (2 × 7.500,00, meses 1 a 12) e um pacote → as linhas de pessoal são as do falso (uma por `LinhaComponente`, com `posicaoId`, `componente` e `conta`), e a do pacote está na conta dele; `versaoPremissas` do exercício = `premissasExemplo(2027).versao`;
  - o falso registrou uma chamada por posição, com a `PosicaoPessoal` montada da posição gravada;
  - recalcular de novo não duplica linhas (apaga e regrava as do exercício);
  - `calcularCustoPosicao` devolvendo `{ ok: false }` → `recalcularExercicio` devolve o erro com o CC e o cargo da posição, e nada é gravado;
  - premissas do ano inexistentes (`obterPremissasExercicio` → `null`) → `ErroDominio('orc.premissas_inexistentes')`;
  - **§10.2 item 6:** a soma de todas as linhas é igual à soma dos `total` das séries mais os anuais dos pacotes;
  - **`recalcular`:** sem `orc.orcamento:alterar` → 403 auditado; usuário com escopo e com a ação → `orc.fora_do_escopo` auditado (R15); exercício `EM_APROVACAO` → "Este exercício não pode ser alterado na situação Em Aprovação."; com permissão → mensagem "O orçamento foi recalculado.", Histórico com `versaoPremissas` antes e depois, `unidadeId` nulo e `versao` do exercício incrementada; auditoria falhando → nada muda;
  - **Review Focus 4 ("nunca as posições"):** trocar as premissas do falso (outra `versao` e outro reajuste) e recalcular → posições e pacotes com os mesmos ids e campos, linhas com os valores novos;
  - **`escopo.int.test.ts` (R16):** `ccEscopo` nulo → `TOTAL`; `'4.3'` → `SUBARVORE` com os analíticos do falso sob 4.3; `ccEscopo` ausente do índice ou inativo → `SUBARVORE` vazio, nunca `TOTAL`; `exigirEscopoTotal` com escopo → negação auditada.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar.** A `PosicaoPessoal` do C2 recebe `quantidade`, `salarioMensal`, `mesInicio` e `mesSaida` da posição, sem adicional (C34: cargo em texto livre, sem cadastro). As linhas são gravadas com `createMany`.
- [ ] **Step 5:** suíte do `orc` + lint + typecheck → PASS.
- [ ] **Step 6: PR** "[US-121] Cálculo das linhas do orçamento pelo motor de custo de pessoal (parte 1/3)", `Refs #143 #77`. Lentes: plano/spec, testes, segurança e `silent-failure-hunter`.

### Task 3: Exercícios — criação, cópia, avanço e seletor (US-055 parte 2, `Closes #77`)

**Files:**
- Create: `src/modules/orc/domain/exercicio.ts`, `src/modules/orc/application/{exercicios,governanca,entrada-exercicio,acoes-exercicios}.ts`
- Create: `src/modules/orc/ui/{seletor-exercicio,lista-exercicios,form-exercicio}.tsx`, `src/app/(sistema)/orc/exercicios/page.tsx`
- Test: `src/modules/orc/domain/exercicio.test.ts`, `src/modules/orc/application/exercicios.int.test.ts`, `src/modules/orc/ui/exercicios.test.ts`

**Interfaces:**
- Consumes: Task 2 (`recalcularExercicio`, `DepsOrc`); C2 `garantirPremissasExercicio`.
- Produces:

```ts
// domain/exercicio.ts (puro)
export type SituacaoExercicio = 'RASCUNHO' | 'EM_ELABORACAO' | 'EM_APROVACAO' | 'OFICIALIZADO';
export type EventoCiclo = 'AVANCAR' | 'ENVIAR' | 'APROVAR' | 'REJEITAR';
export const ROTULO_SITUACAO: Readonly<Record<SituacaoExercicio, string>>; // 'Rascunho', 'Em Elaboração', 'Em Aprovação', 'Oficializado'
// §6.2: RASCUNHO -AVANCAR-> EM_ELABORACAO -ENVIAR-> EM_APROVACAO -APROVAR-> OFICIALIZADO; EM_APROVACAO -REJEITAR-> EM_ELABORACAO
export function transicionar(de: SituacaoExercicio, evento: EventoCiclo): Resultado<SituacaoExercicio>;
export function editavel(s: SituacaoExercicio): boolean; // RASCUNHO e EM_ELABORACAO
export function anoPadrao(existentes: readonly number[], hoje: Date): number; // maior existente + 1; sem nenhum, ano de hoje + 1
export function exercicioOrigemDaCopia(existentes: readonly number[], novo: number): number | null; // R18: maior ano menor que o novo

// application/governanca.ts (compartilhado pelas tarefas com escrita)
export function recusarCamposBlindados(ctx: ContextoRequisicao, funcionalidade: string, bruto: unknown, campos: readonly string[], deps: DepsOrc): Promise<void>;

// application/exercicios.ts
export type ResumoExercicio = { id: string; ano: number; situacao: SituacaoExercicio; rotuloSituacao: string; versao: number }; // premissas desatualizadas: só na visão (Task 6)
export function listarExercicios(ctx: ContextoRequisicao, deps?: Partial<DepsOrc>): Promise<readonly ResumoExercicio[]>; // orc.orcamento:consultar (o seletor usa)
export function criarExercicio(ctx: ContextoRequisicao, entrada: { ano: number; forma: 'EM_BRANCO' | 'COPIA' }, deps?: Partial<DepsOrc>):
  Promise<Resultado<{ id: string; copiadas: { posicoes: number; pacotes: number }; puladas: { posicoes: number; pacotes: number } }>>; // orc.exercicios:incluir
export function avancarExercicio(ctx: ContextoRequisicao, bruto: unknown, deps?: Partial<DepsOrc>): Promise<Resultado<void>>; // orc.exercicios:alterar; { id, versao } estrito, com a ORIGEM BLINDADA conferida
```

- [ ] **Step 1: Testes de domínio (falham):** todas as transições válidas da §6.2; `transicionar('RASCUNHO', 'ENVIAR')` e `('OFICIALIZADO', 'REJEITAR')` → erro com "Este exercício não pode ser alterado na situação …"; `editavel`; `anoPadrao([2026, 2027], 2026-11-02)` → 2028 e `anoPadrao([], 2026-11-02)` → 2027.
- [ ] **Step 2: Integração (falha):**
  - **em branco:** cria 2027 em `RASCUNHO`, chama `garantirPremissasExercicio(tx, contexto, 2027)` (o falso registra) e audita INSERCAO;
  - **ano repetido:** "Já existe um exercício para o ano 2027."; **duas criações simultâneas** do mesmo ano → uma cria e a outra recebe a mesma mensagem (P2002 traduzido);
  - **ano 1999 ou 2100** → "Informe um ano entre 2000 e 2099.";
  - **cópia:** com 2026 tendo 2 posições e 3 pacotes, criar 2027 copiando → posições e pacotes com `origem = 'COPIA'`, os mesmos salários e valores unitários, e as linhas recalculadas com as premissas de 2027 (versão do falso de 2027); receitas e teto **não** são copiados; o exercício de origem não muda;
  - **cópia com CC inativo** (D-P6-5): índice do falso sem o CC de uma posição → ela é pulada, `puladas.posicoes = 1`, e o Histórico registra a contagem;
  - **cópia sem exercício anterior** → "Não há exercício anterior para copiar."; com 2025 e 2027 existentes, criar 2028 copiando → copia de 2027; criar 2026 copiando → copia de 2025 (R18);
  - **avançar:** `RASCUNHO` → `EM_ELABORACAO`, com `orc_tramite` e Histórico; `versao` velha → mensagem de concorrência;
  - **§10.2:** sem `orc.exercicios:incluir` → 403 auditado; usuário com escopo e com a ação → `orc.fora_do_escopo` (R15); auditoria falhando → nada criado; *payload* com `situacao` → `orc.violacao_governanca` auditado; o mesmo conjunto (403, escopo, auditoria falhando) para `avancarExercicio`; o Histórico sai com `unidadeId` nulo mesmo com TP no contexto.
- [ ] **Step 3: Testes de tela (falham):** a página exige `orc.exercicios:consultar` (404 sem ela, negação auditada); o botão "Novo exercício" só com `incluir`; o formulário vem com o `anoPadrao` e as opções "Em branco" e "Copiando o exercício anterior"; o seletor (`SeletorExercicio`) lista os anos como links `?ano=<ano>` com a situação, e marca o atual com `aria-current="page"`.
- [ ] **Step 4:** testes → FAIL.
- [ ] **Step 5: Implementar** (padrão das telas de usuário do P5: `Formulario` do C3, avisos pós-redirect por `?aviso=` com texto fixo; `AcaoConfirmada` conforme a R13).
- [ ] **Step 6:** suíte + lint + typecheck + `test:arq` → PASS.
- [ ] **Step 7: PR** "[US-055] Exercícios do orçamento da Adm. Central: criação, cópia e seletor (parte 2/2)", `Closes #77`. Lentes: plano/spec, testes, segurança e `security-review`.

### Task 4a: Validação da planilha-modelo (US-121 parte 2, `Refs #143`)

**Files:**
- Create: `src/modules/orc/domain/planilha.ts`
- Test: `src/modules/orc/domain/planilha.test.ts`

**Interfaces:**
- Consumes: `LinhaPlanilha` e `ErroLinha` do `ger` **como tipos copiados no domínio** (o domínio não importa o `ger`): `{ numero: number; celulas: Readonly<Record<string, string | null>> }` e `{ linha: number; coluna?: string; mensagem: string }`.
- Produces:

```ts
// Colunas de entrada do layout ADMC-ORC v1.0 (R6), exatamente como os cabeçalhos da linha 4.
export const LAYOUT = 'ADMC-ORC v1.0';
export const COLUNAS_PESSOAL = ['CC analítico', 'Cargo', 'Quantidade', 'Salário mensal (R$)', 'Mês de início (1–12)', 'Mês de saída (1–12)', 'Observação'] as const;
export const COLUNAS_PACOTES = ['CC analítico', 'Conta analítica', 'Atividade / justificativa (mín. 10 caracteres)', 'Prioridade', 'Quantidade',
  'Valor unitário (R$)', 'Corrigir pelo IPCA?', 'Distribuição', 'Mês (se pontual)'] as const;
export const COLUNAS_RECEITAS = ['TP / versão', 'Descrição', 'Situação', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
export const RAIZES_CONTAS_PESSOAL = ['4.1.1.1', '4.1.1.2'] as const; // §6.6 [PROVISÓRIA]

export type ConsultaEstrutura = { ccAnalitico(cc: string): boolean; contaPermitida(conta: string): boolean; noEscopo(cc: string): boolean };
export type PosicaoValidada = { linha: number; cc: string; cargo: string; quantidade: number; salarioMensal: Dinheiro; mesInicio: number; mesSaida: number; observacao: string | null };
export type PacoteValidado = { linha: number; cc: string; conta: string; justificativa: string; prioridade: Prioridade } & DadosPacote;
export type ReceitaValidada = { linha: number; tp: string; descricao: string; situacao: 'CONFIRMADO' | 'PREVISTO'; meses: readonly Dinheiro[] };
export type ConteudoPlanilha = { posicoes: readonly PosicaoValidada[]; pacotes: readonly PacoteValidado[]; receitas: readonly ReceitaValidada[] };
export type ErroPlanilha = ErroLinha & { aba: 'Pessoal' | 'Pacotes base zero' | 'Receitas' };

// Uma linha de receita, reaproveitada pela tela de receitas (Task 5).
export function validarReceita(celulas: Readonly<Record<string, string | null>>): Resultado<Omit<ReceitaValidada, 'linha'>>;
export type LimitesPlanilha = { quantidadeMaxima: number }; // QUANTIDADE_MAXIMA do C2, passada pela aplicação
export function validarPlanilha(
  abas: { pessoal: readonly LinhaPlanilha[]; pacotes: readonly LinhaPlanilha[]; receitas: readonly LinhaPlanilha[] },
  estrutura: ConsultaEstrutura,
  limites: LimitesPlanilha,
): { ok: true; conteudo: ConteudoPlanilha } | { ok: false; erros: readonly ErroPlanilha[] };
// Número de célula como o leitor do ger entrega (numérico → "1234.56"); texto com vírgula, ponto de milhar, "R$" ou expoente → erro de formato.
// Aceita também o float que o LibreOffice grava ("1234.5599999999999"): número com até 17 dígitos significativos cuja diferença
// para o valor com 2 casas é menor que 1e-9 vira esse valor; senão, 'INVALIDO'. Comparação feita com decimal.js
// (via Dinheiro/kernel), nunca com parseFloat (o lint barra em domain/).
export function lerValor(celula: string | null): Dinheiro | null | 'INVALIDO';
```

- [ ] **Step 1: Testes que falham** (todos com o número da linha da planilha e o nome da coluna no erro):
  - **linha vazia:** todas as colunas de entrada vazias → ignorada, sem erro;
  - **Pessoal:** CC fora do índice → "CC não é analítico ativo."; CC fora do escopo → "CC fora do seu escopo."; cargo vazio ou com 121 caracteres; quantidade 0, 10000, 1.5 ou "2 pessoas" (limite pela `QUANTIDADE_MAXIMA` do C2, importada pela aplicação e passada ao domínio); salário 0 e 1.000.000,00; mês 13; início 5 e saída 4; observação vazia → `null`;
  - **Pacotes:** conta `4.1.1.1.001` → "Conta não permitida em pacote base zero."; justificativa "  curta  " (menos de 10 depois do `trim`); prioridade "urgente"; prioridade " importante " → `IMPORTANTE` (sem diferença de caixa e espaços); "Corrigir pelo IPCA?" vazio; "Pontual" sem mês ou com mês 0; "Mensal" com mês preenchido → mês ignorado;
  - **Receitas:** TP vazio; situação "confirmado" → `CONFIRMADO`; mês vazio → 0,00; mês negativo → erro; TP repetido → "TP / versão repetido nas linhas 7 e 9." nas duas linhas;
  - **`lerValor` (Review Focus 2):** `"7500"` → 7.500,00; `"7500.5"` → 7.500,50; `"1234.5599999999999"` → 1.234,56; `"7500.004999999"` → `'INVALIDO'` (fronteira da tolerância); `"7.500"`, `"7.500,00"`, `"R$ 350"`, `"1.5e3"`, `"10.123"` → `'INVALIDO'`; `""` e `null` → `null`; salário `"-100"` → "Salário maior que zero.";
  - **R17:** cargo `=1+1`, justificativa `+cmd` e TP `@x` → "Texto não pode começar com =, + ou @."; descrição `- reposição` aceita;
  - **acumula:** uma planilha com 3 erros em abas diferentes devolve os 3, ordenados por aba e linha.
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/orc` → FAIL.
- [ ] **Step 3: Implementar.** Normalização de texto: `trim` e NFC; comparação de opções sem caixa e sem acento, por `Map` ("constructor" não vira opção). Tetos para o cálculo caber em NUMERIC(15,2): valor unitário abaixo de R$ 100.000.000,00 e mês de receita abaixo de R$ 100.000.000.000,00. Limites iguais aos CHECKs da Task 1, com mensagem: justificativa de 10 a 1.000 caracteres ("Justificativa com mais de 1.000 caracteres."), quantidade do pacote de 1 a 9.999, observação até 500, TP até 60 e descrição até 200.
- [ ] **Step 4:** suíte + lint + typecheck → PASS.
- [ ] **Step 5: PR** "[US-121] Validação da planilha-modelo linha a linha (parte 2/3)", `Refs #143`. Lentes: plano/spec e testes.

### Task 4b: Importação da planilha, tela e relatório (US-121 parte 3, `Closes #143`)

**Files:**
- Create: `src/modules/orc/application/{importacao,entrada-importacao,acoes-importacao}.ts`
- Create: `src/modules/orc/ui/{form-importacao,relatorio-importacao}.tsx`, `src/app/(sistema)/orc/importacao/page.tsx`
- Test: `src/modules/orc/application/importacao.int.test.ts`, `src/modules/orc/ui/importacao.test.ts`, `src/modules/orc/application/planilhas-teste.ts` (monta .xlsx com ExcelJS, só para testes)

**Interfaces:**
- Consumes: Tasks 2 (`resolverEscopo`), 3 e 4a; `lerPlanilhaSegura` de `@/modules/ger/servidor` (três chamadas, R6).
- Produces:

```ts
// application/importacao.ts — orc.importacao:executar
export type ResultadoImportacao = { posicoes: number; pacotes: number; ccs: number; receitas: number; resumoPorCc: readonly { cc: string; posicoes: number; pacotes: number; total: Dinheiro }[] };
export function importarPlanilha(ctx: ContextoRequisicao, entrada: { exercicioId: string; arquivo: { nome: string; conteudo: Uint8Array } },
  deps?: Partial<DepsOrc & { lerPlanilha: typeof lerPlanilhaSegura }>): Promise<Resultado<ResultadoImportacao>>;
```

O `Resultado` de erro usa `campo = 'linhas.<aba>.<linha>.<coluna>'` para cada `ErroPlanilha`, e o relatório agrupa por aba, na ordem das linhas.

- [ ] **Step 1: Integração (falha),** com planilhas montadas por `planilhas-teste.ts` nas abas, cabeçalhos (linha 4) e linhas (a partir da 5) do layout:
  - **sucesso:** 2 posições em 2 CCs, 3 pacotes e 2 receitas → gravados com `origem = 'IMPORTACAO'` e `importacaoId`; linhas recalculadas (Task 2); `orc_importacao` com nome, `sha256` e resumo; **um** evento no Histórico com o resumo (não um por linha); mensagem "Planilha importada: 2 posições e 3 pacotes em 2 CCs, 2 receitas.";
  - **tudo ou nada:** uma linha com erro entre 50 válidas → nada gravado, o relatório traz só a linha errada;
  - **Review Focus 1:** planilha com fórmulas sem resultado nas colunas cinzas e 300 linhas só com fórmula → importa só as linhas preenchidas, sem erro;
  - **Review Focus 3:** reimportar só o CC A → as posições de B ficam; importar o mesmo arquivo duas vezes → mesmo estado (mesmas contagens e mesmos totais) e dois eventos no Histórico; receita do TP "001/2026" substituída e a do "002/2026", ausente no arquivo, mantida;
  - **cabeçalho faltando** → "Planilha fora do layout ADMC-ORC v1.0: falta a coluna Cargo na aba Pessoal.";
  - **exercício `EM_APROVACAO`** → mensagem de situação e nada gravado;
  - **escopo (D-P6-6, R15):** usuário com `ccEscopo = '4.3'` e permissão de importar, arquivo com CC `4.4` → "CC fora do seu escopo." na linha; o mesmo usuário com a aba Receitas preenchida → "Receitas só podem ser importadas por quem vê toda a Adm. Central." e nada gravado;
  - **falha depois da substituição:** o C2 falso falhando na segunda posição (depois de apagar as posições antigas do CC A) → as posições antigas de A continuam, nenhuma `orc_importacao` sobra e o Histórico não registra a carga;
  - **`errosCelula` do leitor** (falso do leitor devolvendo um erro de célula na aba Pacotes) → o erro aparece no relatório com a aba e nada é gravado;
  - **leitor recusando** (arquivo que não é .xlsx) → o erro do leitor no topo, nada gravado;
  - **§10.2:** sem `orc.importacao:executar` → 403 auditado; auditoria falhando → nada gravado; duas importações simultâneas do mesmo exercício → serializadas pela trava, as duas completas e o estado igual ao de uma.
- [ ] **Step 2: Testes de tela (falham):** página com `orc.importacao:consultar` (404 sem ela); seletor de exercício; `<input type="file" accept=".xlsx">` com rótulo "Planilha (layout ADMC-ORC v1.0)"; o relatório de erros fica em `role="alert"` com "A planilha tem erros. Nada foi importado." e a tabela Aba · Linha · Coluna · Erro; o sucesso mostra o resumo por CC em `role="status"`.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar.** Célula com erro do leitor (`errosCelula`) chega como `null`: a validação da Task 4a **não** repete erro na mesma (linha, coluna), e o relatório mostra o do leitor. A ação recebe o `File` do `FormData` (limite de upload do compartilhado do P4), confere `file.size <= LIMITES_PADRAO.bytes` **antes** de `arrayBuffer()` ("Arquivo maior que 1 MB.", com teste de arquivo de 1 MB + 1 byte) e passa `Uint8Array` ao caso de uso; o `arquivoNome` gravado em `orc_importacao` e no Histórico é o `nomeArquivo` saneado que o leitor devolve (até 120 caracteres, sem caminho nem caractere de controle), com teste de `../../x\u0007.xlsx` → `x.xlsx`; o índice do C1 vira `ConsultaEstrutura` (`contaPermitida = contaAnaliticaAtiva && não está sob RAIZES_CONTAS_PESSOAL`).
- [ ] **Step 5:** suíte + lint + typecheck + `test:arq` → PASS. Conferência manual no dev com a planilha-modelo real preenchida com o exemplo das Instruções (PO ou sessão, com o C1 real se já estiver na `main`).
- [ ] **Step 6: PR** "[US-121] Importação da planilha-modelo com relatório de erros por linha (parte 3/3)", `Closes #143`. Lentes: plano/spec, testes, segurança e `security-review` (upload, tamanho, escopo).

### Task 5: Receitas digitadas na transição (US-060, `Closes #82`)

**Files:**
- Create: `src/modules/orc/application/{receitas,entrada-receita,acoes-receitas}.ts`, `src/modules/orc/ui/{lista-receitas,form-receita}.tsx`, `src/app/(sistema)/orc/receitas/{page,novo/page,[id]/page}.tsx`
- Test: `src/modules/orc/application/receitas.int.test.ts`, `src/modules/orc/ui/receitas.test.ts`

**Interfaces:**
- Consumes: `validarReceita` (Task 4a): a tela monta as células com os mesmos nomes de coluna da aba Receitas, e as regras ficam num lugar só.
- Produces:

```ts
export type ReceitaTela = { id: string; tp: string; descricao: string; situacao: 'CONFIRMADO' | 'PREVISTO'; meses: readonly Dinheiro[]; total: Dinheiro;
  iss: 'a definir'; liquido: Dinheiro; origem: 'MANUAL_TRANSICAO'; versao: number };
export function listarReceitas(ctx, exercicioId, deps?): Promise<{ confirmadas: readonly ReceitaTela[]; previstas: readonly ReceitaTela[];
  totalConfirmadoMes: readonly Dinheiro[]; totalPrevistoMes: readonly Dinheiro[] }>;                      // orc.receitas:consultar
export function incluirReceita(ctx, exercicioId, dados: unknown, deps?): Promise<Resultado<{ id: string }>>;   // orc.receitas:incluir
export function alterarReceita(ctx, id, versao, dados: unknown, deps?): Promise<Resultado<void>>;            // orc.receitas:alterar
export function excluirReceita(ctx, id, versao, deps?): Promise<Resultado<void>>;                            // orc.receitas:excluir
```

- [ ] **Step 1: Integração (falha):**
  - incluir, alterar e excluir auditados (antes e depois em `Dinheiro`); `total` calculado no servidor; `iss = 'a definir'` e `liquido = total` (GAP-ORC-007);
  - previstas separadas das confirmadas, com totais mês a mês separados;
  - TP repetido no exercício → "Já existe receita do TP <tp> neste exercício.";
  - exercício não editável → mensagem de situação;
  - **R15:** usuário com escopo e com as ações de receita → `orc.fora_do_escopo` em listar, incluir, alterar e excluir;
  - **§10.2, para incluir, alterar e excluir:** 403 auditado; auditoria falhando → nada muda; `versao` velha; *payload* com `origem`, `total`, `liquido`, `iss` ou `importacaoId` → `orc.violacao_governanca`; `totalConfirmadoMes` igual à soma das receitas confirmadas mês a mês (sem *drift*).
- [ ] **Step 2: Testes de tela (falham):** duas tabelas (Confirmadas, Previstas) com jan–dez, "Total do rateio", "ISS sobre o rateio" (texto "a definir") e "Rateio líquido"; cada linha com o selo "Digitado na transição" (C35); o formulário com 12 campos de mês rotulados (`Janeiro` … `Dezembro`) e a situação em grupo de rádio; "Novo", "Alterar" e "Excluir" (com `AcaoConfirmada`, pergunta "Deseja realmente excluir a receita do TP <tp>?") só com a ação correspondente.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar.**
- [ ] **Step 5:** suíte + lint + typecheck + `test:arq` → PASS.
- [ ] **Step 6: PR** "[US-060] Receitas do rateio dos TPs digitadas na transição", `Closes #82`. Registrar no corpo, pela C35, que na transição só o rateio mês a mês é digitado: o critério "Base = subtotal de despesas, % por TP" nasce no TP (RN0270, F3) e o critério "rateio calculado substitui o digitado" é da US-073 (F3), ambos fora da trilha (R11). Lentes: plano/spec, testes, segurança e `security-review`.

### Task 6: Visão por centro de custo com escopo (US-058, `Closes #80`)

**Files:**
- Create: `src/modules/orc/application/consolidacao.ts`, `src/modules/orc/ui/visao-cc.tsx`, `src/app/(sistema)/orc/orcamento/page.tsx`
- Modify: `src/modules/adm/application/usuarios.ts` (CC de escopo validado pelo C1; pendência menor da Task 6a do P5)
- Test: `src/modules/orc/application/consolidacao.int.test.ts`, `src/modules/orc/ui/visao.test.ts`, `src/modules/adm/application/usuarios.int.test.ts`

**Interfaces:**
- Consumes: `totalizarSerie` (`@/shared/totalizer`); C1 `listarArvoreCentrosCusto(tx, { incluirInativos: true })` (árvore com descrição, reduzido e inativos, R2) e `listarArvoreContas(tx, { incluirInativos: true })` (descrição das contas); `resolverEscopo` (Task 2). O `adm` recebe o C1 por injeção nos deps de `usuarios.ts` (`estrutura?: { carregarIndiceEstrutura }`, padrão o real).
- Produces:

```ts
export type NoVisao = { cc: string; codigoReduzido: string; descricao: string; tipo: 'SINTETICO' | 'ANALITICO'; inativo: boolean;
  pessoal: Dinheiro; baseZero: Dinheiro; total: Dinheiro; percentualDoEscopo: Percentual | null; filhos: readonly NoVisao[] };
export type DetalheCc = { cc: string; serie: { pessoal: readonly Dinheiro[]; baseZero: readonly Dinheiro[]; total: readonly Dinheiro[] };
  linhas: readonly { conta: string; descricaoConta: string; origem: 'PESSOAL' | 'BASE_ZERO'; meses: readonly Dinheiro[]; total: Dinheiro }[] };
export type Indicadores = { orcamentoAno: Dinheiro; pessoal: Dinheiro; percentualPessoal: Percentual | null; pacotes: number;
  empregadosDezembro: number; porPrioridade: Readonly<Record<Prioridade, Dinheiro>> };
export type VisaoExercicio = { exercicio: ResumoExercicio; escopo: Escopo; arvore: readonly NoVisao[]; indicadores: Indicadores;
  detalhe: DetalheCc | null; avisos: readonly string[] };
// orc.orcamento:consultar. ccDetalhe fora do escopo ou inexistente → notFound() na página (ErroDominio('orc.cc_fora_do_escopo') no caso de uso, auditado como negação).
export function obterVisaoExercicio(ctx, ano: number, ccDetalhe: string | null, deps?): Promise<VisaoExercicio>;
```

- [ ] **Step 1: Integração (falha):**
  - árvore de CC do falso com valores nas analíticas e sintéticos somados pelo `totalizarSerie` (RN_TOT_01); `percentualDoEscopo` de cada nó; soma dos analíticos = total do escopo (§10.2 item 6);
  - detalhe de um CC: série mês a mês por origem e linhas CC × conta com a origem (Pessoal / Base zero), as de pessoal agrupadas por conta;
  - indicadores: orçamento do ano, pessoal + encargos e o %, nº de pacotes, empregados em dezembro (D-P6-7: soma das quantidades das posições com `mesSaida = 12`) e o resumo por prioridade;
  - **Review Focus 4:** premissas com outra versão → `avisos` contém "As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento."; avisos das premissas do C2 (ex.: benefícios sem valor) também aparecem;
  - **Review Focus 5 / C25:** gestor com `ccEscopo = '4.3'` → árvore só com a subárvore 4.3 e indicadores do escopo; `ccDetalhe = '4.4'` → `orc.cc_fora_do_escopo` com negação auditada; DIREX e AUDITOR → árvore inteira;
  - CC inativado depois da importação (R2) → nó com `inativo: true` e o valor somado no pai, sem `NO_INEXISTENTE`;
  - **`adm`:** cadastrar ou alterar usuário com `ccEscopo` sem CC analítico ativo sob ele (`centrosCustoAnaliticosSob` vazio) → erro em `ccEscopo`: "CC de escopo sem centro de custo analítico ativo." [PROVISÓRIA].
- [ ] **Step 2: Testes de tela (falham):** página `/orc/orcamento?ano=2027&cc=<cc>` com `exigirPagina('orc.orcamento', 'consultar')`; seletor de exercício; cartões dos indicadores; `GradeArvore` (C3, `idGrade="orc.visao"`) com as colunas CC (reduzido e descrição, §6.1a), Pessoal + encargos, Base zero, Total e % do escopo, e `href` interno `?ano=…&cc=…`; detalhe com a série jan–dez e a tabela CC × conta com a coluna Origem; avisos em `role="status"`; o botão "Recalcular" (`AcaoConfirmada`) só com `orc.orcamento:alterar`, sem escopo e com o exercício editável; sem exercício → "Nenhum exercício cadastrado." com o link para Exercícios quando houver `orc.exercicios:consultar`.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar.**
- [ ] **Step 5:** suíte + lint + typecheck + `test:arq` → PASS.
- [ ] **Step 6: PR** "[US-058] Visão por centro de custo com árvore, série mensal e escopo do gestor", `Closes #80`. Lentes: plano/spec, testes, segurança e `security-review` (escopo).

### Task 7: Teto, semáforo e resultado (US-059, `Closes #81`)

**Files:**
- Create: `src/modules/orc/domain/resultado.ts`, `src/modules/orc/application/{teto,entrada-teto,acoes-teto}.ts`, `src/modules/orc/ui/painel-teto.tsx`
- Modify: `src/modules/orc/application/consolidacao.ts` (o painel entra na `VisaoExercicio`), `src/app/(sistema)/orc/orcamento/page.tsx`
- Test: `src/modules/orc/domain/resultado.test.ts`, `src/modules/orc/application/teto.int.test.ts`, `src/modules/orc/ui/painel.test.ts`

**Interfaces:**
- Consumes: Tasks 5 e 6; `obterParametrosExercicio` e `classificarSemaforo` do `cad` (R12, Task 9a do P4).
- Produces:

```ts
// domain/resultado.ts (puro)
export type Painel = {
  receitaConfirmadaMes: readonly Dinheiro[]; receitaPrevistaMes: readonly Dinheiro[]; despesasMes: readonly Dinheiro[];
  resultadoMes: readonly Dinheiro[]; resultadoAno: Dinheiro;          // rateio líquido confirmado − (pessoal + base zero)
  tetoPadrao: Dinheiro; tetoManual: Dinheiro | null; tetoEfetivo: Dinheiro; // padrão = rateio líquido confirmado do ano
  orcado: Dinheiro; uso: Percentual | null; saldo: Dinheiro;            // uso = orçado ÷ teto efetivo × 100; null com teto zero
};
export function calcularPainel(despesasMes: readonly Dinheiro[], receitas: readonly { situacao: 'CONFIRMADO' | 'PREVISTO'; meses: readonly Dinheiro[] }[], tetoManual: Dinheiro | null): Painel;
export function validarTeto(valor: Dinheiro | null, justificativa: string | null, receitaConfirmada: Dinheiro): Resultado<{ valor: Dinheiro | null; justificativa: string | null }>;

// application/teto.ts — orc.orcamento:alterar
export function definirTeto(ctx, exercicioId: string, versao: number, dados: unknown, deps?): Promise<Resultado<void>>;
// VisaoExercicio ganha: painel: (Painel & { semaforo: FaixaSemaforo | null }) | null  — null quando o escopo é SUBARVORE (R8)
```

- [ ] **Step 1: Testes de domínio (falham):**
  - receitas confirmadas de 100.000,00/mês, prevista de 50.000,00/mês e despesas de 90.000,00/mês → `resultadoMes` 10.000,00 em cada mês e `resultadoAno` 120.000,00; a prevista **não** entra no resultado nem no teto;
  - `tetoPadrao` 1.200.000,00; orçado 1.080.000,00 → `uso` 90,00 e `saldo` 120.000,00;
  - teto manual 1.000.000,00 → `tetoEfetivo` 1.000.000,00, `uso` 108,00, `saldo` −80.000,00;
  - sem receita confirmada e sem teto manual → `tetoEfetivo` 0,00 e `uso` `null`;
  - `validarTeto`: 0 → "O teto precisa ser maior que zero."; acima da receita sem justificativa ou com 14 caracteres → "Teto maior que a receita confirmada exige justificativa com pelo menos 15 caracteres."; com 15 → ok; `null` limpa o teto manual (volta ao padrão).
- [ ] **Step 2: Integração (falha):** `definirTeto` auditado com antes e depois (`Dinheiro`) e `unidadeId` nulo; auditoria falhando → nada muda (§10.2 item 1); usuário com escopo e com `orc.orcamento:alterar` → `orc.fora_do_escopo` (R15); sem `cad.parametros:consultar` → painel sem semáforo e o aviso da R12; `versao` velha → concorrência; exercício não editável → mensagem; sem `orc.orcamento:alterar` → 403; *payload* com `tetoEfetivo` ou `situacao` → `orc.violacao_governanca`; a visão traz o painel com o semáforo do `cad` (faixas 70/85/95: uso 90,00 → `LARANJA`); com escopo → `painel: null`.
- [ ] **Step 3: Testes de tela (falham):** painel com "Receita confirmada", "Receita prevista (fora do saldo e do teto)", "Despesas", "Resultado" (negativo com classe de alerta e o sinal "−"), "Teto" (com "padrão: rateio líquido confirmado" ou "manual"), "% do teto" e o semáforo com texto (Verde, Amarelo, Laranja, Vermelho), nunca só cor; sem teto → "Sem teto: não há receita confirmada nem teto manual."; formulário do teto só com `alterar`, sem escopo e editável.
- [ ] **Step 4:** testes → FAIL.
- [ ] **Step 5: Implementar.**
- [ ] **Step 6:** suíte + lint + typecheck + `test:arq` → PASS.
- [ ] **Step 7: PR** "[US-059] Teto do exercício com semáforo e resultado", `Closes #81`. Lentes: plano/spec, testes e segurança.

### Task 8: Envio, aprovação, rejeição e oficialização com snapshot (US-061, `Closes #83`)

**Files:**
- Create: `src/modules/orc/application/{aprovacao,entrada-aprovacao,acoes-aprovacao}.ts`, `src/modules/orc/infrastructure/snapshot.ts`, `src/modules/orc/ui/acoes-ciclo.tsx`, `src/app/(sistema)/orc/aprovacao/page.tsx`
- Test: `src/modules/orc/application/aprovacao.int.test.ts`, `src/modules/orc/infrastructure/snapshot.test.ts`, `src/modules/orc/ui/aprovacao.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6 e 7; C2 `congelarPremissasExercicio`.
- Produces:

```ts
// infrastructure/snapshot.ts (puro): JSON canônico (chaves ordenadas, Dinheiro como string "1234.56") e sha256 em hex
export function montarSnapshot(dados: ConteudoSnapshot): { conteudo: unknown; sha256: string };
export type ConteudoSnapshot = { ano: number; oficializadoEm: string; premissas: PremissasExercicio; painel: Painel;
  posicoes: readonly unknown[]; pacotes: readonly unknown[]; receitas: readonly unknown[]; linhas: readonly unknown[] };

// application/aprovacao.ts
export function enviarParaAprovacao(ctx, exercicioId, versao, deps?): Promise<Resultado<void>>;               // orc.aprovacao:executar
export function aprovarExercicio(ctx, exercicioId, versao, deps?): Promise<Resultado<void>>;                  // orc.aprovacao:aprovar
export function rejeitarExercicio(ctx, exercicioId, versao, justificativa: string, deps?): Promise<Resultado<void>>; // orc.aprovacao:aprovar
export function listarTramites(ctx, exercicioId, deps?): Promise<readonly { de: SituacaoExercicio; para: SituacaoExercicio; usuario: string; justificativa: string | null; em: Date }[]>; // orc.aprovacao:consultar
```

**Pré-condições do envio** (conferidas de novo na aprovação, R10; sempre **depois** do `travarExercicio`, para nenhuma escrita concorrente entrar entre a validação e a transição): situação `EM_ELABORACAO`; `versao` do exercício igual à da tela; premissas na versão do último cálculo (R9); todas as linhas com CC analítico ativo e conta analítica ativa (R2), senão a lista por CC/conta; pelo menos uma linha; teto manual acima da receita confirmada **atual** só com justificativa (uma receita alterada depois do teto pode exigir a justificativa: "Teto maior que a receita confirmada exige justificativa com pelo menos 15 caracteres.").

**Corrida com as premissas do C2 (R10):** as escritas da GRH no `cad` não pegam a trava do `orc`. Por isso, a oficialização chama `congelarPremissasExercicio` e, **depois dele, na mesma transação**, relê `obterPremissasExercicio(tx, ano)`: se a `versao` for diferente da usada no snapshot, lança e desfaz tudo ("As premissas do exercício mudaram durante a aprovação. Tente novamente."). Depois do congelamento, o `cad` recusa escritas no ano. **Requisito do C2 que fecha a corrida:** `congelarPremissasExercicio` faz `UPDATE` na linha de `parametros_exercicio` do ano (grava `congeladoEm`), e toda escrita da GRH/GFIN passa por `tocarVersaoExercicio`, que atualiza a mesma linha (Task 9a do P4). Assim, a escrita que chegar depois do congelamento espera o commit e é recusada pelo ano congelado. A frente A confirma isso na revisão de consumidor da Task 9a do P4; se não valer, abre issue de contrato antes da Task 8. O snapshot é montado sempre com escopo `TOTAL`, independentemente de quem aprova.

- [ ] **Step 1: Testes do snapshot (falham):** a mesma entrada em ordens de chave diferentes → mesmo `sha256`; `Dinheiro` serializado como `"1234.56"`; mudar um centavo muda o `sha256`.
- [ ] **Step 2: Integração (falha):**
  - **envio:** `EM_ELABORACAO` → `EM_APROVACAO`, grava `enviadoPor`, `orc_tramite` e Histórico; premissas desatualizadas → "As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento." (Review Focus 4); CC inativado (R2) → erro com o CC; exercício vazio → recusado; `RASCUNHO` → mensagem de situação;
  - **depois do envio:** importar, recalcular, mudar teto ou receita → recusados (app) e o `INSERT` direto como `sgo_app` → recusado pelo trigger;
  - **aprovação:** DIREX aprova → `OFICIALIZADO`, `oficializadoEm`, snapshot gravado com o conteúdo igual ao da visão naquele momento (painel e totais), `congelarPremissasExercicio(tx, contexto, 2027)` chamado (o falso põe 2027 em `congelados`), tramite e Histórico; `UPDATE` no snapshot ou no exercício oficializado → recusado;
  - **D-P6-3:** o mesmo usuário (com GFIN e DIREX) que enviou tenta aprovar → "Quem enviou o orçamento para aprovação não pode aprová-lo.";
  - **rejeição:** justificativa com 14 caracteres → "A justificativa da rejeição precisa ter pelo menos 15 caracteres."; com 15 → `EM_ELABORACAO`, justificativa no tramite e no Histórico, e a edição volta a valer;
  - **falha no meio da oficialização** (`congelarPremissasExercicio` lançando) → nada muda: situação, snapshot e tramite desfeitos (`silent-failure-hunter`);
  - **corrida com as premissas:** o falso do C2 devolvendo outra `versao` na releitura depois do congelamento → "As premissas do exercício mudaram durante a aprovação. Tente novamente." e nada muda;
  - **R15:** usuário com escopo e com as ações → `orc.fora_do_escopo` em enviar, aprovar, rejeitar e `listarTramites`;
  - **envio com `versao` de antes de uma importação** → mensagem de concorrência;
  - **teto manual sem justificativa que passou a ficar acima da receita** (receita confirmada reduzida depois do teto) → envio recusado com a mensagem do teto;
  - **§10.2:** GFIN aprovando → 403 auditado; DIREX enviando → 403 auditado; duas aprovações simultâneas → uma oficializa e a outra recebe a mensagem de concorrência; auditoria falhando → nada muda; *payload* com `situacao` → `orc.violacao_governanca`.
- [ ] **Step 3: Testes de tela (falham):** `/orc/aprovacao?ano=` com `exigirPagina('orc.aprovacao', 'consultar')`; situação atual com o rótulo; "Enviar para aprovação" (GFIN, `EM_ELABORACAO`) e "Aprovar" (DIREX, `EM_APROVACAO`) com `AcaoConfirmada` e as perguntas exatas das Global Constraints; "Rejeitar" com campo de justificativa obrigatório (`aria-describedby` com a regra dos 15 caracteres); histórico de trâmites em tabela (De, Para, Usuário, Justificativa, Data); exercício oficializado → "Oficializado em <data>" e nenhum botão; a visão (Task 6) mostra a situação e fica só leitura em `EM_APROVACAO` e `OFICIALIZADO` (RF_APR_REQ_004).
- [ ] **Step 4:** testes → FAIL.
- [ ] **Step 5: Implementar.**
- [ ] **Step 6:** suíte + lint + typecheck + `test:arq` → PASS.
- [ ] **Step 7: PR** "[US-061] Envio, aprovação pela DIREX e oficialização com snapshot do orçamento da Adm. Central", `Closes #83`. Lentes: plano/spec, testes, segurança, `security-review` e `silent-failure-hunter`.

### Task 9: E2E do P6 (`Refs #77 #80 #81 #82 #83 #143`)

**Files:**
- Modify: `e2e/global-setup.ts` (usuários `gfin`, `direx` e `gestor` com `ccEscopo`; atende também a issue do usuário GFIN da frente B, Task 6a do P4), `e2e/aut/apoio.ts`
- Create: `e2e/orc/orcamento.spec.ts`, `e2e/orc/planilhas.ts` (monta a planilha com ExcelJS a partir das Listas do C1 real)

- [ ] **Step 1: Cenários (falham):**
  1. GFIN cria o exercício 2027 em branco e avança para Em Elaboração;
  2. GFIN importa uma planilha com um erro → vê o relatório com a linha e nada é gravado; corrige e importa → vê o resumo por CC;
  3. GFIN digita uma receita confirmada e uma prevista; a visão mostra o resultado, o teto padrão e o semáforo com texto;
  4. Gestor de Diretoria entra e vê só a subárvore dele; `?cc=` de outra diretoria → 404; `/orc/receitas`, `/orc/importacao` e `/orc/aprovacao` → 404;
  5. GFIN envia; a DIREX rejeita com justificativa; GFIN reenvia; a DIREX aprova; a tela mostra "Oficializado em …", sem botões, e a importação é recusada;
  6. Orçamentista não vê o menu Administração Central e recebe 404 em `/orc/orcamento`.
- [ ] **Step 2:** `npm run test:e2e` sozinho (D12) → FAIL antes da implementação dos cenários, PASS depois, sem contêineres sobrando (`docker ps --filter label=org.testcontainers=true` vazio).
- [ ] **Step 3: PR** "E2E do orçamento da Adm. Central (P6)", `Refs #77 #80 #81 #82 #83 #143`. Lentes: plano/spec e testes.

## Riscos

- **Contratos da frente B atrasados:** o C2 real chega por volta de 17/11 e o semáforo depende da Task 9a do P4 (R12). As Tasks 0, 1, 1b, 4a e 5 não dependem disso; as outras rodam com os falsos, e só a Task 9 precisa dos reais.
- **Planilha preenchida fora do padrão:** células coladas como texto, colunas renomeadas ou abas reordenadas. A importação recusa com a linha e a coluna (Review Focus 1 e 2), e o plano B (aprovação sobre a planilha) continua valendo.
- **Premissas provisórias (GAP-ORC-003) e benefícios sem valor:** o orçamento sai com aviso nas premissas; quando a GRH preencher, "Recalcular" atualiza tudo.
- **CC da minuta (GAP-CC-001):** se a DIREX mudar a minuta depois das importações, os CCs inativados aparecem na visão e travam o envio (R2), e a GFIN reimporta.
- **Teto por diretoria (GAP-ORC-004):** fica de fora; o teto é do exercício inteiro.
- **ISS (GAP-ORC-007):** "a definir"; o rateio líquido é igual ao rateio.

## Encerramento do P6

- `npm run lint && npm run typecheck && npm test && npm run test:arq && npm run test:int && npm run build` verdes na `main`. Depois, `npm run test:e2e`, sozinho.
- Revisão de bloco do P6 (§12.12) e `/code-review ultra` a critério do PO (a §12.12 prevê o ultra opcional em P1 e P6).
- Memória do projeto: decisões D-P6-*, textos [PROVISÓRIOS], o estado dos GAPs ORC e o caminho da US-073.
- Conferência com a GFIN em hml: importar a planilha real de uma diretoria e comparar o total por CC com a aba Resumo dela (diferença de até 1 centavo por linha aceita, decisão do PO de 25/10, issue #168).
