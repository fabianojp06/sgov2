# Trilha 2027 · P4 Componentes e cadastros (frente B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Os passos marcados "(PO)" são executados pelo PO (Easypanel, GitHub, contato com SMEs); a sessão prepara o arquivo, o roteiro e a verificação esperada.

**Goal:** Entregar os componentes e os cadastros-base de que o orçamento 2027 da Adm. Central depende:
- envio real de e-mail (desbloqueia a Task 6a do P5 da frente A);
- os contratos **C1** (estrutura financeira) e **C2** (custo de pessoal), cedo, para a frente A planejar o P6;
- plano de contas e centros de custo importados por planilha, com consulta em árvore;
- Tree Grid virtualizada com filtros retidos na sessão;
- parâmetros por exercício, Tabela Mestre de Benefícios, cargos e salários (salário cifrado e mascarado);
- o `MotorCustoPessoal` real, com valores conferidos à mão.

**Architecture:**
- **`ger` (componentes):** a US-025 troca o `enviarEmail` do C4 de "indisponível" para *outbox* real e cria o trabalhador de e-mail. A US-021 troca a implementação da `GradeArvore` do C3 mantendo as *props* (as novas são opcionais) e torna o `exportarXlsx` real. O leitor seguro de .xlsx também fica no `ger`, para o `cad` e para a US-121 (frente A).
- **`cad` (cadastros), dono de `prisma/schema/cad.prisma`:** plano de contas, centros de custo, cargas de estrutura, parâmetros por exercício, Tabela Mestre de Benefícios, cargos, tabela salarial e o `MotorCustoPessoal`.
- **Duas entradas públicas por módulo** (Task 0, R22): o `index.ts`, que páginas e componentes importam, e o `servidor.ts`, só de servidor, que o worker e os casos de uso de outros módulos importam. O worker nunca empacota React nem arquivos `'use client'`/`'use server'`.
- **Estrutura financeira é espelho de ERP** (D7, D9, C27, §5):
  - o app valida o arquivo e grava o lote numa tabela de *staging*; o `sgo_app` só insere no *staging* e lê o resultado;
  - o **worker**, conectado como `sgo_sync`, faz o *merge* atômico com *advisory lock* e grava o resultado no lote;
  - a tela acompanha o estado do lote;
  - sem CRUD de estrutura, e a recarga nunca muda a classificação de um registro (R5).
- **Contratos primeiro** (spec §12.6): C1 e C2 entram como PRs pequenos com tipos, assinaturas e falsos. Até a implementação real chegar, as funções reais lançam `ErroDominio('cad.*_indisponivel')`, no mesmo padrão do C4.
- **Dinheiro:** `Dinheiro`/`Percentual` do kernel em todo cálculo, `NUMERIC(15,2)`/`NUMERIC(9,4)` no banco, Half-Even; `number` só para contagem, mês e nível.

**Tech Stack:** Next.js 16.4.3 (App Router, Server Actions) · React 19.3.1 · Prisma 7.10.1 · PostgreSQL 16 · pg-boss 12.38.0 · Zod 4.6.7 · decimal.js 10.6.0 · Vitest 5.0.5 + Testcontainers · Playwright 1.64.0 (medição da rolagem). Dependências novas, no PR compartilhado da Task 0:
- **`exceljs`**: leitura e escrita de .xlsx (spec §4.2);
- **`nodemailer`** + `@types/nodemailer`: SMTP (spec §4.2);
- **`@tanstack/react-virtual`**: virtualização da Tree Grid (spec §4.2);
- **`server-only`**: barreira de código de servidor no Next;
- **`smtp-server`** + `@types/smtp-server`, só em `devDependencies`: servidor SMTP em processo, para o teste de integração do e-mail, sem contêiner a mais.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (**v1.5**) — §3.3, §4.1, §4.2, §5, §6.1, §6.1a, §6.4, §6.6, §6.7, §10.2, §10.3, §11.5, §12.3, §12.5–§12.7, §12.12; D4, D5, D7, D9, D10, D12; C7, C8, C20, C23, C27, C33, C34. Regras de `especificacao/`:
- EP083 V3 (UC0.01 e UC0.06);
- EP084 V5 (RNF0002, citado na spec §5);
- Minuta de Cadastros V5 (UC03.00, UC03.18, UC03.28, RN_PLA_001–011);
- UC03.19 Cargos e Salários V4 (RN_CAR_*, RN_TAB_*, REQ_CAR_*, REQ_TAB_*);
- planilha oficial do plano de contas (`especificacao/Plano_de_Contas_5_Niveis_*.xlsx`) e minuta de CC Rev23102026.

**Plano-mestre:** `docs/superpowers/plans/2026-10-24-trilha-2027-plano-mestre.md`. P4: US-021 #43, US-025 #47, US-043 #65, US-044 #66, US-046 #68, US-049 #71, US-050 #72, US-051 #73 e US-053 #75, mais os contratos C1 e C2, consumidos pela US-121 #143 do P6.

## Global Constraints

- **D12 / spec §11.5 item 6:** nenhuma sessão toca contêineres, redes, volumes ou variáveis de `sgo-prod`/`sgo-hml`. O que é feito no Easypanel (SMTP, chave de salários, `SYNC_DATABASE_URL` e `URL_PUBLICA` do worker, `AMBIENTE`), o **PO executa**.
- **Um processo pesado por vez (D12):** `test:int`, `build`, E2E e o teste da imagem rodam um de cada vez. Antes de cada um, conferir que a frente A não está rodando nada pesado: `pgrep -af 'vitest|next build|playwright'` sem saída da worktree `/root/sistemas/sgo`. Rodar com `nice -n 10`.
- **Portas só em `127.0.0.1`:** banco de dev da frente B em 56432, app em 3200 e Mailpit em 8225. O `smtp-server` de teste escuta em `127.0.0.1`, em porta aleatória.
- **Banco (spec §11.5):** antes de todo comando que toca banco, dizer se ele **escreve, apaga ou reseta**, e conferir:
  - `MIGRATE_DATABASE_URL`, `SHADOW_DATABASE_URL`, `DATABASE_URL` e `SYNC_DATABASE_URL`, que devem apontar para `127.0.0.1:56432`;
  - antes de `docker compose down -v`, `COMPOSE_PROJECT_NAME=sgo-b` no `.env` (`grep COMPOSE_PROJECT_NAME .env`), para nunca derrubar o volume da frente A.

  `migrate dev --create-only`, `migrate diff` e `db push` só no dev local. Para recriar o banco de dev da frente B:
  1. `docker compose down -v` (**apaga** só o banco de dev local 56432);
  2. `docker compose up -d --wait`;
  3. `npm run db:deploy` e `npm run db:seed` (**escrevem** no dev local).
- **Nada de `git stash`:** o *stash* é compartilhado entre as worktrees. Para guardar trabalho, fazer um commit WIP na branch.
- **Migrations (spec §12.7):**
  - uma por PR, com a label `migration`, e o PO faz o merge de uma por vez;
  - nome `AAAAMMDDHHMM_cad_<descricao>`, gerado depois do rebase, **maior que a última migration da `main`** (`ls prisma/migrations | tail -1`);
  - `REVOKE`/`GRANT`, `CHECK` e *triggers* vão à mão no `migration.sql`;
  - depois do `db:deploy` local, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code` sem diferença.
- **Privilégios em toda migration do `cad` (B1).** A migration `nucleo_privilegios` dá a `sgo_app` **e** a `sgo_sync`, por *default privileges*, `SELECT`, `INSERT`, `UPDATE` e `DELETE` em toda tabela nova. Por isso, toda migration do `cad`:
  - **tira tudo do `sgo_sync` nas tabelas que não são de estrutura:** `REVOKE ALL … FROM sgo_sync` em parâmetros, benefícios, tabela salarial, senioridade e benefício do cargo;
  - **nas tabelas de estrutura**, devolve ao `sgo_sync` só o necessário (R6);
  - **inclui o teste de matriz** `privilegios.int.test.ts`. Ele lê `information_schema.table_privileges` e `information_schema.column_privileges` e compara com uma tabela esperada (tabela × papel × privilégio, e coluna × papel nas colunas com `GRANT UPDATE (…)`). Qualquer privilégio a mais ou a menos reprova.
- **Propriedade (spec §12.3, `.github/frentes.yml`):** este bloco só cria ou altera arquivos em:
  - `src/modules/{ger,cad}/`, `prisma/schema/cad.prisma`, `prisma/migrations/`;
  - `src/app/(sistema)/cad/`, `e2e/cad/`, `worker/` e `docs/operacao/`.

  Os arquivos compartilhados só mudam em PR `compartilhado` exclusivo (Tasks 0 e 4c): `package.json`, `package-lock.json`, `.env.example`, `docker-compose.yml`, `eslint.config.mjs`, `next.config.ts`, `vitest.config.ts`, `scripts/` e `prisma/seed.ts`. `src/shared/**` e `e2e/global-setup.ts` são da frente A: o que precisar deles vira issue para a frente A.
- **Variáveis de módulo:** o `ger` e o `cad` leem as próprias variáveis com Zod, em `infrastructure/`. A mensagem de erro cita o **nome** da variável, nunca o valor. Variável booleana vale só com `=== '1'`; `0`, `true` ou vazio contam como desligada (M1).
- **`server-only`** (M5): entra no topo dos arquivos que só rodam no Next: `cifra-salarios.ts`, `acoes-*.ts` e os casos de uso que decifram salário.
  - Os arquivos que o worker carrega não usam o pacote (`config-smtp.ts`, `smtp.ts`, `trabalhador-email.ts`, `cliente-sync.ts` e o processador de cargas), porque ele lança erro fora do Next.
  - A proteção desses arquivos é a separação de entradas: o `index.ts` nunca os alcança (R22, teste da Task 0).
- **Autorização e auditoria (C5):**
  - toda Server Action com `definirAcao`; toda `page.tsx` de `src/app/(sistema)/cad/` começa com `await exigirPagina(...)` (o teste de arquitetura impõe);
  - todo caso de uso chama `exigir(ctx, funcionalidade, acao)` primeiro e audita com `auditar(tx, evento)` no mesmo `tx`;
  - dinheiro auditado como `Dinheiro`/`Percentual`;
  - a negação (403) é auditada pela `definirAcao`;
  - campo de ORIGEM BLINDADA no *payload* gera `ErroDominio('cad.violacao_governanca')`, auditado numa transação própria, como a negação, porque a operação é desfeita (spec §5, M4).
- **Testes obrigatórios das diretrizes (spec §10.2), em toda tarefa com escrita:**
  - item 1, auditoria falhando: nada persiste (com `vi.mock('@/shared/audit', …)`, R13 do P5);
  - item 3, ação sem permissão: 403 auditado;
  - item 4, dois saves concorrentes: o segundo recebe o erro de concorrência;
  - item 5, campo ORIGEM BLINDADA no *payload*: rejeitado e auditado, nunca gravado;
  - item 6, soma de dinheiro sem *drift*.

  O item 2 (unidade) não se aplica: cadastros globais não têm `unidade_id` (spec §5).
- **Lint de domínio (I1):** `domain/` só importa o próprio módulo e o kernel. O saneamento da marca vedada (`encontrarMarcaVedada` de `@/shared/config`) fica em `application/`, e o domínio recebe a função injetada.
  - Os testes que precisam da sigla ficam fora de `domain/` e montam a sigla em tempo de execução (`['c','t','c','e','a'].join('')`, como o `marca.ts`). Assim, nenhum arquivo de `src/` contém a sigla.
- **Dados provisórios marcados:** o que depende de GAP aberto entra no banco com `provisorio = true` e aparece na tela com o selo "Provisório". Isso vale para:
  - CC da minuta (GAP-CC-001 a 006);
  - premissas do exercício (GAP-ORC-003);
  - contas de Obrigações e Riscos Trabalhistas (GAP-CAR-005);
  - contas fora da §6.6 (R14);
  - benefícios sem valor.

  A descrição da conta 4.1.1.8.005 entra sem a sigla (GAP-CAD-005). As 15 contas do protótipo que não existem no plano oficial (GAP-CAD-004) **não** são criadas (C27).
- **GAP-INF-001 (SMTP de prod):** o código da US-025 fica pronto e testado com Mailpit e com o `smtp-server`. A configuração de hml e prod é pendência do PO.
- **Marca neutra:** a sigla da instituição não aparece em código, dados de seed, nomes de coluna, modelos de e-mail nem cabeçalhos de planilha.
  - O campo que o C&S V4 chama pelo nome da instituição vira **"Cargo (nome oficial)"** (`nomeOficial`).
  - Arquivos de `especificacao/` cujo nome tem a sigla são localizados por *glob*, nunca pelo nome literal.
- **Tamanho:** PR de até cerca de 400 linhas de código de produção (§12.5); por isso, as histórias grandes são divididas.
- **Por tarefa:**
  - branch `us-NNN-slug` e título `[US-NNN] …`;
  - `Closes #n` só no PR que prova o último critério de aceite; os anteriores usam `Refs #n`;
  - labels `frente:B` e, quando couber, `migration` ou `contrato`;
  - commits com `Frente: B` e os trailers de coautoria;
  - push, PR e merge só com confirmação do PO;
  - antes de chamar o PO, o comentário "Revisão de código (12.12)", com as lentes indicadas na tarefa e **no máximo 2 rodadas** de correção (depois disso, o PO decide). Merge sempre pelo PO, em *squash*.
- Textos de interface, mensagens e logs em português do Brasil.

## Rulings do planejamento

**Decisões do coordenador (rodada 1 da revisão 12.12, PR #204; o PO segue a recomendação):**

- **R5 (D-a). A classificação é a chave entre módulos e nunca muda.** O C1 e todos os consumidores identificam conta e CC pela classificação. A recarga **nunca** altera a classificação, o nível, o pai nem o tipo de um registro existente: a D7 ("atualiza descrição/status") vale ao pé da letra. A regra é a mesma no plano de contas e no CC.
  - **Mesma classificação:** atualiza só a descrição e a situação (inclusive a reativação de um inativo).
    - Com outro reduzido, ou outro tipo, é **erro na linha**: "A carga não muda a estrutura de um registro existente (D7): <classificação> já existe com o reduzido <r>/tipo <t>."
  - **Classificação nova com o reduzido de um registro ativo de outra classificação:** inativa o antigo, cria o novo e gera o aviso "O reduzido <r> passou de <antiga> para <nova>: a antiga foi inativada."
  - **Classificação nova com reduzido livre:** inclui.
  - **Registro ausente no arquivo:** inativa (soft delete). Nada é apagado.
  - **Banco:** o reduzido é único só entre os ativos (índice parcial `WHERE ativa`), para o antigo inativado conviver com o novo. O mesmo arquivo recarregado não muda nada, nem o Histórico.
  - **No C1:** o JSDoc registra essa regra.
  - **Spec v1.6:** a D7 recebe esse texto.
- **R6 (D-b). *Staging* no app, *merge* no worker como `sgo_sync` (§5 SINCRONISMO ATÔMICO, D9).**
  - **No app** (só `sgo_app`), a importação faz, em ordem:
    1. confere a permissão;
    2. lê e valida o arquivo inteiro em memória;
    3. numa transação, grava o lote em `carga_estrutura` (`situacao = PENDENTE`, com o contexto de auditoria do usuário) e as linhas validadas em `carga_estrutura_linha`;
    4. audita "importação solicitada".

    Um índice único parcial (`tipo WHERE situacao IN ('PENDENTE','PROCESSANDO')`) recusa na hora uma segunda carga do mesmo tipo (RNF_PLA_REQ_007). O `sgo_app` tem só `INSERT` no *staging* e `SELECT` no lote.
  - **No worker** (único processo com `SYNC_DATABASE_URL`; o app **não** recebe essa variável), o processador de cargas lê um lote `PENDENTE` com `FOR UPDATE SKIP LOCKED` a cada 5 s. Depois:
    1. confere `SELECT current_user = 'sgo_sync'` (outro papel recusa a carga, com teste);
    2. pega `pg_try_advisory_xact_lock(hashtext('sync-<tipo>'))`;
    3. aplica o *merge* (R5) numa transação, auditando com o contexto gravado no lote;
    4. grava `CONCLUIDA` com as contagens e os avisos, ou `FALHOU` com a mensagem sem valores;
    5. apaga as linhas do *staging*.
  - **Na tela:** o app atualiza a tela a cada 2 s até o lote terminar.
  - **Um cliente Prisma do `sgo_sync` por processo do worker.** Sem `SYNC_DATABASE_URL`, o worker emite `[CARGA_SEM_SYNC]`, e os lotes ficam `PENDENTE`, visíveis.
  - **Núcleo separado da casca:** o *merge* (`aplicarCarga(tx, contexto, linhas)`) não confere papel nem lote. A conferência do `current_user` e a gravação do lote são da casca do worker.
  - **Seed:** a de referência chama o mesmo núcleo com o `tx` do migrator e o contexto "Sistema" (descrição "Seed: …").
  - **Seed de cargos:** os cargos sintéticos entram **sem salário**, para a migração não precisar da chave.
  - **Privilégios por tabela:**

    | Tabela | `sgo_app` | `sgo_sync` |
    | --- | --- | --- |
    | `conta_contabil`, `centro_custo` | `SELECT` | `SELECT`, `INSERT`, `UPDATE` |
    | `cargo` | `SELECT` + `UPDATE` só das colunas manuais | `SELECT`, `INSERT` + `UPDATE` só das colunas Rubi e de controle (`ativo`, `versao`, `atualizado_em`, `carga_id`) |
    | `carga_estrutura` | `SELECT`, `INSERT` | `SELECT`, `UPDATE` |
    | `carga_estrutura_linha` | `INSERT` | `SELECT`, `DELETE` |

    Ninguém além do migrator tem `DELETE` nas tabelas de estrutura.
  - **Spec v1.6:** registrar na §5 que o *staging* é gravado pelo app e o *merge* é feito pelo worker.
- **R9 (D-c). Novas tentativas do e-mail: 3, como no EP083, para qualquer falha de envio.**
  - O EP083 (UC0.06 E1) prevê "até três tentativas posteriores" também para "rejeição de endereço": o erro SMTP 5xx entra nas 3 novas tentativas, sem falha definitiva imediata.
  - O trabalhador consulta a própria tentativa (`fila.consultar`). Na falha da 4ª execução, trata como definitiva.
  - Sem mudança em `src/shared/filas`. O JSDoc do C4 é corrigido.
- **R14a (D-d). Benefício `PERCENTUAL_SALARIO`:** incide sobre o salário do mês, reajustado a partir da data-base, de toda a posição (quantidade × salário reajustado).
- **R23 (D-e). Limpeza garantida dos dados sensíveis do e-mail.**
  - **Expiração:** o *payload* leva `criadoEm`. Mensagem com mais de 24 h vira falha definitiva "expirada", sem tentar enviar, porque a senha temporária já venceu (C21).
  - **Quando apagar o job sensível:** num `finally`, sempre que o resultado for sucesso, falha definitiva ou expiração. Na última tentativa (a 4ª), o job é apagado em qualquer resultado.
  - **Sem SMTP configurado:** cada tentativa falha com "SMTP não configurado" e segue as mesmas regras. A mensagem não fica parada com a senha.
  - **Outbox abandonado:** para `email.enviar`, só acontece com fila desconhecida ou chave inválida, o que não ocorre na prática. Com isso, a pré-condição da Task 6a do P5 fica satisfeita. O PR da Task 1 pede à frente A essa confirmação explícita na revisão de consumidor. O JSDoc do C4 passa a dizer isso.
- **R24 (D-f). Ver salário sem máscara é permissão própria e auditada.**
  - **A permissão:** funcionalidade `cad.salarios` (ação `consultar`, `nivelLog` `AVANCADO`). Toda leitura sem máscara grava um `CONSULTA` no Histórico, com o cargo e sem os valores.
  - **Quem não tem a permissão** recebe mascarados:
    - os salários;
    - o total do custo do cargo;
    - o encargo e os componentes;
    - o desvio de mercado.

    Vale também para a exportação, com teste.
  - **Dependência da frente A:** `cad.salarios` não pode aparecer no menu (R11 do P5 mostra toda funcionalidade com alguma ação). A Task 2 abre a issue de contrato para o C6 aceitar, como acréscimo compatível, `exibirNoMenu?: boolean` (padrão `true`) em `DeclaracaoFuncionalidade`. A Task 12b depende disso.
  - **Plano B:** sem o acréscimo, `cad.salarios` aparece no menu com o nome "Salários sem máscara", apontando para `/cad/cargos`. É feio, mas não vaza nada.

**Rulings do planejamento:**

- **R1. Onde vivem os cadastros.** Plano de contas, centros de custo, cargas, parâmetros do exercício, parâmetros do sistema (`instituicao.*`), Tabela Mestre, cargos, tabela salarial e o `MotorCustoPessoal` ficam no módulo **`cad`**, com schema em `prisma/schema/cad.prisma`.
  - **Fonte:** spec §3.1, §6.4, §12.2 e §12.3.
  - **Relação com outros módulos:** só por chave natural (classificação, ano), sem FK cruzada (§12.7 item 1).
- **R2. `MotorCustoPessoal` × `MotorCustoPosicao`.** Vale a spec (§6.4, §6.6, C33): o nome do conceito é `MotorCustoPessoal`, e a função do contrato é `calcularCustoPosicao`. O título da issue #73 e o da US-121 não mudam código.
- **R3. Mudanças dos contratos em relação ao plano-mestre (M-spec).**
  - **C1/C2 recebem o `tx` do consumidor** como primeiro parâmetro, como o `enviarEmail` do C4. Assim, a US-121 lê e grava na mesma transação.
  - **`calcularCustoPosicao` devolve `Resultado<SerieMensalComponentes>`**, e não a série direto, porque posição inválida é erro de validação ([TRAVA O ERRO], §5).
  - **Sem guarda própria:** as funções do C1/C2 não têm guarda; quem chama já passou pela guarda da própria funcionalidade. Elas nunca são expostas como Server Action.
  - **Spec v1.6 e plano-mestre:** registrar as duas mudanças.
- **R4. Leitura segura de .xlsx, no `ger`** (Review Focus 4; exposta em `@/modules/ger/servidor` como acréscimo ao C3, para o `cad` e para a US-121 da frente A).
  - **Antes do ExcelJS:**
    - **arquivo:** assinatura `PK\x03\x04`, no máximo 1 MB e o nome saneado (sem caminho nem caractere de controle, até 120 caracteres);
    - **diretório central:** no máximo 50 entradas, soma descompactada de até 20 MB e razão de compressão de até 100 por entrada;
    - **descompactação:** cada entrada com `zlib.inflateRawSync(…, { maxOutputLength })`, conferindo que o tamanho real é igual ao declarado;
    - **XML:** com `<!DOCTYPE` ou `<!ENTITY`, a planilha é recusada.
  - **Concorrência:** no máximo 1 leitura por processo (semáforo, adquirido antes de ler); a segunda recebe "Outra planilha está sendo lida. Tente de novo em instantes."
  - **Leitura:** pelo ExcelJS em *stream*, com no máximo 20.000 linhas, 30 colunas e 1.000 caracteres por célula.
    - Colunas reconhecidas pelo **nome**, sem diferenciar maiúsculas e acentos.
    - Só valores: fórmula vale o resultado gravado, e fórmula sem resultado é **erro na linha**.
  - **Layouts:**
    - **plano de contas:** o da planilha oficial (aba "Plano de Contas", cabeçalho na linha 1: Nível, Classificação, Conta Superior, Descrição, Tipo, Conta Reduzida);
    - **CC:** o da minuta (cabeçalho achado pela célula "Classificação" nas 10 primeiras linhas; colunas Classificação, Código reduzido, Descrição (original), Descrição sugerida, Nível, Classificação pai, Tipo, Aceita lançamento). A coluna Observação é ignorada (§6.1a).
- **R7. Salários cifrados por coluna (D10, com a premissa ajustada; confirmação na pendência P1).**
  - **Por que cifrar:** o disco da VPS (D8) não é cifrado; só os backups são. E a objeção da D10 (a cifra impede somar no banco) não se aplica: o motor e o `TotalizerService` somam na aplicação.
  - **Algoritmo:** AES-256-GCM (`node:crypto`), com IV de **12 bytes aleatório** por cifra e *tag* de **16 bytes obrigatória** (`authTagLength: 16` no `createDecipheriv`; *tag* de outro tamanho é recusada).
  - **Envelope:** `v1:<idChave>:<iv>:<tag>:<cifra>` em base64url.
  - **AAD:** `cad.cargo:<codigoDoCargo>:<campo>:<idChave>`. O código do cargo é a chave natural, conhecida antes do *merge*; o AAD impede trocar o valor de linha, de campo ou de chave.
  - **Campos cifrados:** `salario_real`, `salario_definido` e `funcao_gratificada`. Os salários de mercado (pesquisa externa) e a tabela salarial ficam em claro.
  - **Chaves:** `CHAVE_CIFRA_SALARIOS` (32 bytes em base64) e `CHAVE_CIFRA_SALARIOS_ID` são a chave atual. `CHAVE_CIFRA_SALARIOS_ANTERIORES` (`id1:base64;id2:base64`) formam o *keyring* com **todas** as chaves anteriores; o envelope é decifrado pela chave do seu `idChave`.
    - Existem só no serviço `app` do Easypanel; no dev, só no `.env.local`. O worker não recebe a chave.
    - Com `AMBIENTE=producao`, a chave fixa dos testes é recusada.
    - Sem a chave, só as funções de cargo falham (`ErroDominio('cad.cifra_indisponivel')`, log `[CIFRA_SALARIOS_AUSENTE]`).
  - **Cifra na importação:** o app cifra o salário real ao montar o *staging*, porque é ele quem tem a chave; o worker só copia o envelope.
  - **Rotação (I7):** a ação "Regravar salários com a chave atual" (`cad.cargos:executar`, Task 12b) decifra com o *keyring* e cifra com a chave atual.
    - Os campos manuais são gravados pelo app.
    - O `salario_real`, coluna do `sgo_sync`, vai num lote de *staging* do tipo `CARGOS_RECIFRA`. O worker aplica só onde o envelope atual ainda é o antigo (otimista).
    - O roteiro fica em `docs/operacao/ambientes.md`: gerar a chave nova, mover a atual para `_ANTERIORES`, rodar a regravação, conferir que nenhum envelope usa o id antigo e, depois, retirar a antiga.
  - **No Histórico,** o campo de salário vai como o envelope. O envelope só é regravado quando o valor muda, para o delta não acusar mudança falsa. A consulta do Histórico está fora da trilha (§3.3); quando existir, decifra só para quem tem `cad.salarios:consultar` (registrado para a frente A).
  - **Limite:** a cifra **não** protege contra uma VPS comprometida, porque a chave fica nas variáveis do app no mesmo host. Ela protege o disco, as cópias e os backups. Isso vai para o texto da D10 na v1.6.
  - **Mensagens (I9):** mensagens de linha, avisos, logs e erros das colunas de salário nunca repetem o valor; citam só a linha e a coluna.
- **R8. Versão dos modelos de e-mail.**
  - Cada modelo tem versões imutáveis em código (`ger/domain/modelos/<modelo>.v<n>.ts`), e `VERSAO_ATUAL` aponta a vigente.
  - O *payload* leva `{ modelo, versao, destinatario, dados, criadoEm }`; a nova tentativa renderiza a mesma versão.
  - **Imutabilidade:** um teste guarda o SHA-256 do texto-fonte de cada versão publicada. Alterar uma versão reprova o teste, o que força criar a `v<n+1>`.
  - **Assunto (RN0006):** etiquetas legíveis, como `[SGO 2.0][Acesso] …`.
  - **Nome da instituição:** vem de `instituicao.nome_exibicao`, validado (até 120 caracteres, sem caractere de controle) e escapado. Vazio por padrão (§6.7).
- **R10. Parâmetros por exercício e do sistema.**
  - **Por exercício** (US-053): premissas e parâmetros financeiros por `ano` (2000–2099), em tabelas tipadas. O exercício (`OrcamentoExercicio`) é do `orc` (US-055, frente A).
    - **Versão única do ano (I6):** **toda** escrita em qualquer tabela do ano incrementa `parametros_exercicio.versao` na mesma transação: parâmetros, encargos, contas por componente, SMN e Tabela Mestre. O C2 documenta que `PremissasExercicio.versao` muda com qualquer uma delas.
    - **Congelamento:** os parâmetros de um ano congelam quando a frente A oficializa o exercício (`congelarPremissasExercicio`, C2). É assim que "nunca altera snapshot oficializado" vale para a Adm. Central.
  - **Do sistema:** `instituicao.nome_exibicao` e `instituicao.logotipo` ficam em `parametro_sistema` (`cad`), vazios, sem tela na trilha. A tela será a Administração › Parâmetros, da frente A, depois de 30/11.
  - **E-mail:** o trabalhador recebe o nome por função injetada pelo `worker/index.ts` (`() => ''` até a Task 9b).
- **R11. Estrutura Funcional fora da trilha × RN_CAR_01.** A US-048 (Estrutura Funcional) não está na trilha (§3.3), mas a RN_CAR_01 impede salvar cargo sem vínculo funcional. Na trilha, o `cargo` tem `vinculo_funcional_id` **opcional** (sem FK), e a RN_CAR_01 fica desligada até a US-048. Pendência P2.
- **R12. Benefícios: Tabela Mestre por exercício.**
  - **Item:** `codigo` (`beneficio.<nome>`), forma (`VALOR_MENSAL`, `VALOR_DIARIO` × dias úteis ou `PERCENTUAL_SALARIO`), valor ou percentual, conta analítica, `padraoPosicao`, `ativo` e `provisorio`.
  - **Posição sem cargo (C34):** usa os itens ativos com `padraoPosicao` e valor preenchido. Item padrão sem valor gera aviso, não erro.
  - **Cargo** (RN_CAR_06/07): guarda o valor manual e a origem. A alteração de um item da Tabela Mestre sobrescreve o valor manual em todos os cargos, com Histórico (C8).
  - **Auxílio creche:** item manual do cargo, fora da Tabela Mestre (C&S V4 §6.4).
  - **Novo ano:** o `garantirPremissasExercicio` copia também a Tabela Mestre do ano anterior (Task 10).
- **R13. Encargo: total pelo percentual somado, resto no INSS [PROVISÓRIA, pendência P9].** O total é `base × soma dos percentuais`, com um único Half-Even. Cada componente é arredondado em separado, e a diferença de centavo vai para o INSS (o maior), como o `distribuirEm12` faz com dezembro. A soma das contas analíticas fecha com o total.
- **R14. Componentes do custo e contas [PROVISÓRIA, pendência P10 para o que está fora da §6.6].**
  - **Componentes:** `salario`, `adicional`, `ferias`, `decimo_terceiro`, `encargo.inss`, `encargo.fgts`, `encargo.pis`, `encargo.obrigacoes`, `encargo.riscos` e `beneficio.*`.
  - **Contas da §6.6:**

    | Componente | Conta |
    | --- | --- |
    | `salario` | 4.1.1.1.001 |
    | `ferias` | 4.1.1.1.003 |
    | `decimo_terceiro` | 4.1.1.1.005 |
    | `encargo.inss` | 4.1.1.2.001 |
    | `encargo.fgts` | 4.1.1.2.005 |
    | `encargo.pis` | 4.1.1.2.008 |
    | saúde | 4.1.1.1.008 |
    | VR | 4.1.1.1.009 |
    | seguro de vida | 4.1.1.1.007 |

  - **Fora da §6.6, marcadas provisórias:**

    | Componente | Conta | Observação |
    | --- | --- | --- |
    | `adicional` | 4.1.1.1.025 | — |
    | `encargo.obrigacoes` | 4.1.1.8.003 | GAP-CAR-005 |
    | `encargo.riscos` | 4.1.1.8.004 | GAP-CAR-005 |
    | VA | 4.1.1.1.021 | — |
    | odontológico | 4.1.1.1.013 | — |

  - **Ordem das operações, por mês ativo `m`, com um único arredondamento Half-Even por componente (M-spec):**
    1. `salario(m) = salarioMensal.multiplicar(quantidade).multiplicar(fator(m))`. A primeira multiplicação é exata (inteiro × 2 casas); a segunda arredonda uma vez. `fator(m) = 1 + reajuste` a partir do mês da data-base; antes dele, `fator(m) = 1`.
    2. `adicional(m)`, uma das duas fórmulas, arredondando uma vez:
       - periculosidade: `salario(m).multiplicar('0.30')`;
       - insalubridade: `smn.multiplicar(quantidade).multiplicar(grau)`, sem reajuste.
    3. `base(m) = salario(m) + adicional(m)`, exato.
    4. `ferias(m) = base(m).multiplicar('4').dividir('36')`. A multiplicação é exata; a divisão arredonda uma vez.
    5. `decimo_terceiro(m) = base(m).dividir('12')`.
    6. `baseEncargo(m) = base(m) + ferias(m) + decimo_terceiro(m)`. Cada encargo é `baseEncargo(m) × percentual`, arredondado uma vez, e o total e o resto seguem a R13.
    7. Benefícios:
       - `VALOR_MENSAL`: `valorMensal.multiplicar(quantidade)`, exato;
       - `PERCENTUAL_SALARIO`: `salario(m).multiplicar(percentual)`, arredondado uma vez (R14a).

    Fora dos meses entre o início e a saída, tudo é zero.
- **R15. Seed e dados de referência.**
  - **`seedCad` (todos os ambientes):** funcionalidades pelo C6 e padrões provisórios de 2027: parâmetros, Tabela Mestre sem valores e `parametro_sistema` vazio.
  - **`seedDadosReferenciaCad` (só com `CARGA_DADOS_REFERENCIA=1`):** carrega, pelo mesmo núcleo de *merge* (R6):
    - o plano de contas oficial;
    - a minuta de CC (`provisorio = true`);
    - cargos sintéticos sem salário.
  - **Produção:** com `AMBIENTE=producao`, a seed **falha** se `CARGA_DADOS_REFERENCIA=1` estiver definida, com a mensagem "CARGA_DADOS_REFERENCIA não pode ser usada em produção (R15)" (M1).
  - **Origem dos dados:** JSON em `src/modules/cad/infrastructure/dados/`, transcritos das planilhas oficiais sem a sigla. Um teste (fora de `domain/`) localiza as planilhas por *glob* e prova a igualdade, exceto pela descrição saneada.
- **R16. CC em prod só com a DIREX (GAP-CC-001).**
  - **Sem `CC_CARGA_PROVISORIA=1`** (dev e hml têm, no serviço `app`; prod não tem): a importação de CC exige "Aprovado pela DIREX em" (data) e "Documento de aprovação" (referência), gravados no lote e no Histórico. A carga entra com `provisorio = false`.
  - **Com a variável:** a carga sem aprovação entra com `provisorio = true`.
  - **Produção:** com `AMBIENTE=producao`, a variável é ignorada, com o log `[CC_CARGA_PROVISORIA_IGNORADA]` (M1).
  - **Padrão seguro:** variável ausente = exige aprovação.
- **R17. Regra R3 da minuta (CC de gestão).**
  - O CC analítico com sufixo `.0` no nível 3 ou `.10` no nível 4 recebe `de_gestao = true`.
  - A carga **avisa**, sem bloquear, a diretoria sintética de nível 2 e a gerência sintética de nível 3 que não tenham exatamente um filho de gestão. O nível 1 fica de fora (GAP-CC-005).
  - Na minuta, são 7 CCs de gestão e nenhum aviso.
  - `natureza` fica nula (GAP-CC-006).
  - O formato do reduzido de CC (`^\d{2}\.\d{3}$`) é validado **só na aplicação**, sem `CHECK` no banco, porque a numeração ainda pode mudar (GAP-CC-003).
- **R18. Tree Grid única e filtros [pendência P11 para a TanStack Table].**
  - **Virtualização:** `@tanstack/react-virtual`, com linha de altura fixa e linhas espaçadoras. Continua sendo `<table role="treegrid">`, com `aria-rowcount`/`aria-rowindex` e teclado (↑ ↓ → ←).
  - **Filtros:** declarativos (texto em várias colunas, seleção, ocultar zerados RF0006), aplicados no cliente sobre a árvore. Um nó aparece se ele ou algum descendente casa.
  - **Retenção:** os filtros ficam no `sessionStorage`, com o `escopoSessao` (*hash* do `sessaoUid`), nunca no `localStorage`. A fonte é a spec §5: "estado de formulário nunca vai para `localStorage` (RNF0002 do EP084)". O logoff limpa o `sessionStorage` (US-032).
  - **TanStack Table:** a §4.2 cita "TanStack Table + virtualização". O plano usa só a virtualização, porque a grade já tem o modelo de colunas do C3, e a árvore, a ordenação fixa por classificação e os filtros declarativos não usam o motor de tabela. A TanStack Table entraria como dependência sem uso. Registrar na v1.6 (pendência P11).
- **R19. Total na Fonte Ativa: Máximo + Função Gratificada [PROVISÓRIA, pendência P4].** O C&S V4 diz "Salário Mín ou Máx + Função Gratificada" sem dizer qual; o máximo é a base mais conservadora para orçar.
- **R20. Cargos do Rubi por arquivo (GAP-INT-005).** Os campos de origem Rubi chegam por importação .xlsx, layout `CAD-CARGOS v1.0` (pendência P3), pelo mesmo caminho de *staging* e worker (R6). O salário real é cifrado pelo app (R7), e o casamento é pelo Código do Cargo.
  - **Colunas:** Código do Cargo, Cargo (nome oficial), Cargo Mercado, Tabela Salarial (código), Tabela Salarial (descrição), Faixa (código), Faixa (descrição), Nível (código), Nível (descrição) e Salário Real.
  - **Conflito resolvido:** o "Cargo Mercado" é de origem Rubi (C&S V4 §4.1), não digitado (Minuta V5); vale o C&S V4, mais recente (§2.2).
- **R21. Exportação real sem marca d'água.** O `exportarXlsx` do C3 gera o .xlsx com ExcelJS. Cabeçalho de filtros, marca d'água e registro de exportação são da US-024, fora da trilha.
  - Todo texto de dado é gravado como valor de texto (`cell.value = string`), nunca como `{ formula }` nem `{ hyperlink }`. Isso inclui os que começam com `=`, `+`, `-`, `@`, `\t` ou `\r`.
  - Dinheiro vai como número com formato `#,##0.00`, convertido do texto decimal.
- **R22. Entradas públicas `index.ts` e `servidor.ts` (I13).**
  - **Lint:** a Task 0 muda a regra de fronteira (PR compartilhado) para aceitar `src/modules/<mod>/servidor.ts` como segunda entrada pública.
  - **`servidor.ts`:** exporta só código de servidor sem React (trabalhador de e-mail, processador de cargas, leitor de .xlsx, funções do C1/C2).
  - **`index.ts`:** reexporta o C1/C2 para os casos de uso, mas nunca o trabalhador, o processador de cargas nem o SMTP.
  - **Worker:** `worker/index.ts` importa só os `servidor.ts`.
  - **Teste:** o build do worker gera o *metafile* do esbuild, e o teste reprova se aparecerem `react`, `react-dom`, `next` ou arquivos `.tsx`.
- **R25. Ambiente explícito (M1).** A variável `AMBIENTE` (`dev`, `hml` ou `producao`) existe no `app` e no `worker` de hml e prod. Ausente conta como `dev`, e só o valor `producao` liga as travas da R7, da R15 e da R16.

## Decisões pendentes do PO

| # | Decisão | Recomendação | Se não decidir até |
| --- | --- | --- | --- |
| P1 | Cifra por coluna dos salários do cargo (R7), que ajusta a D10 | **Aprovar** e registrar na v1.6: a cifra protege disco, cópias e backups, mas não uma VPS comprometida. O PO guarda a cópia das chaves fora da VPS. A cifra e a máscara do salário das posições de pessoal no `orc` (P6) ficam com a frente A, com a mesma recomendação | Task 12a: sem decisão, segue a R7, que é reversível |
| P2 | Cargo sem vínculo funcional na trilha (R11) | **Aprovar** até a US-048 | Task 12a |
| P3 | Layout `CAD-CARGOS v1.0` da planilha do Rubi (R20) | **Aprovar** e pedir à GRH a exportação nesse formato | Task 12a: dados sintéticos em dev/hml |
| P4 | "Salário Total" = Máximo + Função Gratificada (R19) | **Aprovar** como [PROVISÓRIA] e validar com a GRH | Task 12a |
| P5 | Perfis com `cad.salarios:consultar` por padrão (R24) | **Analista GRH e GFIN.** Auditor, Orçamentista, Gestor de Diretoria e DIREX veem mascarado | Task 12b |
| P6 | Benefícios da posição padrão da Adm. Central (R12) e dias úteis | **Seguro saúde Básico, Vale-refeição e Seguro de vida**, com **22 dias úteis** [PROVISÓRIOS]. A GRH preenche os valores de 2027 antes da US-121 | 13/11 (Task 10) |
| P7 | SMTP de prod e hml, remetente e domínio (GAP-INF-001) | Provedor transacional com STARTTLS na porta 587, SPF/DKIM/DMARC, remetente `nao-responda@<domínio>`, credenciais só no `worker` | ~05/11 |
| P8 | Registro da aprovação da DIREX na carga de CC em prod (R16) | **Data e referência do documento**, digitadas pela GFIN e auditadas | ~16/11 (GAP-CC-001) |
| P9 | Resto de centavo do encargo no INSS (R13) | **Aprovar** como [PROVISÓRIA] e confirmar com o Wellington (GFIN, SME de contabilidade) | Task 11 |
| P10 | Contas fora da §6.6 (R14): adicional em 4.1.1.1.025, VA em 4.1.1.1.021, odontológico em 4.1.1.1.013 | **Aprovar** como [PROVISÓRIAS], parametrizadas por exercício, e confirmar com o Wellington | Task 9a |
| P11 | TanStack Table fora da grade, contra a §4.2 (R18) | **Aprovar** e ajustar a §4.2 na v1.6 para "virtualização com TanStack Virtual" | Task 6a |
| P12 | Faixas do semáforo por exercício, contra a C7 (`ParametroSistema` global) | **Por exercício**, porque a US-053 pede "parâmetros por exercício" e o teto é anual (§6.6). Registrar na v1.6 (C7) | Task 9a |

## Review Focus

1. **Dinheiro virando `number`.**
   - Esperado: a conversão de célula numérica fica no leitor (`infrastructure/`), com `Dinheiro.de(String(valor))`. Ela recusa mais de 2 casas e 15 dígitos significativos ou mais. Nada de `parseFloat`/`Math.round`/`toFixed` em `domain/`.
   - Teste: `célula 1234.56 vira "1234.56"` e `célula com 3 casas é recusada` (Task 4a).
   - **Reduzido de CC numérico:** "14.180" viraria 14,18. Esperado: erro na linha (Task 5).
2. **Estrutura alterada por fora da carga, ou com classificação trocada.** Esperado:
   - a matriz de privilégios bate (Global Constraints, B1);
   - a carga recusa rodar com papel diferente de `sgo_sync`;
   - a recarga nunca muda classificação, nível, pai ou tipo (R5);
   - o *payload* com campo de estrutura é recusado e auditado.

   Testes `privilegios.int.test.ts`, `carga só como sgo_sync` e `recarga não muda classificação` (Tasks 4b, 5 e 12a).
3. **Carga parcial ou concorrente.** Esperado:
   - erro em uma linha reprova o arquivo inteiro, nada vai para o *staging* e a tela lista os erros por linha;
   - falha no *merge* deixa o lote `FALHOU`, sem nada aplicado;
   - uma segunda carga do mesmo tipo é recusada na hora (índice parcial);
   - recarga idempotente;
   - registro ausente inativado.

   Testes nas Tasks 4b e 5.
4. **Planilha maliciosa (R4).** Esperado: zip bomb recusada **sem estourar a memória** (o teste roda com `--max-old-space-size=256` num processo filho); DOCTYPE recusado; mais de 50 entradas recusado; fórmula sem resultado vira erro na linha; célula acima de 1.000 caracteres recusada; leituras simultâneas limitadas a 1. Testes na Task 4a.
5. **Salário em claro.** Esperado:
   - nenhum salário em claro no banco, no Histórico, em log, em mensagem de linha ou aviso (I9);
   - nada nas *props* de quem não tem `cad.salarios`, nem na exportação;
   - o total, o encargo e o desvio de mercado também saem mascarados (R24);
   - a chave não está no repositório;
   - o envelope trocado de linha, de campo ou de chave não decifra;
   - a *tag* truncada é recusada e os IVs nunca se repetem;
   - a chave de teste é recusada em produção.

   Testes na Task 12.
6. **Senha temporária vazando pelo e-mail.** Esperado:
   - depois de sucesso, falha definitiva ou expiração, uma varredura de `pgboss.job`, `outbox_mensagem` e `historico_operacao` não acha a senha (R23);
   - o worker revalida destinatário e dados antes de renderizar;
   - o link é exatamente `${URL_PUBLICA}/login`, sem *query*, fragmento nem credencial;
   - o `nomeExibicao` é escapado;
   - o SMTP usa TLS de verdade (I4).

   Testes na Task 1.
7. **CC provisório em prod.** Esperado: com `AMBIENTE=producao`, a carga de CC sem data e documento da DIREX é recusada, mesmo com `CC_CARGA_PROVISORIA=1`. Teste na Task 8.
8. **Parâmetro de exercício oficializado mudando, ou versão que não muda.** Esperado:
   - depois de `congelarPremissasExercicio(ano)`, toda alteração do ano dá `cad.exercicio_congelado`;
   - toda escrita em qualquer tabela do ano incrementa a `versao` (R10).

   Testes nas Tasks 9a e 10.
9. **Motor com valor errado.** Esperado: os valores conferidos à mão da Task 11 batem ao centavo, inclusive o Half-Even (9.594,375 vira 9.594,38) e o resto do encargo no INSS.
10. **Bundle errado.** Esperado:
    - nenhum `'use client'` importa o `index.ts` do próprio módulo;
    - o `index.ts` do `ger` e o do `cad` não alcançam nodemailer, `node:crypto`, `pg`, o trabalhador nem o processador (teste da Task 0);
    - o *metafile* do worker não tem React nem `next` (R22).

---

## Ordem e dependências

| # | PR | Depende de | Migration | Lentes extras (§12.12) | Previsão |
| --- | --- | --- | --- | --- | --- |
| 0 | compartilhado: dependências, lint de `servidor.ts`, `next.config`, `vitest.config`, `.env.example`, compose do worker | este plano | — | security-review | 27/10 |
| 1 | US-025 #47 (`Closes #47`): e-mail real pelo worker | 0 | — | security-review, silent-failure-hunter | 27/10 – 29/10 |
| 2 | Contrato C1 (`Refs #65 #68 #143`) + issue do C6 (`exibirNoMenu`) | 0 | — | type-design-analyzer | 29/10 |
| 3 | Contrato C2 (`Refs #73 #75 #143`) | 2 (usa as classificações do C1) | — | type-design-analyzer | 29/10 – 30/10 |
| 4a | US-043 parte 1 (`Refs #65`): leitor seguro de .xlsx (`ger`) e validação do plano (pura) | 0 | — | security-review | 30/10 – 31/10 |
| 4b | US-043 parte 2 (`Refs #65`): migration, *staging*, *merge* no worker, C1 real das contas | 2, 4a | `…_cad_plano_contas` | security-review, silent-failure-hunter | 31/10 – 04/11 |
| 4c | compartilhado: `prisma/seed.ts` registra `seedCad` e `seedDadosReferenciaCad` | 4b | — | — | 04/11 |
| 5 | US-046 parte 1 (`Refs #68`): CC, *merge* e C1 real dos CCs | 4b | `…_cad_centros_custo` | security-review, silent-failure-hunter | 05/11 |
| 6a | US-021 parte 1 (`Refs #43`): virtualização, teclado e medição de rolagem | 0 | — | — | 06/11 |
| 6b | US-021 parte 2 (`Refs #43`): `exportarXlsx` real | 0 | — | security-review | 06/11 |
| 6c | US-021 parte 3 (`Closes #43`): filtros retidos na sessão | 6a | — | — | 09/11 |
| 7a | US-043 parte 3 (`Closes #65`): tela de importação do plano | 4b, 6c | — | security-review | 10/11 |
| 7b | US-044 #66 (`Closes #66`): consulta em árvore | 7a | — | — | 10/11 |
| 8 | US-046 parte 2 (`Closes #68`): telas de CC e trava da DIREX | 5, 7a | — | security-review | 11/11 |
| 9a | US-053 parte 1 (`Refs #75`): migration, domínio, `garantir`/`congelar` do C2 | 3, 4b | `…_cad_parametros` | security-review | 11/11 |
| 9b | US-053 parte 2 (`Closes #75`): telas, ações e nome de exibição no worker | 9a, 1, 6c | — | — | 12/11 |
| 10 | US-050 parte 1 (`Refs #72`): Tabela Mestre por exercício | 9a | `…_cad_beneficios` | — | 13/11 |
| 11 | US-051 parte 1 (`Refs #73`): motor real e `obterPremissasExercicio` (**C2 real**) | 3, 9a, 10 | — | type-design-analyzer, silent-failure-hunter | 13/11 – 17/11 |
| 12a | US-049 parte 1 (`Refs #71`): schema, cifra, domínio e importação Rubi | 4b, 6c, 9a | `…_cad_cargos` | security-review, type-design-analyzer | 18/11 |
| 12b | US-049 parte 2 (`Refs #71`): telas de cargo com máscara e regravação da cifra | 12a, 9a (SMN, E6), issue do C6 (R24) | — | security-review | 19/11 |
| 12c | US-049 parte 3 (`Closes #71`): tabela salarial e senioridades | 12a | — | — | 20/11 |
| 13 | US-050 parte 2 (`Closes #72`): benefícios do cargo e sobrescrita | 10, 12b | `…_cad_beneficio_cargo` | silent-failure-hunter | 23/11 |
| 14 | US-051 parte 2 (`Closes #73`): custo do cargo pelo motor (REQ_CAR_013) | 11, 13 | — | security-review | 24/11 |

**Por que esta ordem:**
1. **US-025 primeiro.** É pequena, não depende de GAP para ficar pronta em código, e a Task 6a do P5 (frente A) está bloqueada por ela.
2. **Contratos C1 e C2 logo em seguida** (spec §12.6). A frente A detalha o P6 a partir de ~25/11 e precisa das interfaces bem antes.
3. **Carga e C1 real antes das telas.** As Tasks 4a, 4b e 5 são leitor, domínio, banco e worker; não dependem da grade. O C1 real fica pronto cedo, e a minuta de CC entra em dev/hml antes do marco da DIREX (16/11).
4. **US-021 antes das telas de consulta grandes.** O backlog põe a US-043 dependendo da US-021. A divisão respeita isso: a tela da US-043 (7a) e a US-044 (7b) vêm depois da grade e dos filtros.
5. **Parâmetros, Tabela Mestre e motor antes dos cargos.** O caminho crítico da trilha é o C2 real para a US-121, que calcula posições com cargo em **texto livre** (C34), sem cadastro de cargo. A parte do motor que depende do cargo fica na Task 14. O C2 real chega à `main` por volta de 17/11, antes do marco de 20/11.

As datas supõem a frente B só no P4, a 40 h/semana, a partir de 27/10. As Tasks 6 a 8 do P3 (GAP-INF-001) intercalam quando o PO destravar o GAP; nesse caso, as Tasks 12 a 14 (fora do caminho crítico) são as que deslizam.

**Interações com a frente A:**
- **Revisão de consumidor** (§12.12):
  - C1 e C2 (Tasks 2 e 3);
  - o acréscimo `lerPlanilhaSegura` ao C3 (Task 4a);
  - o C4 na Task 1: link igual a `${URL_PUBLICA}/login`, 3 tentativas e limpeza garantida (R23), com a **confirmação explícita** de que a pré-condição da Task 6a do P5 está satisfeita.
- **Issue de contrato C6** (Task 2): `exibirNoMenu?: boolean` em `DeclaracaoFuncionalidade` (R24). A Task 12b depende dela.
- **Issue de E2E** (Task 6a): o `e2e/global-setup.ts` cria um usuário GFIN (`E2E_GFIN_LOGIN`/`E2E_GFIN_SENHA`) para os E2E do `cad`.
- **Issue não bloqueante** (Task 1): dados da mensagem abandonada no `publicarOutbox` (R23).
- **Nota (P1):** a cifra e a máscara do salário das posições do `orc` ficam com a frente A; o Histórico de salário decifra só para `cad.salarios:consultar` quando a consulta do Histórico existir (R7).

## Estrutura de arquivos

```
prisma/schema/cad.prisma                                         (B, Task 4b cria; 5, 9a, 10, 12a, 13 alteram)
prisma/migrations/<AAAAMMDDHHMM>_cad_{plano_contas,centros_custo,parametros,beneficios,cargos,beneficio_cargo}/
src/modules/ger/servidor.ts                                                                (Task 1; R22)
src/modules/ger/domain/{modelos-email,renderizar-email}.ts · domain/modelos/*.v1.ts       (Task 1)
src/modules/ger/infrastructure/{config-smtp,smtp,trabalhador-email}.ts                     (Task 1)
src/modules/ger/infrastructure/{ler-xlsx,zip-seguro}.ts                                    (Task 4a; R4)
src/modules/ger/ui/{grade-arvore.tsx,grade-logica.ts,grade-virtual.ts,grade-filtros.ts}    (Task 6)
src/modules/ger/infrastructure/exportar-xlsx.ts                                            (Task 6b)
src/modules/cad/index.ts · servidor.ts · falsos.ts · contrato-c1.test.ts · contrato-c2.test.ts
src/modules/cad/domain/{estrutura,plano-contas,centros-custo,carga,parametros,beneficios,cargo,motor-custo-pessoal,semaforo}.ts
src/modules/cad/application/{estrutura-financeira,importar-estrutura,aplicar-carga,parametros,beneficios,cargos,tabela-salarial,premissas,saneamento}.ts
src/modules/cad/application/acoes-*.ts                                                     ('use server')
src/modules/cad/infrastructure/{cliente-sync,processador-cargas,cifra-salarios,seed,seed-referencia}.ts
src/modules/cad/infrastructure/dados/{plano-contas-oficial,cc-minuta-rev23102026,cargos-sinteticos}.json
src/modules/cad/ui/*.tsx
src/app/(sistema)/cad/{plano-contas,centros-custo,parametros,salario-minimo,beneficios,cargos,tabela-salarial}/**
e2e/cad/rolagem-plano.spec.ts                                                              (Task 6a)
worker/index.ts                                                                            (Tasks 1, 4b e 9b)
docs/operacao/{ambientes,deploy}.md                                                        (Tasks 1, 4b, 12a e 12b)
```

---

### Task 0: PR compartilhado do P4

**Files (só compartilhados; nenhum código de funcionalidade):**
- **`package.json`, `package-lock.json`:**
  - `exceljs`, `nodemailer`, `@tanstack/react-virtual` e `server-only` em `dependencies`;
  - `@types/nodemailer`, `smtp-server` e `@types/smtp-server` em `devDependencies`;
  - versões **exatas**, publicadas há mais de duas semanas (`npm view <pacote> time --json`), registradas no PR.
- **`eslint.config.mjs`** (R22): a entrada pública passa a ser `fileInternalPath` `index.ts` **ou** `servidor.ts`.
- **`next.config.ts`** (I2, M3): `experimental.serverActions.bodySizeLimit: '2mb'` (conferir o nome da chave no Next 16.4.3) e `serverExternalPackages: ['exceljs']`.
- **`vitest.config.ts` e `scripts/stub-server-only.ts`:** `resolve.alias['server-only']` aponta para um módulo vazio, porque o pacote lança erro fora do Next e os testes precisam importar os arquivos com `server-only`.
- **`.env.example`:**
  - SMTP: `SMTP_HOST`, `SMTP_PORTA`, `SMTP_SEGURANCA` (`tls`|`starttls`|`nenhuma`, **obrigatória quando há `SMTP_HOST`**, sem padrão), `SMTP_USUARIO`, `SMTP_SENHA` e `EMAIL_REMETENTE`;
  - `SYNC_DATABASE_URL="postgresql://sgo_sync:sgo_sync@127.0.0.1:55432/sgo_dev"`, com o comentário "só no worker";
  - `CHAVE_CIFRA_SALARIOS=`, `CHAVE_CIFRA_SALARIOS_ID=dev1` e `CHAVE_CIFRA_SALARIOS_ANTERIORES=`, com o comentário "só no app; gere com `openssl rand -base64 32`";
  - `AMBIENTE=dev`, `CARGA_DADOS_REFERENCIA=1` e `CC_CARGA_PROVISORIA=1`, com o comentário "as duas últimas nunca em produção".
- **`docker-compose.yml`:** no serviço `worker`, acrescentar:
  - `SMTP_HOST: mailpit`, `SMTP_PORTA: "1025"`, `SMTP_SEGURANCA: nenhuma` e `EMAIL_REMETENTE: "SGO 2.0 (dev) <nao-responda@sgo.local>"`;
  - `URL_PUBLICA: "http://127.0.0.1:${APP_PORT}"`;
  - `SYNC_DATABASE_URL: "postgresql://sgo_sync:sgo_sync@db:5432/sgo_dev"` e `AMBIENTE: dev`.

  A porta SMTP do Mailpit **não** é publicada.
- **Test:** `tests/arquitetura/compose-dev.test.ts`, `tests/arquitetura/fronteiras.test.ts` e o novo `tests/arquitetura/config-next.test.ts`.

- [ ] **Step 1: Testes que falham:**
  - **`compose-dev`:** o `worker` tem `SMTP_HOST=mailpit` e `SYNC_DATABASE_URL`, e o `mailpit` não publica a 1025;
  - **`fronteiras`:**
    - `import { x } from '@/modules/cad/servidor'` vindo de `src/modules/orc/application/a.ts` → aceito;
    - `'@/modules/cad/servidores'` e `'@/modules/cad/lib/servidor'` → recusados;
  - **`config-next`:** `bodySizeLimit` é `'2mb'` e `serverExternalPackages` contém `exceljs`.
- [ ] **Step 2:** `npx vitest run --project arquitetura` → FAIL.
- [ ] **Step 3: Implementar** e rodar `npm install` com as versões exatas.
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm test && npm run test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "Compartilhado do P4: dependências, entrada servidor.ts, limites de upload e variáveis de cadastros", labels `compartilhado` e `frente:B`, `Refs #47`. Lentes: plano/spec, testes, segurança e `security-review`. A frente A faz *rebase* depois do merge.

### Task 1: Envio real de e-mail pelo worker (US-025, #47; fecha o C4)

**Files:**
- Create:
  - `src/modules/ger/servidor.ts`;
  - `src/modules/ger/domain/renderizar-email.ts` e os modelos `src/modules/ger/domain/modelos/usuario-senha-inicial.v1.ts` e `usuario-senha-redefinida.v1.ts`;
  - `src/modules/ger/infrastructure/config-smtp.ts`, `smtp.ts` e `trabalhador-email.ts`.
- Modify:
  - `src/modules/ger/domain/modelos-email.ts` (versões, `criadoEm`, validação dos dados);
  - `src/modules/ger/application/email.ts` (real), `src/modules/ger/falsos.ts`, `src/modules/ger/index.ts`;
  - `worker/index.ts`;
  - `docs/operacao/ambientes.md` e `docs/operacao/deploy.md` (variáveis SMTP, `URL_PUBLICA` e `AMBIENTE` no `worker`).
- Test:
  - Create: `src/modules/ger/domain/renderizar-email.test.ts`, `src/modules/ger/domain/modelos-versoes.test.ts`;
  - Create: `src/modules/ger/infrastructure/config-smtp.test.ts`, `smtp.test.ts`, `trabalhador-email.test.ts`, `email.int.test.ts`;
  - Create: `worker/bundle.test.ts`;
  - Modify: `src/modules/ger/contrato-c4.test.ts`, `docker/testes/testar-imagem.sh` (passo 8).

**Interfaces:**
- Consumes:
  - de `@/shared/filas`: `registrarNoOutbox`, `publicarOutbox`, `criarFila` e `FilaGerenciada` (`registrarTrabalhador`, `consultar`, `apagarJob`);
  - `auditar` (`@/shared/audit`), `lerEnvAcesso()` (`@/shared/config`) e `criarPrisma` (`@/shared/db`);
  - `iniciarBancoTeste()` (`tests/integracao/banco.ts`).
- Produces:

```ts
// domain/modelos-email.ts (C4 acrescido)
export const VERSAO_ATUAL: { readonly [M in ModeloEmail]: number }; // R8
export type MensagemEmail = {
  [M in ModeloEmail]: { modelo: M; versao: number; destinatario: Destinatario; dados: DadosModeloEmail[M]; criadoEm: string /* ISO */ };
}[ModeloEmail];
export const VALIDADE_MENSAGEM_SENSIVEL_MS = 24 * 60 * 60 * 1000; // R23 (= senha temporária, C21)
export type EmailRenderizado = { assunto: string; texto: string; html: string };
// urlAcesso deve ser exatamente `${urlPublica}/login` (sem query, fragmento ou credencial); textos sem caractere de controle,
// com tamanho máximo. @throws ErroDominio('email.dados_invalidos')
export function validarDadosModelo(modelo: ModeloEmail, dados: unknown, urlPublica: string): void;

// domain/renderizar-email.ts (puro; escapa todo dado e o nomeExibicao no HTML; atributos entre aspas escapadas)
// @throws ErroDominio('email.modelo_desconhecido'); ErroDominio('email.nome_exibicao_invalido') (> 120 caracteres ou controle)
export function renderizarEmail(m: MensagemEmail, contexto: { nomeExibicao: string }): EmailRenderizado;

// infrastructure/config-smtp.ts (sem server-only: roda no worker)
export type ConfigSmtp = {
  host: string; porta: number; seguranca: 'tls' | 'starttls' | 'nenhuma';
  usuario?: string; senha?: string; remetente: { nome: string; email: string };
};
// null = sem SMTP_HOST. Com SMTP_HOST, SMTP_SEGURANCA é obrigatória (sem padrão). 'nenhuma' só com host de
// loopback ou 'mailpit' e AMBIENTE ≠ producao. Erro cita só os nomes das variáveis.
export function lerConfigSmtp(fonte?: Readonly<Record<string, string | undefined>>): ConfigSmtp | null;

// infrastructure/smtp.ts
// tls → secure: true; starttls → secure: false + requireTLS: true; sempre tls: { rejectUnauthorized: true,
// minVersion: 'TLSv1.2' }, logger: false, debug: false, connectionTimeout 10 s, socketTimeout 30 s.
// Envia com to: { name, address } e from estruturado, nunca string montada.
export interface TransporteEmail {
  enviar(m: { para: Destinatario; assunto: string; texto: string; html: string }): Promise<void>;
}
export function criarTransporteSmtp(cfg: ConfigSmtp, criar?: typeof nodemailer.createTransport): TransporteEmail;

// infrastructure/trabalhador-email.ts
export const NOVAS_TENTATIVAS_EMAIL = 3; // R9
export type DepsTrabalhadorEmail = {
  fila: FilaGerenciada; transporte: TransporteEmail | null; // null = sem SMTP (R23)
  cliente: PrismaClient; urlPublica: string; agora: () => Date;
  obterNomeExibicao: () => Promise<string>;
};
export function criarTrabalhadorEmail(deps: DepsTrabalhadorEmail): (m: unknown, job: { id: string }) => Promise<void>;

// servidor.ts (R22): o worker importa daqui
export function registrarTrabalhadoresGer(
  fila: FilaGerenciada,
  deps: { cliente: PrismaClient; obterNomeExibicao?: () => Promise<string> },
): Promise<void>; // sempre registra email.enviar; sem SMTP, emite [EMAIL_SEM_SMTP] uma vez
export { lerPlanilhaSegura } from './infrastructure/ler-xlsx'; // a partir da Task 4a
```

**Regras do trabalhador:**
1. **Revalidação (I5):** `validarDestinatario` e `validarDadosModelo(…, urlPublica)` sobre a mensagem do job. Se falhar, é falha definitiva, porque o *payload* pode ter sido adulterado no banco.
2. **Expiração:** `agora − criadoEm > 24 h` → falha definitiva "expirada".
3. **Tentativa:** `tentativa = (await fila.consultar('email.enviar', job.id))?.tentativas ?? 0`.
4. **Envio:** renderizar (com o nome de exibição validado) e enviar. Sem transporte, a tentativa falha com "SMTP não configurado".
5. **Histórico** `SISTEMA` (`funcionalidade 'ger.email'`, `origem 'SISTEMA'`): só modelo, versão, destinatário mascarado, tentativa e resultado (enviado, falha temporária, falha definitiva ou expirada), sem os dados.
6. **Resultado do envio:**
   - **sucesso:** termina normalmente;
   - **falha com `tentativa < 3`:** relança, para a fila tentar de novo com *backoff*;
   - **falha com `tentativa ≥ 3`:** é a definitiva e retorna sem erro, com o log `[EMAIL_FALHA_DEFINITIVA]` (modelo e destinatário mascarado).
7. **`finally`:** apaga o job (`fila.apagarJob`) quando o resultado for sucesso, falha definitiva ou expiração, sempre que o modelo for sensível e sempre na última tentativa. Uma falha do `apagarJob` gera `[EMAIL_JOB_NAO_APAGADO]` e relança.

- [ ] **Step 0: Preparar o banco de dev da frente B** (o volume 56432 ainda não tem o `sgo_fila`):
  1. conferir `COMPOSE_PROJECT_NAME=sgo-b` no `.env` e as quatro URLs em `127.0.0.1:56432`;
  2. `docker compose down -v` (**apaga** só o banco de dev local da frente B);
  3. `docker compose up -d --wait`;
  4. `npm run db:deploy` e `npm run db:seed` (**escrevem** no dev local).
- [ ] **Step 1: Testes de unidade (falham):**
  - **`renderizarEmail`:**
    - sem nome de exibição, assunto `[SGO 2.0][Acesso] …`;
    - `nome = '<script>'`, `nome` com `"` e `nomeExibicao` com `<b>` saem escapados;
    - nenhuma saída contém a marca vedada (a sigla é montada em tempo de execução, fora de `domain/`: o teste fica em `domain/` só se não importar `@/shared/config`; senão, em `application/`);
    - versão `99` → `email.modelo_desconhecido`;
    - `nomeExibicao` com `\r\n` → erro.
  - **`modelos-versoes.test.ts`:** o SHA-256 de cada `(modelo, versão)` bate com a tabela (R8).
  - **`validarDadosModelo`:** com `URL_PUBLICA=https://sgo.exemplo`:
    - passa só `https://sgo.exemplo/login`;
    - recusa `http://sgo.exemplo/login`, `https://sgo.exemplo/login?x=1`, `…#a`, `https://u:p@sgo.exemplo/login`, `https://outro/login`, `javascript:` e `\r\n` no nome.
  - **`lerConfigSmtp`:**
    - sem `SMTP_HOST` → `null`;
    - `SMTP_HOST` sem `SMTP_SEGURANCA` → erro citando o nome;
    - `nenhuma` com host `smtp.provedor.com` → erro;
    - `AMBIENTE=producao` com `nenhuma` → erro;
    - a mensagem nunca contém o valor de `SMTP_SENHA`.
  - **`smtp.test.ts`** (espião no `createTransport`, I4):
    - `starttls` → `{ secure: false, requireTLS: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, logger: false, debug: false }`;
    - `tls` → `secure: true`;
    - o `sendMail` recebe `to: { name, address }`.
  - **`trabalhador-email.test.ts`** (transporte, fila e `auditar` falsos; relógio fixo):
    - sucesso → 1 envio, 1 Histórico e `apagarJob`;
    - falha com `tentativas: 1` → relança, sem `apagarJob` (sensível ou não: os dados ficam para a nova tentativa e saem no fim, R23);
    - falha com `tentativas: 3` → não relança, Histórico "falha definitiva" e `apagarJob`;
    - erro 550 na tentativa 1 → relança (R9, D-c);
    - `criadoEm` de 25 h atrás → nenhum envio, Histórico "expirada" e `apagarJob`;
    - transporte `null` → falha "SMTP não configurado", seguindo as mesmas regras;
    - `urlAcesso` adulterada no job → falha definitiva, sem envio;
    - `apagarJob` lançando → `[EMAIL_JOB_NAO_APAGADO]` e relança;
    - um espião em `console.*` e o `depois` do Histórico não contêm a `senhaTemporaria`.
- [ ] **Step 2: Integração `email.int.test.ts` (falha).** Usa `iniciarBancoTeste()`, `criarFila(urlFila)` e o `smtp-server` em `127.0.0.1`, sem TLS, com o trabalhador configurado para `nenhuma`, em `AMBIENTE=test`:
  - **commit:** `enviarEmail` → `publicarOutbox` → envio. Chega a mensagem v1, e a **varredura** (SQL `LIKE '%<senha>%'` em `pgboss.job`, `outbox_mensagem.dados` e `historico_operacao` inteiros) dá 0 linhas;
  - **rollback:** nenhuma linha no *outbox* e nada no SMTP;
  - **SMTP respondendo 550 quatro vezes** (tentativa forçada pelo `retryDelay`, ou o trabalhador chamado 4 vezes com o `consultar` real): 4 Históricos, o último "falha definitiva", e a varredura vazia;
  - **expiração:** mensagem com `criadoEm` antigo → varredura vazia;
  - **destinatário inválido** → `email.destinatario_invalido` antes de gravar.
- [ ] **Step 3:** `npx vitest run --project unidade src/modules/ger worker` e, sozinho (D12), `npx vitest run --project integracao src/modules/ger` → FAIL.
- [ ] **Step 4: Implementar.**
  - **`enviarEmail` real:** `validarDestinatario` → `validarDadosModelo(modelo, dados, lerEnvAcesso().urlPublica)` → `await import('@/shared/filas')` → `registrarNoOutbox(tx, 'email.enviar', { modelo, versao, destinatario, dados, criadoEm })`.
  - **`emailFalso`:** chama a mesma validação.
  - **`worker/index.ts`:** importa só `@/modules/ger/servidor` e chama `registrarTrabalhadoresGer(fila, { cliente: prisma })`.
  - **JSDoc do C4:** corrigir conforme R9 e R23.
- [ ] **Step 5: Bundle real do worker (I13), sozinho (D12):**
  - **`worker/bundle.test.ts`:** roda o `esbuild` do `worker/build.mjs` com `metafile: true` para um diretório temporário. Reprova se o *metafile* tiver `node_modules/react`, `react-dom`, `next/` ou arquivos `.tsx`.
  - **`docker/testes/testar-imagem.sh`, passo 8:** passa a exigir `email.enviar` na lista de filas do log `worker pronto`.
- [ ] **Step 6:** suítes do Step 3 + `npm run lint && npm run typecheck && npm run test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 7: Prova no dev com o Mailpit** (D12, com a frente A sem build/test:int):
  1. `docker compose --profile app up -d worker`;
  2. um script de teste em `tsx`, fora do repositório (no *scratchpad*), chama `enviarEmail` num `$transaction` conectado com a `DATABASE_URL` do dev local, como `sgo_app` (**escreve** no dev local);
  3. a mensagem aparece em `http://127.0.0.1:8225`, e a varredura do Step 2 no dev local dá 0 linhas;
  4. `docker compose --profile app stop worker`.
- [ ] **Step 8: PR** "[US-025] Envio de e-mail pelo worker com nova tentativa, modelos versionados e limpeza dos dados sensíveis", `Closes #47`, label `frente:B`.
  - **No corpo:**
    - as mudanças de comportamento do C4 (R9, R23 e o link exato);
    - o pedido de **confirmação explícita** da frente A de que a pré-condição da Task 6a do P5 está satisfeita;
    - a issue não bloqueante do *outbox* abandonado;
    - a pendência P7.
  - **Lentes:** plano/spec, testes, segurança, `security-review` e `silent-failure-hunter`.

### Task 2: Contrato C1 — estrutura financeira (`cad`)

**Files:**
- Create: `src/modules/cad/domain/estrutura.ts`, `src/modules/cad/application/estrutura-financeira.ts` (reais, ainda indisponíveis), `src/modules/cad/falsos.ts`, `src/modules/cad/servidor.ts`
- Modify: `src/modules/cad/index.ts`
- Test: `src/modules/cad/contrato-c1.test.ts`

**Interfaces:**
- Consumes: `TxCliente` (`@/shared/db`), `NoArvore` (`@/shared/totalizer`), `ErroDominio` (`@/shared/kernel`).
- Produces (exportado por `@/modules/cad` e por `@/modules/cad/servidor`, inclusive os falsos):

```ts
// C1 — Estrutura financeira (spec §6.1, §6.1a, D7).
// A classificação é a chave entre módulos e NUNCA muda (R5): a recarga só atualiza descrição e situação;
// reduzido que muda de classificação inativa o registro antigo e cria um novo.
export type Nivel = 1 | 2 | 3 | 4 | 5;
export type TipoConta = 'SINTETICA' | 'ANALITICA';
export type NoConta = {
  classificacao: string;          // '4.1.1.1.001', única e imutável
  codigoReduzido: string | null;  // obrigatório e único (entre ativas) nas analíticas; null nas sintéticas
  descricao: string;              // sem a marca vedada (GAP-CAD-005)
  nivel: Nivel;                   // analítica ⇔ nível 5
  tipo: TipoConta;
  ativa: boolean;
  filhos: readonly NoConta[];     // ordenados pela classificação (segmentos numéricos)
};
export type TipoCentroCusto = 'SINTETICO' | 'ANALITICO';
export type NaturezaCentroCusto = 'FINALISTICO' | 'APOIO' | 'ADMINISTRATIVO' | 'GESTAO';
export type NoCentroCusto = {
  classificacao: string;          // '4.3.2.11', única e imutável; não fixa dígitos por segmento (GAP-CC-002)
  codigoReduzido: string;         // '14.370', único entre ativos
  descricao: string;
  nivel: Nivel;                   // analítico em qualquer nível de 2 a 5
  tipo: TipoCentroCusto;
  ativo: boolean;
  deGestao: boolean;              // R17
  natureza: NaturezaCentroCusto | null; // GAP-CC-006
  provisorio: boolean;            // carga sem aprovação da DIREX (GAP-CC-001)
  filhos: readonly NoCentroCusto[];
};
export type OpcoesArvore = { incluirInativos?: boolean }; // padrão: só ativos

export function listarArvoreContas(tx: TxCliente, opcoes?: OpcoesArvore): Promise<readonly NoConta[]>;
export function listarArvoreCentrosCusto(tx: TxCliente, opcoes?: OpcoesArvore): Promise<readonly NoCentroCusto[]>;
export function ehContaAnaliticaAtiva(tx: TxCliente, classificacao: string): Promise<boolean>;
export function ehCentroCustoAnalitico(tx: TxCliente, classificacao: string): Promise<boolean>; // analítico e ativo

export type IndiceEstruturaFinanceira = {
  contaAnaliticaAtiva(classificacao: string): boolean;
  centroCustoAnalitico(classificacao: string): boolean;
  // Analíticas ativas da subárvore (ex.: '4.1.1.1' para filtrar as contas de pessoal fora dos pacotes base zero).
  contasAnaliticasSob(classificacaoRaiz: string): readonly string[];
  // Escopo do Gestor de Diretoria (C25): CCs analíticos ativos da subárvore, inclusive a raiz se analítica.
  centrosCustoAnaliticosSob(classificacaoRaiz: string): readonly string[];
  nosContas: readonly NoArvore[];        // id = classificação, para o totalizar(); só ativos
  nosCentrosCusto: readonly NoArvore[];  // SINTETICO → 'SINTETICA', ANALITICO → 'ANALITICA'
};
export function carregarIndiceEstrutura(tx: TxCliente): Promise<IndiceEstruturaFinanceira>;

// Falsos. Padrão: trechos reais do plano oficial (4 → … → 4.1.1.1.001, .003, .005; 4.1.1.2.001; 4.1.1.5.005)
// e da minuta (4 → 4.3 → 4.3.0, 4.3.2 → 4.3.2.10, 4.3.2.11; 4.4).
export const CONTAS_EXEMPLO: readonly NoConta[];
export const CENTROS_CUSTO_EXEMPLO: readonly NoCentroCusto[];
export function estruturaFinanceiraFalsa(dados?: { contas?: readonly NoConta[]; centrosCusto?: readonly NoCentroCusto[] }): {
  listarArvoreContas: typeof listarArvoreContas;
  listarArvoreCentrosCusto: typeof listarArvoreCentrosCusto;
  ehContaAnaliticaAtiva: typeof ehContaAnaliticaAtiva;
  ehCentroCustoAnalitico: typeof ehCentroCustoAnalitico;
  carregarIndiceEstrutura: typeof carregarIndiceEstrutura;
};
```

- [ ] **Step 1: Teste do contrato (falha):**
  - **o falso:**
    - `ehContaAnaliticaAtiva(tx, '4.1.1.1.001')` → `true`; `'4.1.1.1'` → `false`;
    - `ehCentroCustoAnalitico(tx, '4.3.2')` → `false`; `'4.4'` → `true`;
    - `centrosCustoAnaliticosSob('4.3')` → `['4.3.0', '4.3.2.10', '4.3.2.11']`;
    - `contasAnaliticasSob('4.1.1.1')` → `['4.1.1.1.001', '4.1.1.1.003', '4.1.1.1.005']`;
    - `nosContas` passa no `totalizar(nos, new Map())`;
  - **os reais**, antes da Task 4b → `ErroDominio('cad.estrutura_indisponivel')`;
  - **tipos:** `// @ts-expect-error` num `NoConta` com `nivel: 6`;
  - **exportações:** `@/modules/cad` e `@/modules/cad/servidor` exportam tudo.
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/cad` → FAIL.
- [ ] **Step 3: Implementar.** O JSDoc registra a R5 e a R3.
- [ ] **Step 4:** `npx vitest run --project unidade src/modules/cad && npm run lint && npm run typecheck` → PASS.
- [ ] **Step 5: PR de contrato** "[C1] Contrato da estrutura financeira (`cad`)", labels `frente:B` e `contrato`, `Refs #65 #68 #143`.
  - A frente A revisa e registra que o contrato atende a US-121 e o CC de escopo.
  - Junto, a sessão abre a **issue de contrato C6** para a frente A: `exibirNoMenu?: boolean` em `DeclaracaoFuncionalidade` (R24), com a label `contrato`.
  - Lentes: plano/spec, testes, segurança e `type-design-analyzer`.

### Task 3: Contrato C2 — custo de pessoal (`cad`)

**Files:**
- Create: `src/modules/cad/domain/custo-pessoal.ts`, `src/modules/cad/application/premissas.ts` (reais, ainda indisponíveis)
- Modify: `src/modules/cad/index.ts`, `src/modules/cad/servidor.ts`, `src/modules/cad/falsos.ts`
- Test: `src/modules/cad/contrato-c2.test.ts`

**Interfaces:**
- Consumes: `Dinheiro`, `Percentual`, `Resultado`, `ErroDominio` (`@/shared/kernel`); `TxCliente` (`@/shared/db`); `ContextoAuditoria` (`@/shared/audit`); os tipos do C1 (as contas são classificações de analíticas).
- Produces (exportado por `@/modules/cad` e `@/modules/cad/servidor`):

```ts
// C2 — Custo de pessoal (spec §6.4, §6.6, C33). Mês 1 = janeiro; séries sempre com 12 posições.
export type AdicionalTrabalhista =
  | { tipo: 'PERICULOSIDADE' }                                        // 30% sobre o salário do mês (RN_CAR_10)
  | { tipo: 'INSALUBRIDADE'; grau: 'MINIMO' | 'MEDIO' | 'MAXIMO' };  // 10/20/40% sobre o SMN (RN_CAR_11)
export type PosicaoPessoal = {
  quantidade: number;        // inteiro ≥ 1 (contagem)
  salarioMensal: Dinheiro;   // > 0; Fonte Ativa do cargo ou o salário digitado (C34)
  mesInicio: number;         // 1..12
  mesSaida: number;          // mesInicio..12
  adicional?: AdicionalTrabalhista;
};
export const COMPONENTES_FIXOS = [
  'salario', 'adicional', 'ferias', 'decimo_terceiro',
  'encargo.inss', 'encargo.fgts', 'encargo.pis', 'encargo.obrigacoes', 'encargo.riscos',
] as const;
export type ComponenteFixo = (typeof COMPONENTES_FIXOS)[number];
export type ComponenteEncargo = Extract<ComponenteFixo, `encargo.${string}`>;
export type CodigoComponente = ComponenteFixo | `beneficio.${string}`;

export type BeneficioPremissa =
  | { componente: `beneficio.${string}`; nome: string; forma: 'VALOR_MENSAL'; valorMensal: Dinheiro; conta: string }
  | { componente: `beneficio.${string}`; nome: string; forma: 'PERCENTUAL_SALARIO'; percentual: Percentual; conta: string }; // R14a
export type PremissasExercicio = {
  ano: number;
  // Muda com QUALQUER escrita nos parâmetros do ano: premissas, encargos, contas por componente, SMN e Tabela Mestre (R10).
  versao: number;
  congelado: boolean;
  provisorio: boolean;
  reajuste: Percentual;      // pontos: 5 = 5%
  mesDataBase: number;       // 1..12
  ipca: Percentual;
  salarioMinimo: Dinheiro | null;
  encargos: readonly { componente: ComponenteEncargo; nome: string; percentual: Percentual; conta: string }[];
  contas: Readonly<Record<Exclude<ComponenteFixo, ComponenteEncargo>, string>>; // R14
  beneficios: readonly BeneficioPremissa[];
  avisos: readonly string[];
};
export type LinhaComponente = { componente: CodigoComponente; conta: string; meses: readonly Dinheiro[]; total: Dinheiro };
export type SerieMensalComponentes = {
  ano: number; versaoPremissas: number;
  linhas: readonly LinhaComponente[]; // só componentes com algum mês ≠ 0
  totalMes: readonly Dinheiro[];      // 12
  total: Dinheiro;
};

// Função pura; ordem das operações e arredondamentos da R14. Retorno em Resultado (R3).
export function calcularCustoPosicao(posicao: PosicaoPessoal, premissas: PremissasExercicio): Resultado<SerieMensalComponentes>;
export function obterPremissasExercicio(tx: TxCliente, ano: number): Promise<PremissasExercicio | null>;
// US-055: cria os parâmetros do ano (e a Tabela Mestre, a partir da Task 10) copiando o último ano anterior,
// ou os padrões provisórios. Idempotente e auditado.
export function garantirPremissasExercicio(tx: TxCliente, contexto: ContextoAuditoria, ano: number): Promise<PremissasExercicio>;
export function congelarPremissasExercicio(tx: TxCliente, contexto: ContextoAuditoria, ano: number): Promise<void>;

// Falsos
export function premissasExemplo(ano?: number): PremissasExercicio; // R14; benefícios VR 800, saúde 600, vida 50
export function custoPessoalFalso(premissas?: readonly PremissasExercicio[]): {
  calcularCustoPosicao: typeof calcularCustoPosicao; // simplificado: tudo em 'salario' (qtd × salário nos meses ativos)
  obterPremissasExercicio: typeof obterPremissasExercicio;
  garantirPremissasExercicio: typeof garantirPremissasExercicio;
  congelarPremissasExercicio: typeof congelarPremissasExercicio;
  chamadas: { posicao: PosicaoPessoal; premissas: PremissasExercicio }[];
  congelados: ReadonlySet<number>;
};
```

O falso **não** reproduz a fórmula: os testes da frente A verificam as chamadas e a gravação da série, nunca os valores. Os valores oficiais são provados na Task 11.

- [ ] **Step 1: Teste do contrato (falha):**
  - **o falso:**
    - registra as chamadas;
    - início 3 e saída 10 → só os meses 3 a 10 ≠ 0;
    - `quantidade 0` → `{ ok: false, erros: [{ campo: 'quantidade', … }] }`;
    - congelar põe o ano em `congelados`;
  - **os reais** → `cad.custo_pessoal_indisponivel`;
  - **`premissasExemplo(2027)`:** os encargos somam 51 pontos;
  - **tipos:** `// @ts-expect-error` em `componente: 'bonus'`, e `salarioMensal: 7500` não compila.
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/cad` → FAIL.
- [ ] **Step 3: Implementar** os tipos e os falsos, com o JSDoc das regras R13, R14, R14a, R10 (versão) e R3.
- [ ] **Step 4:** `npx vitest run --project unidade src/modules/cad && npm run lint && npm run typecheck` → PASS.
- [ ] **Step 5: PR de contrato** "[C2] Contrato do custo de pessoal (`cad`)", labels `frente:B` e `contrato`, `Refs #73 #75 #143`. A frente A revisa e registra que atende a US-121 e a US-055. Lentes: plano/spec, testes, segurança e `type-design-analyzer`.

### Task 4a: Leitor seguro de .xlsx e validação do plano de contas (US-043 parte 1, `Refs #65`)

**Files:**
- Create: `src/modules/ger/infrastructure/zip-seguro.ts`, `src/modules/ger/infrastructure/ler-xlsx.ts`
- Create: `src/modules/cad/domain/plano-contas.ts`, `src/modules/cad/domain/carga.ts`, `src/modules/cad/application/saneamento.ts`
- Modify: `src/modules/ger/servidor.ts`
- Test:
  - Create: `src/modules/ger/infrastructure/zip-seguro.test.ts`, `src/modules/ger/infrastructure/ler-xlsx.test.ts`;
  - Create: `src/modules/cad/domain/plano-contas.test.ts`, `src/modules/cad/domain/carga.test.ts`, `src/modules/cad/application/saneamento.test.ts`.

**Interfaces — Produces:**

```ts
// @/modules/ger/servidor (acréscimo ao C3, R4)
export type LimitesPlanilha = { bytes: number; entradas: number; descompactado: number; razao: number;
  linhas: number; colunas: number; caracteresCelula: number };
export const LIMITES_PADRAO: LimitesPlanilha; // 1 MB, 50, 20 MB, 100, 20.000, 30, 1.000
export type LinhaPlanilha = { numero: number; celulas: Readonly<Record<string, string | null>> }; // chave = coluna do cabeçalho
export type ErroLinha = { linha: number; coluna?: string; mensagem: string };
export function lerPlanilhaSegura(
  arquivo: { nome: string; conteudo: Uint8Array },
  opcoes: { aba?: string; colunas: readonly string[]; linhaCabecalhoMax: number; limites?: Partial<LimitesPlanilha> },
): Promise<Resultado<{ nomeArquivo: string; linhas: readonly LinhaPlanilha[]; errosCelula: readonly ErroLinha[] }>>;

// cad, domínio (puro; a função de saneamento é injetada, I1)
export type LinhaPlanoValidada = { linha: number; classificacao: string; codigoReduzido: string | null; descricao: string;
  nivel: Nivel; tipo: TipoConta; classificacaoPai: string | null };
export function validarPlanoContas(linhas: readonly LinhaPlanilha[], sanear: (texto: string) => { texto: string; retirou: boolean }):
  { ok: true; contas: readonly LinhaPlanoValidada[]; avisos: readonly ErroLinha[] } | { ok: false; erros: readonly ErroLinha[] };
// R5: chave = classificação; nunca muda estrutura de um existente
export type Atual = { classificacao: string; codigoReduzido: string | null; tipo: string; descricao: string; ativo: boolean };
export function planejarCarga(atuais: readonly Atual[], novas: readonly Atual[]):
  { incluir: readonly Atual[]; alterarDescricao: readonly Atual[]; reativar: readonly Atual[]; inativar: readonly string[];
    inalteradas: number; avisos: readonly ErroLinha[]; erros: readonly ErroLinha[] };
// cad, application
export function sanearDescricao(texto: string): { texto: string; retirou: boolean }; // usa encontrarMarcaVedada
```

- [ ] **Step 1: Testes do leitor (falham)** — as planilhas são montadas no teste com ExcelJS, e os zips adversos são montados à mão:
  - **zip bomb:** uma entrada de 1 GB de zeros, que fica com menos de 1 MB compactada → recusada com "Planilha inválida ou grande demais". O teste roda num processo filho com `--max-old-space-size=256` e prova que o processo termina sem estourar;
  - **tamanho declarado mentiroso:** declara 1 KB e descompacta 30 MB → recusada pelo `maxOutputLength`;
  - **estrutura do zip:** 51 entradas → recusada; arquivo sem `PK\x03\x04` → recusado; 1 MB + 1 byte → recusado sem abrir;
  - **XML:** com `<!DOCTYPE` ou `<!ENTITY` → recusado;
  - **conteúdo:**
    - 20.001 linhas → erro;
    - 31 colunas → erro;
    - célula de 1.001 caracteres → erro na linha;
    - fórmula com resultado → vale o resultado; fórmula sem resultado → erro na linha;
    - `1234.56` numérico → `"1234.56"`; `1234.567` → erro (Review Focus 1);
    - colunas fora de ordem e com caixa e acento diferentes → lidas pelo nome;
  - **concorrência:** duas leituras simultâneas → a segunda recebe a mensagem do semáforo;
  - **nome do arquivo:** `../../x\u0007.xlsx` → `x.xlsx`, com até 120 caracteres.
- [ ] **Step 2: Testes do domínio (falham):**
  - **`validarPlanoContas`** com o JSON oficial → 174 contas, 12 sintéticas e 162 analíticas;
  - **erros por linha:** nível 6; segmentos diferentes do nível; pai inexistente; pai de nível errado; analítica fora do nível 5; analítica sem reduzido; reduzido repetido (as duas linhas citadas); classificação repetida; sintética sem filho;
  - **`planejarCarga` (R5):**
    - mesma lista → tudo inalterado;
    - mesma classificação com nova descrição → `alterarDescricao`;
    - mesma classificação com outro reduzido → erro na linha;
    - mesma classificação com outro tipo → erro na linha;
    - reduzido 900 movido para classificação nova → `inativar` a antiga, `incluir` a nova, e um aviso;
    - ausente → `inativar`;
    - inativa que volta → `reativar`;
  - **`saneamento.test.ts`** (em `application/`, com a sigla montada em tempo de execução): a sigla em qualquer caixa sai, e `retirou = true`.
- [ ] **Step 3:** `npx vitest run --project unidade src/modules/ger src/modules/cad` → FAIL.
- [ ] **Step 4: Implementar** (`zip-seguro.ts` lê o diretório central e infla com `node:zlib`, sem dependência nova).
- [ ] **Step 5:** suíte + `npm run lint && npm run typecheck` → PASS.
- [ ] **Step 6: PR** "[US-043] Leitor seguro de planilhas e validação do plano de contas (parte 1/3)", `Refs #65`, label `frente:B`. Revisão de consumidor da frente A (acréscimo `lerPlanilhaSegura` ao C3, para a US-121). Lentes: plano/spec, testes, segurança e `security-review`.

### Task 4b: Plano de contas — migration, *staging*, *merge* no worker e C1 real (US-043 parte 2, `Refs #65`)

**Files:**
- Create:
  - `prisma/schema/cad.prisma` e `prisma/migrations/<AAAAMMDDHHMM>_cad_plano_contas/migration.sql`;
  - `src/modules/cad/application/{importar-estrutura,aplicar-carga}.ts`;
  - `src/modules/cad/infrastructure/{cliente-sync,processador-cargas,seed,seed-referencia}.ts` e `src/modules/cad/infrastructure/dados/plano-contas-oficial.json`.
- Modify:
  - `src/modules/cad/application/estrutura-financeira.ts` (C1 real das contas);
  - `src/modules/cad/index.ts` e `src/modules/cad/servidor.ts`;
  - `worker/index.ts` (processador de cargas);
  - `docs/operacao/ambientes.md` (`SYNC_DATABASE_URL` só no `worker`; `AMBIENTE` no `app` e no `worker`).
- Test:
  - Create: `src/modules/cad/infrastructure/dados-oficiais.test.ts`, `src/modules/cad/application/importar-plano.int.test.ts`, `src/modules/cad/infrastructure/privilegios.int.test.ts`.

**Modelos:**
- **`ContaContabil` (`conta_contabil`):**
  - identificação: `id` uuid, `classificacao` único, `codigoReduzido?` (índice único parcial `WHERE ativa`);
  - conteúdo: `descricao`, `nivel` smallint, `tipo` (enum `TipoConta`), `paiId?` (FK para a própria tabela, `ON DELETE RESTRICT`);
  - situação: `ativa`, `inativadaEm?`;
  - lote e controle: `cargaId`, `criadoEm`, `atualizadoEm`.
- **`CargaEstrutura` (`carga_estrutura`):**
  - identificação: `id`, `tipo` (`PLANO_CONTAS` | `CENTROS_CUSTO` | `CARGOS` | `CARGOS_RECIFRA`), `situacao` (`PENDENTE` | `PROCESSANDO` | `CONCLUIDA` | `FALHOU`);
  - arquivo: `arquivoNome` (saneado), `arquivoSha256`, `linhas`;
  - resultado: `incluidas`, `alteradas`, `inativadas`, `inalteradas`, `avisos` (jsonb), `erro?` (sem valores);
  - aprovação e provisório: `provisoria`, `aprovacaoData?`, `aprovacaoDocumento?`;
  - auditoria: `contextoAuditoria` (jsonb: usuário, rótulo, sessão, IP), `criadoEm`, `concluidoEm?`.
  - Índice único parcial em `tipo WHERE situacao IN ('PENDENTE','PROCESSANDO')`.
- **`CargaEstruturaLinha`:** `cargaId`, `numero`, `dados` (jsonb). Pk (`cargaId`, `numero`).

**Migration:**
- **`CHECK`:**
  - `nivel BETWEEN 1 AND 5`;
  - nível = número de segmentos;
  - `(tipo = 'ANALITICA') = (nivel = 5)`;
  - `(tipo = 'ANALITICA') = (codigo_reduzido IS NOT NULL)`.
- **Constraint trigger** `DEFERRABLE INITIALLY DEFERRED`: pai com nível − 1; analítica sem filho; sintética ativa com filho ativo.
- **Trigger que recusa `UPDATE` de `classificacao`, `nivel`, `tipo`, `pai_id` e `codigo_reduzido`** (R5 imposta no banco).
- **Privilégios (tabela da R6):** `REVOKE ALL` dos dois papéis e depois só os `GRANT` da tabela. Nenhum `DELETE`, exceto o do `sgo_sync` em `carga_estrutura_linha`.

**Interfaces — Produces:**

```ts
export type ArquivoCarga = { nome: string; conteudo: Uint8Array };
export type EstadoCarga = { cargaId: string; situacao: 'PENDENTE' | 'PROCESSANDO' | 'CONCLUIDA' | 'FALHOU';
  linhas: number; incluidas: number; alteradas: number; inativadas: number; inalteradas: number;
  avisos: readonly ErroLinha[]; erro: string | null };
// app (sgo_app): exigir(ctx,'cad.plano_contas','executar') → lê, valida, grava o staging e audita "importação solicitada".
// Erros por linha em ErroCampo { campo: 'linhas.<n>.<coluna>' }; carga do mesmo tipo em andamento → erro geral.
export function solicitarCargaPlanoContas(ctx: ContextoRequisicao, arquivo: ArquivoCarga, deps?: { cliente?: PrismaClient }): Promise<Resultado<{ cargaId: string }>>;
export function consultarCarga(ctx: ContextoRequisicao, cargaId: string, deps?): Promise<EstadoCarga | null>;
// núcleo do merge (sem papel nem lote; R6): usado pelo worker e pela seed
export function aplicarCarga(tx: TxCliente, contexto: ContextoAuditoria, tipo: 'PLANO_CONTAS', linhas: readonly LinhaPlanoValidada[]):
  Promise<Omit<EstadoCarga, 'cargaId' | 'situacao' | 'erro'>>;
// @/modules/cad/servidor: worker
export function iniciarProcessadorCargas(deps: { clienteSync: PrismaClient | null; intervaloMs?: number }): { parar(): Promise<void> };
export const seedCad: Seed;                // nesta tarefa, só a funcionalidade cad.plano_contas
export const seedDadosReferenciaCad: Seed; // R15
```

**Funcionalidade (C6):** `cad.plano_contas`
- local: módulo `CADASTROS`, grupo "Plano de Contas", nome "Plano de Contas", rota `/cad/plano-contas`;
- ações: `consultar` e `executar`, com `nivelLog` `SIMPLES`;
- perfis: GFIN `['consultar', 'executar']`; ORCAMENTISTA, ANALISTA_GRH, OPERADOR_VIAGENS, AUDITOR, GESTOR_DIRETORIA e DIREX `['consultar']`.

- [ ] **Step 1: `dados-oficiais.test.ts` (falha):** acha `especificacao/Plano_de_Contas_5_Niveis_*.xlsx` por *glob* (falha se não achar), lê com `lerPlanilhaSegura` e compara com o JSON. A única diferença aceita é a descrição saneada da 4.1.1.8.005.
- [ ] **Step 2: Integração (falha)**, com `iniciarBancoTeste()`, as URLs do `sgo_app` e do `sgo_sync` montadas no teste e o processador chamado direto (um ciclo):
  - **fluxo completo:** `solicitarCargaPlanoContas` (GFIN) → lote `PENDENTE` → um ciclo do processador → `CONCLUIDA`, com 174 contas, o Histórico `INSERCAO` com o usuário do lote e o *staging* vazio;
  - **`carga só como sgo_sync`:** o processador com o cliente do `sgo_app` → lote `FALHOU`, com "A carga exige o papel de sincronismo", e nada aplicado;
  - **`recarga idempotente`:** nenhuma conta muda (`atualizado_em` igual), e `inalteradas = 174`;
  - **`recarga não muda classificação`:**
    - o reduzido 900 numa classificação nova → a antiga inativa, a nova criada e o aviso no lote;
    - um `UPDATE conta_contabil SET classificacao = …` como `sgo_sync` → recusado pelo *trigger*;
  - **`conta ausente inativa`:** a analítica ausente fica inativa;
  - **`carga atômica`:** linha inválida → nada no *staging*; falha do *trigger* no *merge* → lote `FALHOU` e nada aplicado;
  - **`carga concorrente`:** a segunda solicitação com uma `PENDENTE` → "Já existe uma carga do plano de contas em andamento. Tente de novo em instantes.";
  - **desempenho (RNF_DES_003):** 10.000 linhas sintéticas da solicitação até `CONCLUIDA` em menos de 30 s. Rodar sozinho (D12) e registrar o tempo;
  - **§10.2, itens 1 e 3:** com o `auditar` falhando no *merge*, nada é aplicado e o lote fica `FALHOU`; ORCAMENTISTA → `ErroPermissao`;
  - **C1 real:** árvore com 162 folhas; `ehContaAnaliticaAtiva` para ativa e inativa; `contasAnaliticasSob('4.1.1.1')` com 25 contas; `nosContas` passa no `totalizar`;
  - **`privilegios.int.test.ts`:** a matriz de `information_schema` igual à tabela da R6 nas 3 tabelas;
  - **seed:**
    - `seedCad` duas vezes → *dump* idêntico;
    - `seedDadosReferenciaCad` com `CARGA_DADOS_REFERENCIA` vazia, `0` ou `true` → não faz nada; com `1` → 174 contas e auditoria "Sistema";
    - com `AMBIENTE=producao` e `1` → erro (M1).
- [ ] **Step 3:** sozinho, `npx vitest run --project integracao src/modules/cad` e `npx vitest run --project unidade src/modules/cad` → FAIL.
- [ ] **Step 4: Implementar.**
  - **Migration:** `npm run db:migrate -- --name cad_plano_contas --create-only` (**escreve** no banco de dev local 56432, depois de conferir as URLs). Renomear para o carimbo maior que o da última migration da `main` e acrescentar à mão os `CHECK`, os *triggers* e os privilégios.
  - **Merge:** `createMany` das novas, `UPDATE … FROM (VALUES …)` das descrições, inativação, e `SET CONSTRAINTS ALL IMMEDIATE` antes do commit.
  - **`worker/index.ts`:** `iniciarProcessadorCargas({ clienteSync })` com `criarPrisma(SYNC_DATABASE_URL)`, via `@/modules/cad/servidor`; o encerramento chama `parar()`.
- [ ] **Step 5:** suítes + `npm run lint && npm run typecheck && npm run test:arq` → PASS. No dev local, `npm run db:deploy` (**escreve**) e `migrate diff` sem diferença. O `worker/bundle.test.ts` continua verde.
- [ ] **Step 6: PR** "[US-043] Plano de contas: staging, merge no worker como sgo_sync e contrato C1 real (parte 2/3)", `Refs #65`, labels `frente:B` e `migration`. **PO:** `SYNC_DATABASE_URL` e `AMBIENTE` no `worker`; `AMBIENTE` no `app` de hml e prod. Lentes: plano/spec, testes, segurança, `security-review` e `silent-failure-hunter`.

### Task 4c: PR compartilhado — seeds do `cad` no orquestrador

- [ ] **Files:** Modify `prisma/seed.ts`: `seedCad` e `seedDadosReferenciaCad` **depois** de `seedAdm` (C6).
- [ ] **Teste:** `npm run db:seed` duas vezes no dev local da frente B (**escreve** no dev local) → a segunda não grava nada.
- [ ] **PR** "Compartilhado: seeds do cad no orquestrador", labels `compartilhado` e `frente:B`, `Refs #65`. Na issue de "seed no deploy" (P5 Task 1), registrar:
  - o serviço de migração de hml precisa de `CARGA_DADOS_REFERENCIA=1`;
  - o `app` de hml precisa de `CC_CARGA_PROVISORIA=1`;
  - prod tem `AMBIENTE=producao` e nenhuma das duas (R15, R16, R25).

### Task 5: Centros de custo — validação, *merge* e C1 real dos CCs (US-046 parte 1, `Refs #68`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_centros_custo/migration.sql`
- Create: `src/modules/cad/domain/centros-custo.ts`, `src/modules/cad/infrastructure/dados/cc-minuta-rev23102026.json`
- Modify: `src/modules/cad/application/{importar-estrutura,aplicar-carga,estrutura-financeira}.ts`, `src/modules/cad/infrastructure/{seed,seed-referencia}.ts`, `src/modules/cad/index.ts`
- Test: `src/modules/cad/domain/centros-custo.test.ts`, `src/modules/cad/application/importar-cc.int.test.ts`; Modify: `dados-oficiais.test.ts`, `privilegios.int.test.ts`

**Modelo `CentroCusto` (`centro_custo`):**
- identificação: `id`, `classificacao` único, `codigoReduzido` (índice único parcial `WHERE ativo`), `paiId?`;
- conteúdo: `descricao`, `descricaoOriginal?`, `nivel`, `tipo`;
- atributos: `aceitaLancamento`, `deGestao`, `natureza?`;
- situação e lote: `provisorio`, `ativo`, `inativadoEm?`, `cargaId`, `criadoEm`, `atualizadoEm`.

**Migration:**
- **`CHECK`:** nível 1..5 e igual aos segmentos; `aceita_lancamento = (tipo = 'ANALITICO')`; `tipo = 'SINTETICO' OR nivel >= 2`. **Sem** `CHECK` do formato do reduzido (R17, GAP-CC-003).
- **Triggers:** o deferido de estrutura e o que recusa `UPDATE` de classificação, nível, tipo, pai e reduzido.
- **Privilégios:** os da tabela da R6.

**Interfaces — Produces:**

```ts
export type AprovacaoDirex = { data: string /* AAAA-MM-DD, não futura */; documento: string /* 3..120 caracteres, sem controle */ };
// app: exigir(ctx,'cad.centros_custo','executar'). Sem carga provisória permitida (R16, R25), exige `aprovacao`.
export function solicitarCargaCentrosCusto(
  ctx: ContextoRequisicao, arquivo: ArquivoCarga, aprovacao: AprovacaoDirex | null,
  deps?: { cliente?: PrismaClient; cargaProvisoriaPermitida?: boolean },
): Promise<Resultado<{ cargaId: string }>>;
```

**Funcionalidade (C6):** `cad.centros_custo`
- local: grupo "Plano de Contas", nome "Centros de Custo", rota `/cad/centros-custo`;
- ações: `consultar` e `executar`, com os mesmos perfis de `cad.plano_contas`.

- [ ] **Step 1: Testes de domínio (falham):**
  - **com o JSON da minuta:** 35 CCs, 8 sintéticos, 27 analíticos, 7 `deGestao` e nenhum aviso da R3;
  - **erros por linha:** reduzido numérico (`14.18`) ou fora do formato; `Aceita lançamento = S` num sintético; analítico no nível 1; pai inexistente; sintético sem filho; reduzido repetido;
  - **avisos da R3:** gerência sem `.10`, ou com dois;
  - **descrição:** vale a sugerida, e a original vai para `descricaoOriginal`.
- [ ] **Step 2: Integração (falha):**
  - **com aprovação** → `provisorio = false`, com a data e o documento no lote e no Histórico;
  - **sem aprovação:** `cargaProvisoriaPermitida: false` → erro em `aprovacao`; `true` → todos os CCs provisórios;
  - **R5:** reduzido movido de classificação → o antigo inativado, o novo criado e o aviso; mesma classificação com outro tipo → erro na linha;
  - **idempotência e concorrência:** recarga idempotente, ausente inativado e segunda carga recusada;
  - **papel:** a carga só roda como `sgo_sync`;
  - **C1 real:**
    - `ehCentroCustoAnalitico('4.4')` → `true`;
    - `centrosCustoAnaliticosSob('4.3')` → os 14 analíticos da DAF (4.3.0 e os 13 de nível 4 das três gerências);
    - `provisorio` presente na árvore;
  - **matriz de privilégios** de `centro_custo`;
  - **seed** com `CARGA_DADOS_REFERENCIA=1` → minuta provisória.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar** (migration como na Task 4b).
- [ ] **Step 5:** suíte + lint + typecheck + `test:arq` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 6: PR** "[US-046] Centros de custo: validação, regra de gestão e carga provisória (parte 1/2)", `Refs #68`, labels `frente:B` e `migration`. Lentes: plano/spec, testes, segurança, `security-review` e `silent-failure-hunter`.

### Task 6a: Tree Grid virtualizada, teclado e medição da rolagem (US-021 parte 1, `Refs #43`)

**Files:**
- Create: `src/modules/ger/ui/grade-virtual.ts`, `e2e/cad/rolagem-plano.spec.ts`
- Modify: `src/modules/ger/ui/grade-arvore.tsx`, `src/modules/ger/ui/grade-logica.ts`
- Test: `src/modules/ger/ui/grade-virtual.test.ts`, `src/modules/ger/grade-unica.test.ts`; Modify: `src/modules/ger/contrato-c3.test.ts`

**Interfaces:**
- Consumes: `useVirtualizer` de `@tanstack/react-virtual`.
- Produces (*props* opcionais; o C3 não quebra):

```ts
export type PropsGradeArvore<C extends string = string> = {
  // … props atuais do C3 …
  alturaLinha?: number;   // px, padrão 32
  alturaVisivel?: number; // px, padrão 600
};
export function janelaVisivel(p: { total: number; topo: number; alturaLinha: number; alturaVisivel: number; folga: number }):
  { inicio: number; fim: number; espacoAntes: number; espacoDepois: number };
```

- [ ] **Step 1: Testes (falham):**
  - **`janelaVisivel`:** `{ 5000, topo 0, 32, 600, folga 10 }` → `inicio 0` e `fim ≤ 29`; no fim, `fim = 4999`; o espaço total é 5000 × 32;
  - **SSR** com 5.000 nós → no máximo 40 `<tr>` no corpo, `aria-rowcount="5001"` e *props* serializáveis;
  - **teclado** (lógica pura): ↓ no último; → abre; ← fecha ou volta ao pai;
  - **`grade-unica.test.ts`:** só `ger/ui/grade-arvore.tsx` contém `role="treegrid"` em `src/`.
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/ger` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** suíte + lint + typecheck e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: Medição da rolagem fluida (I12).** O `e2e/cad/rolagem-plano.spec.ts` é um Playwright com CDP:
  1. entra como GFIN (usuário do `global-setup`, issue para a frente A);
  2. importa um plano sintético de 5.000 linhas pela tela (Task 7a; até lá, o spec fica `test.fixme`);
  3. abre `/cad/plano-contas` com tudo expandido;
  4. rola por 5 s com `page.mouse.wheel`;
  5. mede os quadros pelo `Performance.getMetrics` e pelo *trace* (`Tracing.start`/`end`, eventos `DrawFrame`), além das tarefas longas por `PerformanceObserver('longtask')`.

  O spec exige média ≥ 55 FPS e nenhuma tarefa longa acima de 50 ms. Roda sozinho (D12), depois do `build`, com `npm run test:e2e -- e2e/cad/rolagem-plano.spec.ts`.
  - **Plano B (PO):** se a issue do `global-setup` não estiver pronta até a Task 7a, o PO roda a mesma medição em hml no Chrome DevTools (aba Performance), com o roteiro no PR, e registra o resultado.
- [ ] **Step 6: PR** "[US-021] Tree Grid virtualizada com navegação por teclado (parte 1/3)", `Refs #43`, label `frente:B`. Abrir a issue do usuário GFIN no `global-setup` para a frente A. Lentes: plano/spec, testes e segurança.

### Task 6b: Exportação XLSX real (US-021 parte 2, `Refs #43`)

**Files:** Modify `src/modules/ger/infrastructure/exportar-xlsx.ts`; Test: Modify `contrato-c3.test.ts`; Create `src/modules/ger/infrastructure/exportar-xlsx.test.ts`

**Interfaces:** sem mudança de assinatura; regras da R21.

- [ ] **Step 1: Testes (falham)** — exportar e ler de volta:
  - 2 abas;
  - `"1234.50"` vira número com `#,##0.00`, e `"0.10"` não perde precisão;
  - **injeção de fórmula (M2):** `"=HYPERLINK(\"x\")"`, `"+55 11 9999"`, `"-100"`, `"@soma"`, `"\tx"` e `"\rx"` em coluna de texto saem como texto. Nenhuma célula de dado tem `formula` nem `hyperlink`; a varredura é feita em todas as células;
  - competência `"Jan/27"` sai como texto;
  - as validações do C3 continuam.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar** com `const ExcelJS = (await import('exceljs')).default` dentro da função.
- [ ] **Step 4:** suíte + lint + typecheck e, sozinho, `npm run build` → PASS (o ExcelJS fica fora do *bundle* do cliente).
- [ ] **Step 5: PR** "[US-021] Exportação XLSX real do contrato C3 (parte 2/3)", `Refs #43`, label `frente:B`. Lentes: plano/spec, testes, segurança e `security-review`.

### Task 6c: Filtros retidos na sessão (US-021 parte 3, `Closes #43`)

**Files:**
- Create: `src/modules/ger/ui/grade-filtros.ts`
- Modify: `src/modules/ger/ui/grade-arvore.tsx`, `src/modules/ger/index.ts`
- Test: `src/modules/ger/ui/grade-filtros.test.ts`, `src/modules/ger/sem-localstorage.test.ts`; Modify: `contrato-c3.test.ts`

**Interfaces — Produces (`@/modules/ger`):**

```ts
export type DefinicaoFiltro<C extends string = string> =
  | { tipo: 'texto'; id: string; rotulo: string; campos: readonly C[] }
  | { tipo: 'selecao'; id: string; rotulo: string; campo: C; opcoes: readonly { valor: string; rotulo: string }[] }
  | { tipo: 'ocultarZerados'; id: string; rotulo: string; campos: readonly C[] }; // RF0006
export type ValoresFiltro = Readonly<Record<string, string | boolean>>;
export type PropsGradeArvore<C extends string = string> = {
  // … anteriores …
  filtros?: readonly DefinicaoFiltro<C>[];
  escopoSessao?: string; // hash do sessaoUid (R18); sem ele, o estado não é retido
};
export function aplicarFiltros<C extends string>(nos: readonly NoGrade<C>[], defs: readonly DefinicaoFiltro<C>[], valores: ValoresFiltro):
  { nos: readonly NoGrade<C>[]; abrir: ReadonlySet<string> };
export function validarValoresFiltro(defs: readonly DefinicaoFiltro[], valores: unknown): Resultado<ValoresFiltro>; // RF0003
export function lerFiltrosSalvos(texto: string | null, escopo: string | undefined): ValoresFiltro | undefined;
```

- [ ] **Step 1: Testes (falham):**
  - **`aplicarFiltros`:**
    - `"salario"` acha "Salários" e abre os ancestrais;
    - busca pelo reduzido `"900"`;
    - `ocultarZerados`;
    - sem filtro, mesma referência;
  - **`validarValoresFiltro`:** 101 caracteres ou `\u0000` → erro; opção inexistente → erro;
  - **`lerFiltrosSalvos`:** escopo diferente → `undefined`; JSON corrompido → `undefined`;
  - **componente (SSR):** "Limpar filtros" aparece; sem `escopoSessao`, nada é lido;
  - **`sem-localstorage.test.ts`:** percorre a AST (TypeScript *compiler API*) de `src/**/*.{ts,tsx}`, exceto `*.test.ts`. Reprova todo identificador ou acesso `localStorage`, com comentários e *strings* ignorados (spec §5, RNF0002 do EP084).
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.**
  - O estado fica em `sessionStorage['sgo.grade.<idGrade>.filtros'] = { escopo, valores }`.
  - "Limpar filtros" apaga a chave.
  - Filtro inválido mostra a mensagem e mantém o resultado anterior (UC0.01 A3).
- [ ] **Step 4:** suíte + lint + typecheck e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-021] Filtros da Tree Grid retidos na sessão (parte 3/3)", `Closes #43`, label `frente:B`. No corpo, o link de cada prova: medição (6a ou passo do PO), retenção e componente único. Lentes: plano/spec, testes e segurança.

### Task 7a: Tela de importação do plano de contas (US-043 parte 3, `Closes #65`)

**Files:**
- Create: `src/modules/cad/application/acoes-plano.ts` (`'use server'`, com `import 'server-only'`), `src/modules/cad/ui/importar-estrutura.tsx`, `src/app/(sistema)/cad/plano-contas/importar/page.tsx`
- Modify: `src/modules/cad/index.ts`, `src/modules/cad/infrastructure/seed.ts` (ajuda)
- Test: `src/modules/cad/application/acoes-plano.int.test.ts`, `src/modules/cad/ui/importar-estrutura.test.ts`

**Interfaces — Produces:**

```ts
// definirAcao({ funcionalidade: 'cad.plano_contas', acao: 'executar', entrada }): z.preprocess do FormData → ArquivoCarga
// (File .xlsx, ≤ 1 MB, assinatura PK conferida no leitor, nome saneado).
export const acaoImportarPlanoContas: (entrada: unknown) => Promise<RespostaAcao<{ cargaId: string }>>;
export const acaoConsultarCarga: (entrada: unknown) => Promise<RespostaAcao<EstadoCarga | null>>; // cad.plano_contas:executar
```

- [ ] **Step 1: Testes (falham):**
  - **ação:**
    - GFIN → `ok` e o `cargaId`;
    - ORCAMENTISTA → 403 **auditado** (M4);
    - `.csv`, arquivo sem assinatura PK ou 1,5 MB → erro em `arquivo`;
    - arquivo com erro → `linhas.<n>.<coluna>`, sem lote;
  - **componente:**
    - lista até 200 erros, com o total;
    - avisos separados dos erros;
    - o estado do lote é atualizado a cada 2 s até `CONCLUIDA` ou `FALHOU`;
    - a mensagem final é "Plano de contas importado: X incluídas, Y alteradas, Z inativadas, W sem alteração.";
  - **página:** começa com `exigirPagina('cad.plano_contas', 'executar')`.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar** com o `Formulario` do C3 e a grade plana para os erros.
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS. No dev, importar a planilha oficial pela tela, com o worker no perfil `app`.
- [ ] **Step 5: PR** "[US-043] Tela de importação do plano de contas (parte 3/3)", `Closes #65`, label `frente:B`. Os 4 critérios provados nas Tasks 4a, 4b e 7a. Lentes: plano/spec, testes, segurança e `security-review`.

### Task 7b: Consulta do plano de contas em árvore (US-044, `Closes #66`)

**Files:** Create `src/modules/cad/application/consultar-estrutura.ts`, `src/modules/cad/ui/arvore-contas.tsx`, `src/app/(sistema)/cad/plano-contas/page.tsx`; Test `consultar-estrutura.int.test.ts`, `arvore-contas.test.ts`

**Interfaces — Produces:** `consultarArvoreContas(ctx, deps?): Promise<readonly NoGrade[]>` (`cad.plano_contas:consultar`), já serializável.

- [ ] **Step 1: Testes (falham):**
  - 174 nós; a inativa aparece só com "Mostrar inativas";
  - sem Novo, Alterar ou Excluir (C27, RN_PLA_001);
  - "Importar arquivo" só com `executar`;
  - o filtro de texto cobre classificação, reduzido e descrição.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar** (`escopoSessao = sha256(ctx.sessaoUid)`, em base64url, com 16 caracteres).
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-044] Consulta do plano de contas em árvore, só leitura", `Closes #66`, label `frente:B`. Lentes: plano/spec, testes e segurança.

### Task 8: Telas de centros de custo e trava da DIREX (US-046 parte 2, `Closes #68`)

**Files:** Create `src/modules/cad/application/acoes-cc.ts`, `src/modules/cad/ui/{arvore-cc,importar-cc}.tsx`, `src/app/(sistema)/cad/centros-custo/{page,importar/page}.tsx`; Test `acoes-cc.int.test.ts`, `arvore-cc.test.ts`

**Interfaces — Produces:** `acaoImportarCentrosCusto` (`cad.centros_custo:executar`; o `FormData` traz o arquivo, `aprovacaoData` e `aprovacaoDocumento`) e `consultarArvoreCentrosCusto(ctx)`.

- [ ] **Step 1: Testes (falham):**
  - **trava da DIREX (Review Focus 7):** com `AMBIENTE=producao` e `CC_CARGA_PROVISORIA=1` → a variável é ignorada, com o log `[CC_CARGA_PROVISORIA_IGNORADA]`. Sem aprovação, o erro é "Informe a data e o documento de aprovação da DIREX. A carga de centros de custo em produção só acontece depois dessa aprovação (GAP-CC-001).";
  - **com `CC_CARGA_PROVISORIA=1` em hml:** o formulário mostra "Carga provisória (minuta)", e a árvore, o selo "Provisório";
  - **valores de `CC_CARGA_PROVISORIA`:** `0` e `true` → exigem aprovação (M1);
  - **árvore:** o reduzido ao lado da classificação; o selo de gestão; sem Novo, Alterar ou Excluir;
  - **avisos da R3:** aparecem no resultado do lote.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-046] Telas de centros de custo com a trava de aprovação da DIREX (parte 2/2)", `Closes #68`, label `frente:B`. Pendência: GAP-CC-001 (US-115, P7). Lentes: plano/spec, testes, segurança e `security-review`.

### Task 9a: Parâmetros por exercício — modelo, domínio, `garantir` e `congelar` (US-053 parte 1, `Refs #75`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_parametros/migration.sql`
- Create: `src/modules/cad/domain/{parametros,semaforo}.ts`, `src/modules/cad/application/parametros.ts`
- Modify: `src/modules/cad/application/premissas.ts` (`garantir`/`congelar` reais), `src/modules/cad/infrastructure/seed.ts`, `src/modules/cad/index.ts`, `src/modules/cad/servidor.ts`
- Test: `src/modules/cad/domain/{parametros,semaforo}.test.ts`, `src/modules/cad/application/parametros.int.test.ts`; Modify: `privilegios.int.test.ts`

**Modelos:**
- **`ParametrosExercicio` (`parametros_exercicio`, pk `ano`):**
  - premissas: `reajuste` NUMERIC(9,4), `mesDataBase`, `ipca` NUMERIC(9,4), `salarioMinimo?` NUMERIC(15,2), `diasUteisMes`;
  - semáforo: `semaforoVerdeAte`, `semaforoAmareloAte` e `semaforoLaranjaAte`;
  - situação: `provisorio`, `congeladoEm?`;
  - controle: `versao`, `atualizadoEm`.
- **`EncargoExercicio`:** (`ano`, `componente`) pk; `nome`, `percentual`, `conta`, `provisorio`.
- **`ContaComponenteExercicio`:** (`ano`, `componente`) pk; `conta`, `provisorio`.
- **`ParametroSistema`:** `chave` pk e `valor`.
- **Migration:**
  - `CHECK` de faixa de ano e de mês, e das faixas do semáforo em ordem;
  - `REVOKE DELETE … FROM sgo_app`;
  - `REVOKE ALL … FROM sgo_sync` nas 4 tabelas (B1);
  - **trigger** que recusa `INSERT`/`UPDATE` em `encargo_exercicio` e `conta_componente_exercicio` de ano congelado (defesa no banco, além do app).

**Interfaces — Produces:**

```ts
export type FaixaSemaforo = 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO';
// RN_PLA_006 / C7: ≤ verde → VERDE; ≤ amarelo → AMARELO; ≤ laranja → LARANJA; acima → VERMELHO; null → null.
export function classificarSemaforo(uso: Percentual | null, faixas: { verdeAte: Percentual; amareloAte: Percentual; laranjaAte: Percentual }): FaixaSemaforo | null;
export type ParametrosExercicio = Omit<PremissasExercicio, 'beneficios' | 'avisos'> & {
  diasUteisMes: number; semaforo: { verdeAte: Percentual; amareloAte: Percentual; laranjaAte: Percentual };
};
export function obterParametrosExercicio(ctx: ContextoRequisicao, ano: number, deps?): Promise<ParametrosExercicio | null>;      // cad.parametros:consultar
export function alterarParametrosExercicio(ctx: ContextoRequisicao, ano: number, versao: number, dados: EntradaParametros, deps?): Promise<Resultado<void>>; // cad.parametros:alterar
export function alterarSalarioMinimo(ctx: ContextoRequisicao, ano: number, versao: number, valor: string, deps?): Promise<Resultado<void>>;          // cad.salario_minimo:alterar
export function obterParametroSistema(tx: TxCliente, chave: 'instituicao.nome_exibicao' | 'instituicao.logotipo'): Promise<string>;
// interno, chamado por toda escrita de qualquer tabela do ano (R10, I6): recusa ano congelado e incrementa a versão
export function tocarVersaoExercicio(tx: TxCliente, ano: number, versaoEsperada?: number): Promise<number>;
```

**Funcionalidades (C6):** as duas no grupo "Central de Cálculos".
- **`cad.parametros`:** ações `consultar` e `alterar`. GFIN tem as duas; ORCAMENTISTA, ANALISTA_GRH, AUDITOR e DIREX, só `consultar`.
- **`cad.salario_minimo`:** ações `consultar` e `alterar`. ANALISTA_GRH e GFIN têm as duas; AUDITOR, só `consultar`.

**Seed (2027, provisório):**
- premissas: reajuste 5, data-base 5, IPCA 4 e dias úteis 22;
- encargos e contas como na R14 (as de fora da §6.6 marcadas provisórias);
- SMN nulo;
- semáforo 70/85/95;
- `parametro_sistema` vazio.

- [ ] **Step 1: Testes de domínio (falham):**
  - **`classificarSemaforo`:** 70,00 → VERDE; 70,01 → AMARELO; 85,00 → AMARELO; 95,00 → LARANJA; 95,01 → VERMELHO; 131,91 → VERMELHO; `null` → `null`;
  - **validações:**
    - mês 13;
    - reajuste fora de 0..100;
    - encargo negativo ou com soma acima de 100;
    - faixas fora de ordem;
    - conta que não é analítica ativa (pelo índice do C1);
    - SMN ≤ 0;
    - casas demais.
- [ ] **Step 2: Integração (falha):**
  - **alteração:** auditada com antes e depois em `Dinheiro`/`Percentual`; `versao` velha → "Este registro foi alterado por outro usuário. Recarregue a tela.";
  - **versão por tabela (I6):** alterar o SMN, um encargo ou uma conta incrementa `parametros_exercicio.versao`, com um teste por tabela;
  - **permissão:** GRH altera o SMN e recebe 403 auditado em `alterarParametrosExercicio`;
  - **`garantirPremissasExercicio(2028)`:** copia 2027 e audita; a segunda chamada não faz nada; sem nenhum ano, usa os padrões;
  - **`congelar(2027)`:** depois dele, qualquer alteração de 2027 → `cad.exercicio_congelado`; um `INSERT` direto em `encargo_exercicio` de 2027 → recusado pelo *trigger*;
  - **§10.2, itens 1 e 5:** auditoria falhando → nada gravado; `provisorio`, `congeladoEm` ou `versao` no *payload* → recusados e auditados (M4);
  - **`obterParametroSistema`:** `''` depois do seed;
  - **matriz de privilégios** das 4 tabelas.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar** (migration como na Task 4b).
- [ ] **Step 5:** suíte + lint + typecheck + `test:arq` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 6: PR** "[US-053] Parâmetros por exercício: modelo, versão única do ano e congelamento (parte 1/2)", `Refs #75`, labels `frente:B` e `migration`. Avisar a frente A: `garantir`/`congelar` reais. Lentes: plano/spec, testes, segurança e `security-review`.

### Task 9b: Telas e ações dos parâmetros (US-053 parte 2, `Closes #75`)

**Files:**
- Create: `src/modules/cad/application/acoes-parametros.ts`, `src/modules/cad/ui/form-parametros.tsx`, `src/app/(sistema)/cad/{parametros,salario-minimo}/page.tsx`
- Modify: `worker/index.ts` (nome de exibição, R10)
- Test: `src/modules/cad/application/acoes-parametros.int.test.ts`, `src/modules/cad/ui/form-parametros.test.ts`

- [ ] **Step 1: Testes (falham):**
  - **ações:** com permissão → `Resultado`; sem → 403 auditado;
  - **tela:**
    - o seletor de ano;
    - o bloco de encargos com o total;
    - as contas por componente, escolhidas entre as analíticas;
    - o selo "Provisório";
    - com o ano congelado, todos os campos ficam desabilitados, com a mensagem;
  - **worker:** o `obterNomeExibicao` lê `parametro_sistema` (unidade, com cliente falso).
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.** No `worker/index.ts`: `obterNomeExibicao: () => prisma.$transaction((tx) => obterParametroSistema(tx, 'instituicao.nome_exibicao'))`, via `@/modules/cad/servidor`.
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS; o `worker/bundle.test.ts` continua verde.
- [ ] **Step 5: PR** "[US-053] Telas de parâmetros do exercício e do SMN (parte 2/2)", `Closes #75`, label `frente:B`. Lentes: plano/spec, testes e segurança.

### Task 10: Tabela Mestre de Benefícios por exercício (US-050 parte 1, `Refs #72`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_beneficios/migration.sql`
- Create: `src/modules/cad/domain/beneficios.ts`, `src/modules/cad/application/{beneficios,acoes-beneficios}.ts`, `src/modules/cad/ui/tabela-mestre.tsx`, `src/app/(sistema)/cad/beneficios/page.tsx`
- Modify: `src/modules/cad/application/premissas.ts` (`garantir` copia a Tabela Mestre, I5), `src/modules/cad/infrastructure/seed.ts`, `src/modules/cad/index.ts`
- Test: `src/modules/cad/domain/beneficios.test.ts`, `src/modules/cad/application/beneficios.int.test.ts`; Modify: `privilegios.int.test.ts`

**Modelo `BeneficioMestre` (`beneficio_mestre`):**
- chave: pk (`ano`, `codigo`);
- conteúdo: `nome`, `forma`, `valor?`, `percentual?`, `conta`;
- situação: `padraoPosicao`, `ativo`, `provisorio`;
- controle: `versao`, `atualizadoEm`.
- `CHECK`: a forma bate com o campo preenchido.
- Privilégios: `REVOKE DELETE FROM sgo_app` e `REVOKE ALL FROM sgo_sync`.

**Interfaces — Produces:**

```ts
export type FormaBeneficio = 'VALOR_MENSAL' | 'VALOR_DIARIO' | 'PERCENTUAL_SALARIO';
export type BeneficioMestre = {
  codigo: `beneficio.${string}`; nome: string; forma: FormaBeneficio;
  valor: Dinheiro | null; percentual: Percentual | null; conta: string;
  padraoPosicao: boolean; ativo: boolean; provisorio: boolean; versao: number;
};
export function listarBeneficiosMestre(ctx: ContextoRequisicao, ano: number, deps?): Promise<readonly BeneficioMestre[]>;  // cad.beneficios:consultar
export function incluirBeneficioMestre(ctx: ContextoRequisicao, ano: number, dados: EntradaBeneficio, deps?): Promise<Resultado<void>>; // cad.beneficios:incluir
export function alterarBeneficioMestre(ctx: ContextoRequisicao, ano: number, codigo: string, versao: number, dados: EntradaBeneficio, deps?): Promise<Resultado<void>>;
// Toda escrita chama tocarVersaoExercicio (R10).
export function valorMensalPorPessoa(b: BeneficioMestre, diasUteisMes: number): Dinheiro | null; // DIARIO → valor × dias; PERCENTUAL → null
```

**Funcionalidade (C6):** `cad.beneficios`
- local: grupo "Pessoal", nome "Tabela Mestre de Benefícios", rota `/cad/beneficios`;
- ações: `consultar`, `incluir` e `alterar`;
- perfis: ANALISTA_GRH tem todas; GFIN e AUDITOR, só `consultar`.

**Seed (2027, todos provisórios, sem valor):**

| Código | Forma | Conta | Padrão da posição |
| --- | --- | --- | --- |
| `beneficio.va` | diário | 4.1.1.1.021 | não |
| `beneficio.vr` | diário | 4.1.1.1.009 | sim |
| `beneficio.saude_basico` | mensal | 4.1.1.1.008 | sim |
| `beneficio.saude_intermediario` | mensal | 4.1.1.1.008 | não |
| `beneficio.saude_executivo` | mensal | 4.1.1.1.008 | não |
| `beneficio.odonto` | mensal | 4.1.1.1.013 | não |
| `beneficio.seguro_vida` | mensal | 4.1.1.1.007 | sim |

Os itens padrão seguem a pendência P6.

- [ ] **Step 1: Testes (falham):**
  - **`valorMensalPorPessoa`:** VR diário de 36,50 × 22 → 803,00; mensal 600,00 → 600,00; percentual → `null`;
  - **validações:** percentual ausente; valor negativo; conta que não é analítica ativa; código fora do formato;
  - **integração:**
    - a alteração é auditada;
    - a alteração incrementa `parametros_exercicio.versao` (I6);
    - ano congelado → `cad.exercicio_congelado`;
    - `versao` velha → erro de concorrência;
    - GFIN → 403 auditado ao alterar;
    - auditoria falhando → nada gravado;
  - **`garantirPremissasExercicio(2028)` (I5):** copia os 7 itens de 2027, com valores, formas, contas e `padraoPosicao`. A segunda chamada não duplica;
  - **matriz de privilégios** de `beneficio_mestre`.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar** (migration como na Task 4b).
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 5: PR** "[US-050] Tabela Mestre de Benefícios por exercício (parte 1/2)", `Refs #72`, labels `frente:B` e `migration`. Lentes: plano/spec, testes e segurança.

### Task 11: `MotorCustoPessoal` real e premissas completas (US-051 parte 1, `Refs #73`; **C2 real**)

**Files:** Create `src/modules/cad/domain/motor-custo-pessoal.ts`; Modify `src/modules/cad/application/premissas.ts`, `src/modules/cad/index.ts`, `src/modules/cad/servidor.ts`; Test `src/modules/cad/domain/motor-custo-pessoal.test.ts`, `src/modules/cad/application/premissas.int.test.ts`, Modify `contrato-c2.test.ts`

**Interfaces:**
- Consumes: kernel; o índice do C1; as tabelas das Tasks 9a e 10.
- Produces: `calcularCustoPosicao` e `obterPremissasExercicio` reais, com as assinaturas da Task 3, mais:

```ts
// RN_CAR_17, REQ_CAR_013: total pelo percentual somado e resto no INSS (R13)
export function calcularEncargo(base: Dinheiro, encargos: PremissasExercicio['encargos']):
  { total: Dinheiro; componentes: readonly { componente: ComponenteEncargo; valor: Dinheiro }[] };
```

**Valores conferidos à mão** (planilha de conferência anexada ao PR, linha a linha; ordem das operações da R14):
- **Encargo do C&S V4 (§6.1):** `calcularEncargo(6.500,00)`:

  | Componente | Valor |
  | --- | --- |
  | INSS | 2.470,00 |
  | FGTS | 520,00 |
  | PIS | 65,00 |
  | Obrigações | 247,00 |
  | Riscos | 13,00 |
  | **Total** | **3.315,00** |

- **Posição do exemplo da planilha-modelo:** 2 × 7.500,00, de janeiro a dezembro, reajuste de 5% a partir de maio, 51% de encargo, e VR 800,00 + saúde 600,00 + vida 50,00 por pessoa/mês.

  | Componente | Jan–Abr (cada mês) | Mai–Dez (cada mês) |
  | --- | --- | --- |
  | Salário | 15.000,00 | 15.750,00 |
  | Férias + 1/3 | 1.666,67 | 1.750,00 |
  | 13º | 1.250,00 | 1.312,50 |
  | Base do encargo | 17.916,67 | 18.812,50 |
  | Encargo total | 9.137,50 (9.137,5017) | 9.594,38 (9.594,375, Half-Even para cima porque 7 é ímpar) |
  | INSS | 6.808,34 (6.808,33 + resto 0,01) | 7.148,76 (7.148,75 + resto 0,01) |
  | FGTS | 1.433,33 | 1.505,00 |
  | PIS | 179,17 | 188,12 (188,125 → Half-Even) |
  | Obrigações | 680,83 | 714,88 |
  | Riscos | 35,83 | 37,62 |
  | Benefícios | 2.900,00 | 2.900,00 |
  | **Total do mês** | **29.954,17** | **31.306,88** |

  Total anual: **370.271,72**; salário anual: 186.000,00. Sem *drift*: a soma das linhas é igual ao `totalMes`, e a soma dos meses é igual ao `total`.
- **Recortes:**
  - início 3 e saída 10 → meses 1, 2, 11 e 12 zerados;
  - insalubridade de grau médio com SMN de 1.518,00 e 1 pessoa → 303,60, sem reajuste;
  - periculosidade em 5.000,00 → 1.500,00, e 1.575,00 depois da data-base;
  - benefício `PERCENTUAL_SALARIO` de 2% (R14a), 2 × 7.500,00 → 300,00 de janeiro a abril e 315,00 de maio em diante.

- [ ] **Step 1: Testes de domínio (falham)** com os valores acima (nomes com o código da regra, ex.: `RN_CAR_17 encargo do exemplo do C&S`). Também:
  - **erros (`Resultado`):** quantidade 0 ou 1,5; salário 0; saída < início; mês 13; insalubridade sem SMN ("Cadastre o Salário Mínimo Nacional do exercício antes de usar insalubridade."); componente sem conta.
- [ ] **Step 2: Integração (falha):**
  - **padrões do seed:** `obterPremissasExercicio(2027)` → `provisorio: true`, encargos somando 51, `beneficios: []` e 3 avisos;
  - **VR preenchido:** VR diário de 36,50 → `VALOR_MENSAL` de 803,00, e a `versao` muda;
  - **ano inexistente** → `null`; **ano congelado** → `congelado: true`;
  - **conta inativada pela recarga** → aviso nas premissas, e o cálculo recusa o componente.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar.** Função pura, só `Dinheiro`/`Percentual`, na ordem da R14.
- [ ] **Step 5:** suíte + lint + typecheck → PASS.
- [ ] **Step 6: PR** "[US-051] MotorCustoPessoal real e premissas do exercício (contrato C2) (parte 1/2)", `Refs #73`, label `frente:B`.
  - **No corpo:** a planilha de conferência; o aviso à frente A de que o C2 real está na `main`; a nota P1 sobre o `orc`; as pendências P9 e P10.
  - **Lentes:** plano/spec, testes (o revisor confere 3 valores com calculadora), segurança, `type-design-analyzer` e `silent-failure-hunter`.

### Task 12a: Cargos — modelo, cifra, domínio e importação dos dados do Rubi (US-049 parte 1, `Refs #71`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_cargos/migration.sql`
- Create: `src/modules/cad/domain/cargo.ts`, `src/modules/cad/infrastructure/cifra-salarios.ts` (com `import 'server-only'`), `src/modules/cad/infrastructure/dados/cargos-sinteticos.json`
- Modify: `src/modules/cad/application/{importar-estrutura,aplicar-carga}.ts`, `src/modules/cad/infrastructure/seed-referencia.ts`, `src/modules/cad/index.ts`, `docs/operacao/ambientes.md` (chaves no `app`, cópia fora da VPS, roteiro de rotação da R7)
- Test: `src/modules/cad/domain/cargo.test.ts`, `src/modules/cad/infrastructure/cifra-salarios.test.ts`, `src/modules/cad/application/importar-cargos.int.test.ts`; Modify: `privilegios.int.test.ts`

**Modelos:**
- **`Cargo` (`cargo`):**
  - **origem Rubi:** `codigo` único, `nomeOficial`, `nomeMercado`, `tabelaSalarialCodigo?`, `tabelaSalarialDescricao?`, `faixaCodigo?`, `faixaDescricao?`, `nivelCodigo?`, `nivelDescricao?` e `salarioRealCifrado?`;
  - **manuais:** `funcaoGratificadaCifrada?`, `salarioDefinidoCifrado?`, `mercadoMinimo?`, `mercadoMaximo?`, `origemMercado?`, `origemMercadoRotulo?`, `fonteAtiva?`, `adicionalTipo?`, `adicionalGrau?` e `vinculoFuncionalId?` (R11);
  - **controle:** `ativo`, `versao`, `cargaId?`, `criadoEm`, `atualizadoEm`.
- **`Senioridade`** e **`FaixaSalarial`**, como na Task 12c (schema aqui, na mesma migration).

**Migration:**
- **`CHECK`:** RN_CAR_12 (adicional e grau coerentes) e `mercado_minimo < mercado_maximo`.
- **Trigger** que recusa `UPDATE` de `codigo`.
- **Privilégios em `cargo` (B1, R6):**
  - `REVOKE ALL` dos dois papéis;
  - `GRANT SELECT` aos dois;
  - `GRANT UPDATE (<colunas manuais>, versao, atualizado_em) TO sgo_app`;
  - `GRANT INSERT, UPDATE (<colunas Rubi>, ativo, versao, atualizado_em, carga_id) TO sgo_sync`.
- **Privilégios em `senioridade` e `faixa_salarial`:** `REVOKE DELETE FROM sgo_app` e `REVOKE ALL FROM sgo_sync`.

**Interfaces — Produces:**

```ts
export type FonteAtiva = 'MINIMO' | 'MAXIMO' | 'TOTAL' | 'REAL' | 'DEFINIDO'; // C20: DEFINIDO [PROVISÓRIA]
export type SalariosCargo = { minimo: Dinheiro | null; maximo: Dinheiro | null; funcaoGratificada: Dinheiro | null; real: Dinheiro | null; definido: Dinheiro | null };
export function salarioTotal(s: SalariosCargo): Dinheiro | null;        // R19
export function salarioDaFonte(s: SalariosCargo, fonte: FonteAtiva): Dinheiro | null;
export function desvioDeMercado(s: SalariosCargo): 'ABAIXO' | 'DENTRO' | 'ACIMA' | null; // REQ_CAR_005
// infrastructure (não exportado): AES-256-GCM, IV 12 B, tag 16 B, AAD com o código, o campo e o id da chave; keyring (R7)
interface CifraSalarios {
  cifrar(valor: Dinheiro, contexto: { codigoCargo: string; campo: CampoCifrado }): string;
  decifrar(envelope: string, contexto: { codigoCargo: string; campo: CampoCifrado }): Dinheiro;
  idChaveAtual(): string;
}
function criarCifraSalarios(fonte?: Readonly<Record<string, string | undefined>>): CifraSalarios;
// app: exigir(ctx,'cad.cargos','executar'); cifra o salário real no staging (R7, R20)
export function solicitarCargaCargos(ctx: ContextoRequisicao, arquivo: ArquivoCarga, deps?: { cliente?: PrismaClient; cifra?: CifraSalarios }): Promise<Resultado<{ cargaId: string }>>;
```

- [ ] **Step 1: Testes de domínio (falham):**
  - **`salarioTotal`:** 9.000,00 + 1.200,00 → 10.200,00; sem FG → 9.000,00; sem máximo → `null`;
  - **`salarioDaFonte`:** as 5 fontes;
  - **`desvioDeMercado`:** ABAIXO, DENTRO e ACIMA;
  - **E5:** os dois adicionais → "Um cargo pode ter apenas um adicional trabalhista: Periculosidade OU Insalubridade.";
  - **E3:** mínimo ≥ máximo.
- [ ] **Step 2: Testes da cifra (falham, I6):**
  - ida e volta de "7500.00";
  - o envelope tem `v1:<id>:`;
  - 1.000 cifras do mesmo valor → 1.000 IVs distintos;
  - AAD de outro código, outro campo ou outro id de chave → erro;
  - *tag* truncada para 12 bytes → erro (não aceita *tag* curta);
  - 1 byte adulterado → erro;
  - chave de 31 bytes → erro cuja mensagem cita `CHAVE_CIFRA_SALARIOS` sem o valor;
  - sem chave → `cad.cifra_indisponivel`;
  - **keyring:** o envelope de `k0` decifra com `k0` em `_ANTERIORES` e `k1` como atual; o de um id desconhecido → erro;
  - **produção:** `AMBIENTE=producao` com a chave de teste → erro.
- [ ] **Step 3: Integração (falha):**
  - **importação:**
    - entram os cargos com o salário real cifrado (`SELECT` direto não acha "7500" em nenhuma coluna);
    - a linha com salário inválido dá erro **sem repetir o valor** (I9): a mensagem cita só a linha e a coluna "Salário Real";
  - **recarga:** idempotente pelo código; não toca nos campos manuais; o cargo ausente fica inativo;
  - **papel:** a carga só roda como `sgo_sync`;
  - **matriz de privilégios por coluna** (`column_privileges`) de `cargo`, igual à da migration;
  - **Histórico:** tem o envelope, nunca o valor;
  - **seed:** com `CARGA_DADOS_REFERENCIA=1`, os cargos sintéticos entram **sem salário**, e a seed roda sem a chave.
- [ ] **Step 4:** testes → FAIL.
- [ ] **Step 5: Implementar** (migration como na Task 4b).
- [ ] **Step 6:** suíte + lint + typecheck + `test:arq` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 7: PR** "[US-049] Cargos: dados do Rubi por arquivo e salários cifrados (parte 1/3)", `Refs #71`, labels `frente:B` e `migration`. Pendências P1 a P4. **PO:** gerar as chaves, cadastrar no `app` de hml e prod e guardar a cópia fora da VPS. Lentes: plano/spec, testes, segurança, `security-review` e `type-design-analyzer`.

### Task 12b: Telas de cargo com máscara por permissão e regravação da cifra (US-049 parte 2, `Refs #71`)

**Pré-condição:** a issue de contrato C6 (`exibirNoMenu`) resolvida, ou o plano B da R24 aprovado pelo PO no PR.

**Files:**
- Create: `src/modules/cad/application/{cargos,acoes-cargos}.ts` (`server-only`), `src/modules/cad/ui/{lista-cargos,form-cargo}.tsx`, `src/app/(sistema)/cad/cargos/{page,[id]/page,importar/page}.tsx`
- Modify: `src/modules/cad/infrastructure/seed.ts`, `src/modules/cad/index.ts`, `docs/operacao/ambientes.md` (rotação)
- Test: `src/modules/cad/application/cargos.int.test.ts`, `src/modules/cad/ui/form-cargo.test.ts`

**Interfaces — Produces:**

```ts
export type CargoTela = {
  id: string; codigo: string; nomeOficial: string; nomeMercado: string;
  tabelaSalarial: string | null; faixa: string | null; nivel: string | null; // "[código] — [descrição]" (RN_CAR_09)
  salarios: { [K in keyof SalariosCargo]: string | null }; // null se vazio ou mascarado
  mascarado: boolean;                                       // R24
  origemMercado: string | null;
  fonteAtiva: FonteAtiva | null; adicional: AdicionalTrabalhista | null;
  desvioDeMercado: 'ABAIXO' | 'DENTRO' | 'ACIMA' | null;    // null também quando mascarado
  ativo: boolean; versao: number;
};
export function listarCargos(ctx: ContextoRequisicao, deps?): Promise<readonly CargoTela[]>;   // cad.cargos:consultar
export function obterCargo(ctx: ContextoRequisicao, id: string, deps?): Promise<CargoTela | null>; // sem máscara só com cad.salarios:consultar (audita CONSULTA)
export function alterarCargo(ctx: ContextoRequisicao, id: string, versao: number, dados: EntradaCargo, deps?): Promise<Resultado<void>>; // cad.cargos:alterar
export function exportarCargos(ctx: ContextoRequisicao, deps?): Promise<Resultado<Uint8Array>>; // cad.cargos:exportar; mascarada sem cad.salarios
// R7: regrava os envelopes com a chave atual (manuais direto; salário real por lote CARGOS_RECIFRA no worker)
export function regravarCifraSalarios(ctx: ContextoRequisicao, deps?): Promise<Resultado<{ manuais: number; cargaId: string | null }>>; // cad.cargos:executar
```

**Funcionalidades (C6):**
- **`cad.cargos`:**
  - local: grupo "Pessoal", nome "Cargos e Salários", rota `/cad/cargos`;
  - ações: `consultar`, `alterar`, `exportar` e `executar`;
  - perfis: ANALISTA_GRH tem todas; GFIN, ORCAMENTISTA, AUDITOR e DIREX têm `consultar` e `exportar`.
- **`cad.salarios`** (R24): ação `consultar`, `nivelLog` `AVANCADO`, `exibirNoMenu: false`. Por padrão, ANALISTA_GRH e GFIN (pendência P5).

- [ ] **Step 1: Testes (falham):**
  - **máscara (R24):**
    - ORCAMENTISTA recebe `mascarado: true`, salários nulos e desvio nulo, e o HTML da página não tem os valores;
    - a exportação dele tem as colunas de salário vazias;
    - GRH recebe os valores, e cada leitura sem máscara grava um `CONSULTA` sem valores;
  - **ORIGEM BLINDADA:** `salarioReal` ou `nomeOficial` no *payload* → `cad.violacao_governanca`, auditado, nada gravado (M4);
  - **E6:** insalubridade sem SMN → erro em `adicional`;
  - **concorrência:** `versao` velha → erro de concorrência;
  - **escrita sem permissão:** AUDITOR → 403 auditado;
  - **auditoria:** com o `auditar` falhando, nada é gravado;
  - **regravação (I7):**
    - com `k0` em `_ANTERIORES` e `k1` atual, os manuais passam para `k1`;
    - o lote `CARGOS_RECIFRA` processado pelo worker leva o salário real para `k1`;
    - um cargo alterado no meio da regravação não é sobrescrito;
    - depois, nenhum envelope com `:k0:`;
  - **tela:** os campos Rubi desabilitados; as 5 fontes; o desvio com cor **e** texto; sem botão Novo.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.** A decifra é feita só no servidor e só com `cad.salarios`; o regravar só acontece quando o valor muda.
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-049] Telas de cargos com salários mascarados por permissão e rotação da chave (parte 2/3)", `Refs #71`, label `frente:B`. Lentes: plano/spec, testes, segurança e `security-review`.

### Task 12c: Tabela salarial e senioridades (US-049 parte 3, `Closes #71`)

**Files:** Create `src/modules/cad/application/{tabela-salarial,acoes-tabela-salarial}.ts`, `src/modules/cad/ui/tabela-salarial.tsx`, `src/app/(sistema)/cad/tabela-salarial/page.tsx`; Modify `form-cargo.tsx`, `seed.ts`; Test `tabela-salarial.int.test.ts`

**Interfaces — Produces:**
- **Faixas:** `listarFaixasSalariais`, `incluirFaixaSalarial`, `alterarFaixaSalarial` e `inativarFaixaSalarial` (`cad.tabela_salarial`).
- **Senioridades:** `incluirSenioridade` e `inativarSenioridade` (RN_TAB_01, E4).
- **Cópia:** `copiarFaixaParaCargo(ctx, cargoId, faixaId, versao)` grava o rótulo "Preenchido via Tabela Salarial — <cargo>/<senioridade>" (REQ_TAB_003/005). A edição manual troca o rótulo para "Editado manualmente".

**Funcionalidade (C6):** `cad.tabela_salarial`
- local: grupo "Pessoal", rota `/cad/tabela-salarial`;
- ações: `consultar`, `incluir`, `alterar` e `excluir` (inativação);
- perfis: ANALISTA_GRH tem todas; GFIN, só `consultar`.

- [ ] **Step 1: Testes (falham):**
  - mínimo ≥ máximo → erro nos dois campos;
  - dois registros do mesmo par aceitos (RN_TAB_03);
  - inativar "Pleno" → erro; inativar uma customizada com faixa ativa → erro (E4);
  - o rótulo de origem muda na edição manual;
  - os testes §10.2 de 1, 3 e 4.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-049] Tabela salarial e senioridades (parte 3/3)", `Closes #71`, label `frente:B`. Lentes: plano/spec, testes e segurança.

### Task 13: Benefícios do cargo e sobrescrita pela Tabela Mestre (US-050 parte 2, `Closes #72`)

**Files:** Modify `prisma/schema/cad.prisma`; Create `prisma/migrations/<AAAAMMDDHHMM>_cad_beneficio_cargo/migration.sql`; Modify `src/modules/cad/application/{beneficios,cargos}.ts`, `src/modules/cad/ui/form-cargo.tsx`; Test `beneficio-cargo.int.test.ts`, Modify `privilegios.int.test.ts`

**Modelo `BeneficioCargo` (`beneficio_cargo`):**
- chave: pk (`cargoId`, `ano`, `codigo`);
- conteúdo: `ativo`, `valorManual?`, `origem` (`MESTRE` | `MANUAL`), `atualizadoEm`.
- Privilégios: `REVOKE DELETE FROM sgo_app` e `REVOKE ALL FROM sgo_sync`.

**Interfaces — Produces:**
- `alterarBeneficiosCargo(ctx, cargoId, ano, versaoCargo, itens)` (`cad.cargos:alterar`): grava `origem = MANUAL` quando há valor manual (RN_CAR_07).
- O `alterarBeneficioMestre` passa a apagar, na mesma transação, o valor manual dos cargos daquele `(ano, codigo)` e pôr `origem = MESTRE`, com Histórico por cargo (RN_CAR_06, C8).

- [ ] **Step 1: Testes (falham):**
  - **sobrescrita:** 3 cargos com VR manual voltam a `MESTRE`, com 3 Históricos;
  - **outro ano:** o de 2028 não muda;
  - **congelado:** com 2027 congelado → recusado e nada muda;
  - **atomicidade:** auditoria falhando no 2º cargo → nada muda;
  - **tela:** a origem aparece.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar** (migration como na Task 4b).
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 5: PR** "[US-050] Benefícios do cargo com sobrescrita auditada pela Tabela Mestre (parte 2/2)", `Closes #72`, labels `frente:B` e `migration`. Lentes: plano/spec, testes, segurança e `silent-failure-hunter`.

### Task 14: Custo do cargo pelo motor (US-051 parte 2, `Closes #73`)

**Files:** Create `src/modules/cad/application/custo-cargo.ts`, `src/modules/cad/ui/bloco-encargo.tsx`; Modify `form-cargo.tsx`, `index.ts`; Test `custo-cargo.int.test.ts`, `bloco-encargo.test.ts`

**Interfaces — Produces:**

```ts
// Custo unitário mensal do cargo no exercício (1 pessoa, jan–dez, Fonte Ativa, adicional e benefícios ativos do cargo).
// Sem cad.salarios: série, total, encargo e componentes mascarados (R24).
export function calcularCustoCargo(ctx: ContextoRequisicao, cargoId: string, ano: number, deps?):
  Promise<Resultado<{ serie: SerieMensalComponentes | null; encargo: ReturnType<typeof calcularEncargo> | null; mascarado: boolean }>>;
```

- [ ] **Step 1: Testes (falham):**
  - **cargo com periculosidade:** Fonte Ativa 5.000,00 + periculosidade → no mês 1, salário 5.000,00 e adicional 1.500,00, conferidos à mão no PR;
  - **REQ_CAR_013:** o bloco mostra o consolidado (R$ e 51%) e o detalhe;
  - **sem Fonte Ativa** → "Selecione a Fonte Ativa para calcular o custo.";
  - **ORCAMENTISTA** → `serie` e `encargo` nulos, e o HTML sem valores.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-051] Custo do cargo pelo MotorCustoPessoal (parte 2/2)", `Closes #73`, label `frente:B`. Pendência GAP-CAR-005. Lentes: plano/spec, testes, segurança e `security-review`.

---

## Riscos

- **SMTP de prod indefinido (GAP-INF-001):** até o PO decidir (P7), cada e-mail falha "SMTP não configurado" e termina em falha definitiva, com os dados apagados (R23). A US-038 da frente A não entrega senha em hml. O administrador gera a senha de novo depois que o SMTP existir.
- **E-mail duplicado:** a entrega é "pelo menos uma vez" (queda entre o aceite do SMTP e o fim do job). Aceito: a senha é a mesma e vale 24 h.
- **Senha temporária no WAL e nos backups:** já aceito na §11.2a.
- **Perda ou vazamento da chave de salários:** sem a cópia do PO, o backup restaura salários ilegíveis. A cifra não protege uma VPS comprometida (R7). Mitigação: a cópia fora da VPS, o *keyring* e a regravação documentados em `docs/operacao/ambientes.md`.
- **Carga assíncrona:** o *merge* depende do worker e do `SYNC_DATABASE_URL`. Com o worker parado, os lotes ficam `PENDENTE` e visíveis na tela; não há carga parcial.
- **Medição de 60 FPS:** depende do usuário GFIN no `global-setup` (frente A). Sem ele, a medição é o passo do PO em hml (Task 6a).
- **Classificação imutável (R5):** uma reclassificação real no ERP vira registro novo, e o antigo é inativado. Se a frente A já tiver valores na classificação antiga, a US-121 recusa o lançamento (o C1 só aceita ativo) e a GFIN relança. Esse é o custo de manter a chave estável.
- **Minuta de CC mudando depois de 16/11:** o reduzido trocado (GAP-CC-003) vira CC novo, e o antigo é inativado.
- **Benefícios sem valor:** se a GRH não preencher até a US-121, o custo sai sem benefícios, com aviso nas premissas.
- **Dependência do C6 (`exibirNoMenu`):** sem o acréscimo, vale o plano B da R24 (item de menu redundante).
- **Fila de migrations:** seis migrations neste bloco, uma por PR, junto com as da frente A no P5 e no P6. Uma colisão de ordem obriga a regerar a migration (§12.7 item 3).

## Encerramento do P4

- [ ] Critérios de aceite das issues #43, #47, #65, #66, #68, #71, #72, #73 e #75 marcados, com o link da prova.
- [ ] `npm run lint && npm run typecheck && npm test && npm run test:arq` verdes na `main`; `npm run test:int`, `npm run build` e o E2E de rolagem, cada um sozinho (D12).
- [ ] C1, C2 e o acréscimo `lerPlanilhaSegura` ao C3 reais na `main`, com os falsos exportados.
- [ ] Revisão do bloco (§12.12) nos épicos EP03, EP06, EP07 e EP08.
- [ ] Pendências P1 a P12 na memória, com o que cada uma destrava.
- [ ] Spec v1.6 (PR `compartilhado` de spec):
  - D7 com a classificação imutável (R5);
  - §5 com o *staging* no app e o *merge* no worker (R6);
  - R9 (EP083, inclusive o 5xx);
  - R14a;
  - R23;
  - D10 com a R7 e o limite da cifra;
  - R11, R13, R14, R18 (§4.2) e R19;
  - C7 por exercício (P12);
  - C2 com `Resultado` e `tx` (R3);
  - `AMBIENTE` (R25);
  - o `Refs #n` pendente do P3.
- [ ] Plano-mestre: as assinaturas do C1/C2 da R3.
- [ ] Atualizar `docs/memoria/memoria-do-projeto.md` (estado, pendências e diário).
- [ ] Detalhar o P7 (US-115 a US-117) com o writing-plans.
