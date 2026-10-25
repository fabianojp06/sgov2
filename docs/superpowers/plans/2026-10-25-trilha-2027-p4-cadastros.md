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
- **`ger` (componentes):** a US-025 troca o `enviarEmail` do C4 de "indisponível" para *outbox* real e cria o trabalhador de e-mail, registrado no `worker/index.ts`. A US-021 troca a implementação da `GradeArvore` do C3 mantendo as *props* (as novas são opcionais) e torna o `exportarXlsx` real.
- **`cad` (cadastros), dono de `prisma/schema/cad.prisma`:** plano de contas, centros de custo, cargas de estrutura, parâmetros por exercício, Tabela Mestre de Benefícios, cargos, tabela salarial e o `MotorCustoPessoal`. Tudo o que outro módulo usa sai do `src/modules/cad/index.ts`.
- **Estrutura financeira é espelho de ERP** (D7, D9, C27): só a carga escreve a estrutura, conectando como `sgo_sync`; o `sgo_app` só lê. Sem CRUD de estrutura.
- **Contratos primeiro** (spec §12.6): C1 e C2 entram como PRs pequenos com tipos, assinaturas e falsos. Até a implementação real chegar, as funções reais lançam `ErroDominio('cad.*_indisponivel')`, no mesmo padrão do C4.
- **Dinheiro:** `Dinheiro`/`Percentual` do kernel em todo cálculo, `NUMERIC(15,2)`/`NUMERIC(9,4)` no banco, Half-Even; `number` só para contagem, mês e nível.

**Tech Stack:** Next.js 16.4.3 (App Router, Server Actions) · React 19.3.1 · Prisma 7.10.1 · PostgreSQL 16 · pg-boss 12.38.0 · Zod 4.6.7 · decimal.js 10.6.0 · Vitest 5.0.5 + Testcontainers. Dependências novas, no PR compartilhado da Task 0: **`exceljs`** (leitura e escrita de .xlsx, spec §4.2), **`nodemailer`** + `@types/nodemailer` (SMTP, spec §4.2), **`@tanstack/react-virtual`** (virtualização da Tree Grid, spec §4.2) e, só em `devDependencies`, **`smtp-server`** + `@types/smtp-server` (servidor SMTP em processo, para o teste de integração do e-mail, sem contêiner a mais).

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (**v1.5**) — §3.3, §4.1, §4.2, §5, §6.1, §6.1a, §6.4, §6.6, §6.7, §10.2, §10.3, §11.5, §12.3, §12.5–§12.7, §12.12; D4, D5, D7, D9, D10, D12; C7, C8, C20, C23, C27, C33, C34. Regras de `especificacao/`: EP083 V3 (UC0.01 e UC0.06), Minuta de Cadastros V5 (UC03.00, UC03.18, UC03.28, RN_PLA_001–011), UC03.19 Cargos e Salários V4 (RN_CAR_*, RN_TAB_*, REQ_CAR_*, REQ_TAB_*), planilha oficial do plano de contas (`especificacao/Plano_de_Contas_5_Niveis_*.xlsx`) e minuta de CC Rev23102026. **Plano-mestre:** `docs/superpowers/plans/2026-10-24-trilha-2027-plano-mestre.md` (P4: US-021 #43, US-025 #47, US-043 #65, US-044 #66, US-046 #68, US-049 #71, US-050 #72, US-051 #73, US-053 #75; contratos C1 e C2, consumidos pela US-121 #143 do P6).

## Global Constraints

- **D12 / spec §11.5 item 6:** nenhuma sessão toca contêineres, redes, volumes ou variáveis de `sgo-prod`/`sgo-hml`. O que é feito no Easypanel (variáveis SMTP, chave de salários, `SYNC_DATABASE_URL`), o **PO executa**.
- **Um processo pesado por vez (D12):** `test:int`, `build` e E2E rodam um de cada vez. Antes de cada um, conferir que a frente A não está rodando nada pesado: `pgrep -af 'vitest|next build|playwright'` sem saída da worktree `/root/sistemas/sgo`. Rodar com `nice -n 10`.
- **Portas só em `127.0.0.1`:** o banco de dev da frente B fica em 56432, o app em 3200 e o Mailpit em 8225. O servidor SMTP de teste (`smtp-server`) escuta em `127.0.0.1`, em porta aleatória.
- **Banco (spec §11.5):** antes de todo comando que toca banco, dizer se ele **escreve, apaga ou reseta**, e conferir `MIGRATE_DATABASE_URL` e `SHADOW_DATABASE_URL` (devem apontar para `127.0.0.1:56432`).
  - `migrate dev --create-only`, `migrate diff` e `db push` só no dev local.
  - Recriar o banco de dev da frente B: `docker compose down -v` (**apaga** só o banco de dev local 56432), depois `docker compose up -d --wait`, `npm run db:deploy` e `npm run db:seed` (**escrevem** no dev local).
- **Migrations (spec §12.7):**
  - uma por PR, com a label `migration`, e o PO faz o merge de uma por vez;
  - nome `AAAAMMDDHHMM_cad_<descricao>`, gerado depois do rebase, **maior que a última migration da `main`** (`ls prisma/migrations | tail -1`), senão a tabela nasce sem os privilégios padrão do `sgo_app`;
  - os `REVOKE`/`GRANT`, `CHECK` e *triggers* vão à mão no `migration.sql`, como no P1 e no P5;
  - depois do `db:deploy` local, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code` sem diferença, igual ao CI.
- **Propriedade (spec §12.3, `.github/frentes.yml`):** este bloco só cria ou altera arquivos em:
  - `src/modules/{ger,cad}/`, `prisma/schema/cad.prisma`, `prisma/migrations/`;
  - `src/app/(sistema)/cad/`, `worker/` e `docs/operacao/`.

  Os arquivos compartilhados (`package.json`, `package-lock.json`, `.env.example`, `docker-compose.yml`, `prisma/seed.ts`, `next.config.ts`) só mudam em PR `compartilhado` exclusivo (Tasks 0 e 4b). `src/shared/**` é da frente A: nenhuma tarefa daqui altera esses arquivos (o que precisar vira issue para a frente A).
- **Variáveis de módulo:** o `ger` e o `cad` leem as próprias variáveis com Zod, em `infrastructure/` (o `src/shared/config` é da frente A). Mensagem de erro cita o **nome** da variável, nunca o valor.
- **Autorização e auditoria (C5):**
  - toda Server Action com `definirAcao`; toda `page.tsx` de `src/app/(sistema)/cad/` começa com `await exigirPagina(...)` (o teste de arquitetura impõe);
  - todo caso de uso chama `exigir(ctx, funcionalidade, acao)` primeiro e audita com `auditar(tx, evento)` no mesmo `tx`;
  - dinheiro auditado como `Dinheiro`/`Percentual`.
- **Testes obrigatórios das diretrizes (spec §10.2), em toda tarefa com escrita:**
  - item 1, auditoria falhando: nada persiste (com `vi.mock('@/shared/audit', …)`, R13 do P5);
  - item 3, ação sem permissão: 403 auditado;
  - item 4, dois saves concorrentes: o segundo recebe o erro de concorrência;
  - item 5, campo ORIGEM BLINDADA no *payload*: ignorado ou rejeitado;
  - item 6, soma de dinheiro sem *drift*.

  O item 2 (unidade) não se aplica: cadastros globais não têm `unidade_id` (spec §5).
- **Dados provisórios marcados:** o que depende de GAP aberto entra no banco com `provisorio = true` e aparece na tela com o selo "Provisório". Isso vale para:
  - CC da minuta (GAP-CC-001 a 006);
  - premissas do exercício (GAP-ORC-003);
  - contas de Obrigações e Riscos Trabalhistas (GAP-CAR-005);
  - benefícios sem valor (pendência da GRH).

  A descrição da conta 4.1.1.8.005 entra sem a sigla (GAP-CAD-005). As 15 contas do protótipo que não existem no plano oficial (GAP-CAD-004) **não** são criadas, porque não há CRUD de conta (C27).
- **GAP-INF-001 (SMTP de prod):** o código da US-025 fica pronto e testado com Mailpit e com o `smtp-server`. A configuração de hml e prod é pendência do PO.
- **Marca neutra:** a sigla da instituição não aparece em código, dados de seed, nomes de coluna, modelos de e-mail nem cabeçalhos de planilha.
  - O campo que o C&S V4 chama pelo nome da instituição vira **"Cargo (nome oficial)"** (`nomeOficial`).
  - Arquivos de `especificacao/` cujo nome tem a sigla são localizados por *glob* (`Plano_de_Contas_5_Niveis_*.xlsx`), nunca pelo nome literal.
- **Tamanho:** PR de até cerca de 400 linhas de código de produção (§12.5). Por isso, as US-043, US-046, US-049, US-050 e US-051 são divididas.
- **Por tarefa:**
  - branch `us-NNN-slug`, título `[US-NNN] …`;
  - `Closes #n` só no PR que prova o último critério de aceite; os anteriores usam `Refs #n`;
  - labels `frente:B` e, quando couber, `migration` ou `contrato`;
  - commits com `Frente: B` e os trailers de coautoria;
  - push, PR e merge só com confirmação do PO;
  - antes de chamar o PO, o comentário "Revisão de código (12.12)", com as lentes indicadas na tarefa e **no máximo 2 rodadas** de correção (depois disso, o PO decide). Merge sempre pelo PO, em *squash*.
- Textos de interface, mensagens e logs em português do Brasil.

## Rulings do planejamento

- **R1. Onde vivem os cadastros.** Plano de contas, centros de custo, cargas, parâmetros do exercício, parâmetros do sistema (`instituicao.*`), Tabela Mestre, cargos, tabela salarial e o `MotorCustoPessoal` ficam no módulo **`cad`**, com schema em `prisma/schema/cad.prisma`.
  - **Fonte:** spec §3.1 (CAD = UC03.*), §6.4 ("`MotorCustoPessoal` (módulo `cad`)"), §12.2 (frente B: "cadastros (plano de contas, CC, pessoal-base, MotorCustoPessoal, parâmetros)") e §12.3.
  - **Relação com outros módulos:** só por chave natural (classificação, ano), sem FK cruzada (§12.7 item 1).
  - **Custo se errado:** mover modelos entre arquivos de schema, sem mudar as tabelas.
- **R2. `MotorCustoPessoal` × `MotorCustoPosicao`.** O título da issue #73 e a US-121 dizem `MotorCustoPosicao`; a spec (§6.4, §6.6, C33) diz `MotorCustoPessoal`, cuja "função de posição" é a `calcularCustoPosicao`. Vale a spec: o nome do conceito é `MotorCustoPessoal`, e a função do contrato é `calcularCustoPosicao`. Nada a renomear no código da frente A.
- **R3. Contratos C1/C2 com o `tx` do consumidor.** O plano-mestre lista `obterPremissasExercicio(ano)` e `listarArvoreContas()` sem argumentos. O contrato acrescenta o `tx: TxCliente` como primeiro parâmetro, como no `enviarEmail` do C4. Assim, a US-121 lê a estrutura e as premissas na mesma transação em que grava (leitura consistente).
  - As funções do C1/C2 **não** têm guarda própria: quem chama já passou pela guarda da própria funcionalidade. Elas nunca são expostas como Server Action.
  - **Custo se errado:** mudar assinaturas antes de a frente A implementar o P6.
- **R4. Formato das planilhas de importação.**
  - **Plano de contas:** exatamente o layout da planilha oficial (aba "Plano de Contas", cabeçalho na linha 1: Nível, Classificação, Conta Superior, Descrição, Tipo, Conta Reduzida).
  - **CC:** o layout da minuta (cabeçalho em qualquer uma das 10 primeiras linhas, achado pela célula "Classificação"; colunas Classificação, Código reduzido, Descrição (original), Descrição sugerida, Nível, Classificação pai, Tipo, Aceita lançamento). A coluna "Observação" é ignorada (§6.1a).
  - **Regras comuns:**
    - colunas reconhecidas pelo **nome**, sem diferenciar maiúsculas e acentos; coluna obrigatória ausente reprova a carga;
    - só valores, nunca fórmulas: com fórmula, vale o resultado gravado na célula;
    - leitura em *stream* (`ExcelJS.stream.xlsx.WorkbookReader`), com teto de 1 MB por arquivo e 20.000 linhas, para uma planilha maliciosa não esgotar a memória (D12).
  - **Fonte:** D7, §6.1, §6.1a e o cabeçalho da minuta ("Colunas A–G seguem o layout de importação").
  - **Custo se errado:** um adaptador de leitura a mais, atrás da mesma porta.
- **R5. Chave de casamento da recarga (D7).** A recarga casa a conta **analítica** pelo `codigo_reduzido` e a **sintética** (que não tem reduzido) pela `classificacao`. No CC, que tem reduzido em todos, casa sempre pelo reduzido.
  - A recarga atualiza descrição, classificação, pai, nível e situação.
  - Linha ausente no arquivo **inativa** o registro (soft delete); nada é apagado.
  - Recarregar o mesmo arquivo não muda nada, nem o Histórico (só a linha do lote em `carga_estrutura`, com `inalteradas = total`).
- **R6. Estrutura só pela carga, como `sgo_sync` (D9, §5 ORIGEM BLINDADA).**
  - Nas tabelas `conta_contabil`, `centro_custo` e nas colunas de origem Rubi de `cargo`, o `sgo_app` não tem `INSERT`, `UPDATE` nem `DELETE` (só `SELECT`); o `sgo_sync` tem `INSERT`/`UPDATE`, sem `DELETE`.
  - A carga roda no app com um cliente Prisma próprio, criado sob demanda (`criarPrisma(SYNC_DATABASE_URL)`), com *pool* pequeno. Ela usa `pg_try_advisory_xact_lock(hashtext('sync-plano'))` (ou `sync-cc`, `sync-cargos`): com uma carga em andamento, a segunda é recusada na hora, com aviso (RNF_PLA_REQ_007).
  - O *staging* do §5 é o arquivo validado em memória, por inteiro, antes do *merge* atômico numa transação. O lote fica registrado em `carga_estrutura`, com o *hash* do arquivo, as contagens e os avisos.
  - **Custo se errado:** uma variável a mais no serviço `app` do Easypanel.
- **R7. Salários cifrados por coluna (D10, com a premissa ajustada; confirmação na pendência P1).**
  - **Por que cifrar:** a D10 prevê "criptografia em repouso pelo armazenamento + mascaramento", com cifra por coluna **[PROVISÓRIA]**. Na VPS (D8), o disco do Postgres não é cifrado; só os backups são (P3, Tarefa 7). E a objeção da D10 (a cifra impede somar no banco) não se aplica aqui: o motor e o `TotalizerService` somam na aplicação.
  - **Algoritmo e campos:** AES-256-GCM (`node:crypto`) nos campos de remuneração do cargo: `salario_real`, `salario_definido` e `funcao_gratificada`. Os salários de mercado (mínimo e máximo), que são pesquisa externa sem dado individual, ficam em claro, assim como a tabela salarial.
  - **Envelope:** `v1:<idChave>:<iv>:<tag>:<cifra>` em base64url. O AAD é `cad.cargo:<id>:<campo>`, para que um valor cifrado não possa ser trocado de linha ou de campo.
  - **Chave:** a variável `CHAVE_CIFRA_SALARIOS` (32 bytes em base64), com `CHAVE_CIFRA_SALARIOS_ID`, existe só no serviço `app` do Easypanel; no dev, só no `.env.local` (gerada com `openssl rand -base64 32`); nos testes, uma chave fixa de teste. Nunca entra no repositório.
    - **Rotação:** `CHAVE_CIFRA_SALARIOS_ANTERIOR` permite decifrar o envelope antigo e regravar com a chave nova.
    - **Cópia de segurança:** o PO guarda uma cópia da chave fora da VPS, como a chave do `age` do backup. Sem ela, o backup restaura salários ilegíveis.
  - **Sem a chave**, só as funções de cargo falham, com `ErroDominio('cad.cifra_indisponivel')` e o log `[CIFRA_SALARIOS_AUSENTE]`; o resto do sistema segue normal.
  - **Mascaramento por perfil, no servidor:** o valor sem máscara só sai para quem tem `cad.cargos:alterar` (Analista GRH) ou `cad.parametros:alterar` (GFIN); para os demais, sai `null` com `mascarado: true`. Vale também para a exportação.
  - **No Histórico,** o campo de salário vai como o próprio envelope cifrado. O envelope só é regravado quando o valor muda, para o delta não acusar mudança falsa.
  - **Custo se errado:** tirar o adaptador de cifra e migrar as colunas para `NUMERIC(15,2)`.
- **R8. Versão dos modelos de e-mail.**
  - Cada modelo tem versões imutáveis em código (`ger/domain/modelos/<modelo>.v<n>.ts`), e `VERSAO_ATUAL` aponta a vigente.
  - O *payload* do *outbox* leva `{ modelo, versao, destinatario, dados }`; a nova tentativa renderiza a mesma versão.
  - **Imutabilidade:** um teste guarda o SHA-256 do texto-fonte de cada versão publicada. Alterar uma versão reprova o teste, o que força criar a `v<n+1>`. As versões antigas ficam no registro.
  - **Assunto (RN0006):** etiquetas legíveis, como `[SGO 2.0][Acesso] …`.
  - **Nome da instituição:** o texto não tem nome fixo. Ele vem de `instituicao.nome_exibicao`, vazio por padrão (§6.7), e entra só quando preenchido.
- **R9. Novas tentativas do e-mail: 3, como no EP083.** O EP083 (UC0.06 E1) fala em "até três tentativas posteriores"; o JSDoc do C4 falava em 5, o padrão da fila. Pela §2.2, vale o EP.
  - **Como:** o trabalhador consulta a própria tentativa (`fila.consultar`). Na falha da 4ª execução (1 + 3), ele trata como falha definitiva: grava o Histórico, apaga o job e retorna sem erro. As duas tentativas restantes do padrão da fila nunca são usadas.
  - **Erro SMTP permanente** (código 5xx, endereço rejeitado): falha definitiva na hora.
  - **Sem mudança em `src/shared/filas`;** o JSDoc do C4 é corrigido no PR da US-025.
- **R10. Parâmetros por exercício e do sistema.**
  - **Por exercício** (US-053): premissas e parâmetros financeiros por `ano` (2000–2099): reajuste, mês da data-base, IPCA, SMN, dias úteis do mês, semáforo, encargos e a tabela componente → conta. Ficam em tabelas tipadas, não em chave/valor.
    - O exercício em si (`OrcamentoExercicio`) é do `orc` (US-055, frente A); o `cad` só conhece o `ano`.
    - Os parâmetros de um ano **congelam** quando a frente A oficializa o exercício (`congelarPremissasExercicio`, C2). É assim que "nunca altera snapshot oficializado" (US-050, RN_CAR_05) vale também para a Adm. Central.
  - **Do sistema:** `instituicao.nome_exibicao` e `instituicao.logotipo` ficam em `parametro_sistema` (`cad`), vazios por padrão, sem tela na trilha. A tela é a Administração › Parâmetros, do `adm`, depois de 30/11 (frente A).
  - **E-mail:** o trabalhador recebe o nome por função injetada pelo `worker/index.ts` (`() => ''` até a Task 9), para o `ger` não importar o `cad`.
- **R11. Estrutura Funcional fora da trilha × RN_CAR_01.** A US-048 (Estrutura Funcional) não está na trilha (§3.3), mas a RN_CAR_01 impede salvar cargo sem vínculo funcional.
  - Na trilha, o `cargo` tem `vinculo_funcional_id` **opcional** (sem FK, reservado), e a RN_CAR_01 fica desligada até a US-048.
  - A RN_CAR_04 (Fonte Ativa obrigatória na oficialização do TP) é da F3.
  - Confirmação na pendência P2.
- **R12. Benefícios: Tabela Mestre por exercício** (US-050).
  - **Item:** `codigo` (`beneficio.<nome>`), forma (`VALOR_MENSAL`, `VALOR_DIARIO` × dias úteis, ou `PERCENTUAL_SALARIO`), valor ou percentual, conta analítica, `padraoPosicao`, `ativo` e `provisorio`.
  - **Posição sem cargo (C34):** o custo de uma posição da Adm. Central usa os itens ativos com `padraoPosicao` e valor preenchido. Item padrão sem valor gera aviso nas premissas, não erro.
  - **Cargo:** o benefício do cargo (RN_CAR_06/07) guarda o valor manual e a origem (`MESTRE`/`MANUAL`). A alteração de um item da Tabela Mestre sobrescreve o valor manual em todos os cargos, com Histórico por cargo (C8).
  - **Auxílio creche:** não é item da Tabela Mestre ("Entrada Manual", C&S V4 §6.4).
- **R13. Encargo: total pelo percentual somado, resto no INSS.**
  - O total do encargo é `base × soma dos percentuais`, com um único Half-Even.
  - Cada componente é calculado e arredondado em separado. A diferença de centavo entre a soma dos componentes e o total vai para o INSS (o maior componente), como o `distribuirEm12` faz com dezembro. Assim, a soma das contas analíticas fecha com o total.
  - **Fonte:** RN_CAR_17, REQ_CAR_013 e US-005.
- **R14. Componentes do custo e contas (spec §6.6 [PROVISÓRIA]).**
  - **Componentes:** `salario` (massa), `adicional` (periculosidade ou insalubridade), `ferias`, `decimo_terceiro`, `encargo.inss`, `encargo.fgts`, `encargo.pis`, `encargo.obrigacoes`, `encargo.riscos` e `beneficio.*`.
  - **Contas padrão:**

    | Componente | Conta |
    | --- | --- |
    | `salario` | 4.1.1.1.001 |
    | `adicional` | 4.1.1.1.025 |
    | `ferias` | 4.1.1.1.003 |
    | `decimo_terceiro` | 4.1.1.1.005 |
    | `encargo.inss` | 4.1.1.2.001 |
    | `encargo.fgts` | 4.1.1.2.005 |
    | `encargo.pis` | 4.1.1.2.008 |
    | `encargo.obrigacoes` | 4.1.1.8.003, provisória (GAP-CAR-005) |
    | `encargo.riscos` | 4.1.1.8.004, provisória (GAP-CAR-005) |

  - **Benefícios:** a conta vem do item da Tabela Mestre: saúde em 4.1.1.1.008, VR em 4.1.1.1.009, VA em 4.1.1.1.021, seguro de vida em 4.1.1.1.007 e odontológico em 4.1.1.1.013.
  - **Fórmula (C33):**
    - base do mês = salário reajustado (a partir do mês da data-base) + adicional;
    - férias + 1/3 = base × 4 ÷ 36;
    - 13º = base ÷ 12;
    - encargo sobre base + férias + 13º;
    - benefícios = quantidade × valor mensal;
    - tudo só nos meses entre o início e a saída.
  - **Arredondamento:** cada operação em `Dinheiro` arredonda Half-Even.
  - **Adicionais:** a periculosidade (30%) incide sobre o salário reajustado; a insalubridade (10/20/40%) incide sobre o SMN do exercício e não recebe o reajuste.
- **R15. Seed e dados de referência.**
  - **`seedCad` (todos os ambientes):** declara as funcionalidades do `cad` pelo C6 e cria os padrões provisórios: parâmetros do ano de 2027, Tabela Mestre de 2027 sem valores e `parametro_sistema` vazio.
  - **`seedDadosReferenciaCad` (só com `CARGA_DADOS_REFERENCIA=1`, em dev e hml):** carrega, **pelo mesmo carregador da importação**:
    - o plano de contas oficial;
    - a minuta de CC (`provisorio = true`);
    - cargos sintéticos (com salários fictícios cifrados).
  - **Origem dos dados:** arquivos JSON em `src/modules/cad/infrastructure/dados/`, transcritos das planilhas oficiais sem a sigla. Um teste localiza as planilhas de `especificacao/` por *glob* e prova que o JSON é igual a elas, exceto pela descrição saneada. O `especificacao/` não vai para a imagem.
  - **Prod:** a variável nunca é definida (checklist da US-115). O plano de contas entra pela tela de importação, pela GFIN. O CC entra só depois da DIREX (R16).
- **R16. CC em prod só com a DIREX (GAP-CC-001).**
  - Sem `CC_CARGA_PROVISORIA=1` (dev e hml têm; prod não tem), a carga de CC exige os campos "Aprovado pela DIREX em" (data) e "Documento de aprovação" (referência). Eles ficam no lote (`carga_estrutura`) e no Histórico, e a carga entra com `provisorio = false`.
  - Com a variável, a carga sem aprovação entra com `provisorio = true`.
  - **Padrão seguro:** variável ausente = exige aprovação.
- **R17. Regra R3 da minuta (CC de gestão).**
  - O CC analítico com sufixo `.0` no nível 3 ou `.10` no nível 4 recebe `de_gestao = true`.
  - A carga **avisa** (sem bloquear) toda diretoria sintética de nível 2 e toda gerência sintética de nível 3 que não tenha exatamente um filho de gestão. O nível 1 fica de fora (GAP-CC-005).
  - Na minuta, são 7 CCs de gestão e nenhum aviso.
  - `natureza` fica nula (GAP-CC-006).
- **R18. Tree Grid única** (US-021).
  - **Virtualização:** a `GradeArvore` passa a usar `@tanstack/react-virtual`, com linha de altura fixa e linhas espaçadoras. Ela continua sendo `<table role="treegrid">`, com `aria-rowcount`/`aria-rowindex` e navegação por teclado (↑ ↓ → ←).
  - **Filtros:** declarativos (texto em várias colunas, seleção, ocultar zerados RF0006), aplicados no cliente sobre a árvore. Um nó aparece se ele ou algum descendente casa, e os ancestrais abrem durante o filtro.
  - **Retenção na sessão:** os filtros ficam no `sessionStorage` (chave `sgo.grade.<idGrade>.filtros`), nunca no `localStorage` (RNF0002, RNF0005). O logoff já limpa o `sessionStorage` (US-032).
  - **Login trocado na mesma aba:** o estado leva o `escopoSessao`, um *hash* do `sessaoUid` que a página passa. Com escopo diferente, o estado salvo é descartado.
  - **TanStack Table:** não entra; a grade já tem o modelo de colunas do C3.
- **R19. Total na Fonte Ativa.** O C&S V4 define "Salário Total = Salário Mín ou Máx + Função Gratificada" sem dizer qual dos dois. O plano adota **Máximo + Função Gratificada [PROVISÓRIA]**, porque é a base mais conservadora para orçar. Confirmação na pendência P4.
- **R20. Cargos do Rubi por arquivo (GAP-INT-005).** Sem integração com o Rubi na trilha, os campos de origem Rubi do cargo chegam por **importação .xlsx**, layout `CAD-CARGOS v1.0`, executada como `sgo_sync` e cifrando o salário real. A recarga casa pelo Código do Cargo.
  - **Colunas:** Código do Cargo, Cargo (nome oficial), Cargo Mercado, Tabela Salarial (código), Tabela Salarial (descrição), Faixa (código), Faixa (descrição), Nível (código), Nível (descrição) e Salário Real.
  - **O analista GRH edita só os campos manuais:** Fonte Ativa, função gratificada, salário definido, salários de mercado, adicional e benefícios.
  - **Conflito resolvido:** o "Cargo Mercado" é de origem Rubi (C&S V4 §4.1), não digitado (Minuta V5); vale o C&S V4, mais recente (§2.2).
  - Layout a confirmar com a GRH (pendência P3).
- **R21. Exportação real sem marca d'água.** O `exportarXlsx` do C3 passa a gerar o .xlsx com ExcelJS (`await import('exceljs')` dentro da função). Cabeçalho de filtros, marca d'água e registro de exportação são da US-024, fora da trilha.
  - Texto começando com `=`, `+`, `-` ou `@` é gravado como texto, nunca como fórmula.
  - Dinheiro vai como número com formato `#,##0.00`, convertido do texto decimal.

## Decisões pendentes do PO

| # | Decisão | Recomendação | Se não decidir até |
| --- | --- | --- | --- |
| P1 | Cifra por coluna dos salários do cargo (R7): ajusta a D10 (o disco da VPS não é cifrado) | **Aprovar** e registrar na spec v1.6 (D10). O PO guarda a cópia da chave fora da VPS | Task 12a: sem decisão, segue a R7, que é reversível |
| P2 | Cargo sem vínculo funcional na trilha (R11), porque a Estrutura Funcional (US-048) ficou fora | **Aprovar** o vínculo opcional até a US-048. A RN_CAR_01 volta a valer quando a US-048 entrar | Task 12a |
| P3 | Layout `CAD-CARGOS v1.0` da planilha de cargos do Rubi (R20) | **Aprovar** e pedir à GRH uma exportação do Rubi nesse formato | Task 12a: entra com dados sintéticos em dev/hml |
| P4 | "Salário Total" = Máximo + Função Gratificada (R19) | **Aprovar** como [PROVISÓRIA] e validar com a GRH | Task 12a |
| P5 | Quem vê salário sem máscara (R7) | **Analista GRH e GFIN.** Auditor, Orçamentista, Gestor de Diretoria e DIREX veem mascarado (minimização, LGPD) | Task 12b |
| P6 | Benefícios da posição padrão da Adm. Central (R12): quais itens e qual faixa do plano de saúde. Dias úteis do mês | **Seguro saúde Básico, Vale-refeição e Seguro de vida**, marcados pela GRH, e **22 dias úteis** [PROVISÓRIOS]. A GRH preenche os valores na Tabela Mestre de 2027 antes da US-121 | 13/11 (Task 10) |
| P7 | Provedor SMTP de prod e hml, remetente e domínio (GAP-INF-001) | Provedor transacional com STARTTLS na porta 587, SPF/DKIM/DMARC no domínio, remetente `nao-responda@<domínio>`, credenciais só no serviço `worker` do Easypanel | ~05/11 (marco do plano-mestre) |
| P8 | Registro da aprovação da DIREX na carga de CC em prod (R16) | **Data e referência do documento** digitadas pela GFIN na tela de importação, auditadas | ~16/11 (GAP-CC-001) |

## Review Focus

1. **Dinheiro virando `number`.** O ExcelJS devolve célula numérica como `number`.
   - Esperado: a conversão fica em `infrastructure/` e faz `Dinheiro.de(String(valor))`. Ela recusa mais de 2 casas e 15 dígitos significativos ou mais. Nenhum `parseFloat`/`Math.round`/`toFixed` em `domain/` (o lint já barra).
   - Teste: `célula 1234.56 vira "1234.56"` e `célula com 3 casas é recusada` (Task 4).
   - **Reduzido de CC lido como número:** "14.180" viraria 14,18. Esperado: reduzido de CC só como texto `^\d{2}\.\d{3}$`, e célula numérica dá erro na linha (Task 5).
2. **Estrutura alterada por fora da carga (ORIGEM BLINDADA).** Esperado:
   - o `sgo_app` não consegue `INSERT`/`UPDATE`/`DELETE` em `conta_contabil` e `centro_custo`, nem `UPDATE` nas colunas Rubi de `cargo`;
   - nenhum *schema* de entrada tem campo de estrutura.

   Teste `privilegios.int.test.ts` em cada tarefa com migration.
3. **Carga parcial ou concorrente.** Esperado:
   - erro em uma linha reprova o arquivo inteiro, com a lista de erros por linha, e nada é gravado;
   - duas cargas simultâneas: a segunda é recusada pelo *advisory lock*;
   - a recarga do mesmo arquivo não muda nenhuma tabela nem o Histórico;
   - conta ausente é inativada, nunca apagada.

   Testes `carga atômica`, `carga concorrente`, `recarga idempotente` e `conta ausente inativa` (Tasks 4 e 5).
4. **Planilha maliciosa.** Esperado: recusa de arquivo acima de 1 MB e de mais de 20.000 linhas antes de ler tudo; fórmula não é avaliada; texto com caractere de controle é recusado; a sigla é retirada da descrição, com aviso. Testes na Task 4.
5. **Salário em claro.** Esperado:
   - nenhum salário em claro no banco, no Histórico, em log, em mensagem de erro, nas *props* de componente cliente de quem não pode ver, ou na exportação;
   - a chave não está no repositório;
   - o envelope de outro cargo ou de outro campo não decifra (AAD).

   Testes `envelope trocado de linha falha`, `orçamentista recebe mascarado` e `Histórico sem salário em claro` (Task 12).
6. **Senha temporária vazando pelo e-mail.** Esperado:
   - os dados de `MODELOS_SENSIVEIS` não ficam no job depois do envio nem da falha definitiva;
   - o *outbox* publicado fica com `dados = {}`, como já acontece;
   - nada da senha aparece no Histórico ou nos logs;
   - o link do e-mail tem a mesma origem de `URL_PUBLICA`;
   - o destinatário vai estruturado, sem montar cabeçalho;
   - em produção, o SMTP exige `tls` ou `starttls`.

   Testes na Task 1.
7. **CC provisório em prod.** Esperado: sem `CC_CARGA_PROVISORIA=1`, a carga de CC sem data e documento da DIREX é recusada; com a variável, entra marcada como provisória. Teste na Task 8.
8. **Parâmetro de exercício oficializado mudando.** Esperado: depois de `congelarPremissasExercicio(ano)`, toda alteração de parâmetro, SMN ou Tabela Mestre daquele ano dá `cad.exercicio_congelado`. Testes nas Tasks 9 e 10.
9. **Motor com valor errado.** Esperado: os valores conferidos à mão da Task 11 batem ao centavo, inclusive o Half-Even (9.594,375 vira 9.594,38) e o resto do encargo no INSS.
10. **Bundle do navegador com código de servidor.** O `index.ts` do `ger` e o do `cad` são importados por páginas que passam *props* a componentes cliente.
    - Esperado: nenhum arquivo `'use client'` importa o `index.ts` do próprio módulo, só caminhos relativos.
    - Nodemailer, ExcelJS, Prisma e `node:crypto` são carregados só no servidor, com `await import()` quando o arquivo for alcançável pelo `index.ts` do `ger`.
    - Teste: `npm run build` sem erro de módulo de Node no cliente.

---

## Ordem e dependências

| # | PR | Depende de | Migration | Lentes extras (§12.12) | Previsão |
| --- | --- | --- | --- | --- | --- |
| 0 | compartilhado: dependências, `.env.example`, compose do worker | este plano | — | — | 27/10 |
| 1 | US-025 #47 (`Closes #47`): e-mail real pelo worker | 0 | — | security-review, silent-failure-hunter | 27/10 – 28/10 |
| 2 | Contrato C1 (`Refs #65 #68 #143`) | — | — | type-design-analyzer | 29/10 |
| 3 | Contrato C2 (`Refs #73 #75 #143`) | — | — | type-design-analyzer | 29/10 – 30/10 |
| 4 | US-043 parte 1 (`Refs #65`): plano de contas, carga e C1 real das contas | 0, 2 | `…_cad_plano_contas` | security-review, silent-failure-hunter | 30/10 – 03/11 |
| 4b | compartilhado: `prisma/seed.ts` registra `seedCad` e `seedDadosReferenciaCad` | 4 | — | — | 03/11 |
| 5 | US-046 parte 1 (`Refs #68`): CC, carga e C1 real dos CCs | 4 | `…_cad_centros_custo` | security-review, silent-failure-hunter | 04/11 |
| 6a | US-021 parte 1 (`Refs #43`): virtualização e teclado | 0 | — | — | 05/11 |
| 6b | US-021 parte 2 (`Refs #43`): `exportarXlsx` real | 0 | — | security-review | 06/11 |
| 6c | US-021 parte 3 (`Closes #43`): filtros retidos na sessão | 6a | — | — | 06/11 – 09/11 |
| 7a | US-043 parte 2 (`Closes #65`): tela de importação do plano | 4, 6c | — | security-review | 09/11 – 10/11 |
| 7b | US-044 #66 (`Closes #66`): consulta em árvore | 7a | — | — | 10/11 |
| 8 | US-046 parte 2 (`Closes #68`): telas de CC e trava da DIREX | 5, 7a | — | security-review | 11/11 |
| 9 | US-053 #75 (`Closes #75`): parâmetros por exercício; `garantir`/`congelar` do C2 | 3, 4 | `…_cad_parametros` | security-review | 11/11 – 12/11 |
| 10 | US-050 parte 1 (`Refs #72`): Tabela Mestre por exercício | 9 | `…_cad_beneficios` | — | 13/11 |
| 11 | US-051 parte 1 (`Refs #73`): motor real e `obterPremissasExercicio` (**C2 real**) | 3, 9, 10 | — | type-design-analyzer, silent-failure-hunter | 13/11 – 17/11 |
| 12a | US-049 parte 1 (`Refs #71`): schema, cifra, domínio e importação Rubi | 4, 6c | `…_cad_cargos` | security-review, type-design-analyzer | 18/11 |
| 12b | US-049 parte 2 (`Refs #71`): telas de cargo com máscara | 12a | — | security-review | 19/11 |
| 12c | US-049 parte 3 (`Closes #71`): tabela salarial e senioridades | 12a | — | — | 20/11 |
| 13 | US-050 parte 2 (`Closes #72`): benefícios do cargo e sobrescrita | 10, 12b | `…_cad_beneficio_cargo` | silent-failure-hunter | 23/11 |
| 14 | US-051 parte 2 (`Closes #73`): custo do cargo pelo motor (REQ_CAR_013) | 11, 13 | — | — | 24/11 |

**Por que esta ordem:**
1. **US-025 primeiro.** É pequena (4 h), não depende de GAP para ficar pronta em código, e a Task 6a do P5 (frente A) está bloqueada por ela. O SMTP de prod fica com o PO (P7).
2. **Contratos C1 e C2 logo em seguida** (spec §12.6: "passa na frente de qualquer outro na fila de merge"). A frente A detalha o P6 a partir de ~25/11 e precisa das interfaces bem antes.
3. **Carga e C1 real antes das telas.** As Tasks 4 e 5 não dependem da grade: são domínio, banco e seed. Assim, o C1 real fica pronto cedo para a US-121, e a minuta de CC entra em dev/hml antes do marco da DIREX (16/11).
4. **US-021 antes das telas de consulta grandes.** O backlog põe a US-043 dependendo da US-021. A divisão em partes respeita isso: a parte de tela da US-043 (7a) e a US-044 (7b) vêm depois da grade virtualizada e dos filtros.
5. **Parâmetros, Tabela Mestre e motor antes dos cargos.** O backlog põe a US-051 dependendo da US-049. Mas o caminho crítico da trilha é o C2 real para a US-121, que calcula posições com cargo em **texto livre** (C34), sem cadastro de cargo. Por isso, a parte do motor que serve à Adm. Central (Task 11) vem antes, e a parte que depende do cargo fica na Task 14. Com isso, o C2 real fica na `main` por volta de 17/11, antes do marco de 20/11 (P6 iniciado).

As datas supõem a frente B só no P4, a 40 h/semana, a partir de 27/10. As Tasks 6 a 8 do P3 (bloqueadas pelo GAP-INF-001) intercalam quando o PO destravar o GAP; nesse caso, as Tasks 12 a 14 (fora do caminho crítico) são as que deslizam.

**Interações com a frente A:**
- **Revisão de consumidor dos contratos** (§12.12): C1 e C2, Tasks 2 e 3, além da mudança de comportamento do C4 na Task 1 (validação do link, 3 tentativas).
- **Issue para a frente A** (aberta no Step 7 da Task 1, sem bloquear nada): o `publicarOutbox` mantém os dados da mensagem abandonada (`MAX_TENTATIVAS_OUTBOX`). Para `email.enviar`, isso só acontece com fila desconhecida ou chave inválida, o que não ocorre na prática.
- **Nota no PR da Task 11:** a cifra e a máscara do salário da posição de pessoal da Adm. Central (`orc`) ficam com a frente A (D10/R7).

## Estrutura de arquivos

```
prisma/schema/cad.prisma                                         (B, Task 4 cria; 5, 9, 10, 12a, 13 alteram)
prisma/migrations/<AAAAMMDDHHMM>_cad_{plano_contas,centros_custo,parametros,beneficios,cargos,beneficio_cargo}/
src/modules/ger/domain/{modelos-email,renderizar-email}.ts · domain/modelos/*.v1.ts       (Task 1)
src/modules/ger/infrastructure/{config-smtp,smtp,trabalhador-email,registrar-trabalhadores}.ts (Task 1)
src/modules/ger/ui/{grade-arvore.tsx,grade-logica.ts,grade-virtual.ts,grade-filtros.ts}    (Task 6)
src/modules/ger/infrastructure/exportar-xlsx.ts                                            (Task 6b)
src/modules/cad/index.ts · falsos.ts · contrato-c1.test.ts · contrato-c2.test.ts           (Tasks 2 e 3)
src/modules/cad/domain/{estrutura,plano-contas,centros-custo,parametros,beneficios,cargo,motor-custo-pessoal,semaforo}.ts
src/modules/cad/application/{estrutura-financeira,importar-plano,importar-cc,parametros,beneficios,cargos,tabela-salarial,premissas}.ts
src/modules/cad/application/acoes-*.ts                                                     ('use server')
src/modules/cad/infrastructure/{ler-xlsx,cliente-sync,cifra-salarios,seed,seed-referencia}.ts
src/modules/cad/infrastructure/dados/{plano-contas-oficial,cc-minuta-rev23102026,cargos-sinteticos}.json
src/modules/cad/ui/*.tsx
src/app/(sistema)/cad/{plano-contas,centros-custo,parametros,salario-minimo,beneficios,cargos,tabela-salarial}/**
worker/index.ts                                                                            (Tasks 1 e 9)
docs/operacao/ambientes.md                                                                 (Tasks 1, 4, 12a: variáveis por nome)
```

---

### Task 0: PR compartilhado do P4

**Files (só compartilhados; nenhum código de funcionalidade):**
- Modify: `package.json`, `package-lock.json`:
  - `exceljs`, `nodemailer` e `@tanstack/react-virtual` em `dependencies`;
  - `@types/nodemailer`, `smtp-server` e `@types/smtp-server` em `devDependencies`;
  - versões **exatas**, publicadas há mais de duas semanas (`npm view <pacote> time --json`), registradas no corpo do PR.
- Modify: `.env.example`:
  - **SMTP** (Task 1): `SMTP_HOST`, `SMTP_PORTA`, `SMTP_SEGURANCA` (`tls`|`starttls`|`nenhuma`), `SMTP_USUARIO`, `SMTP_SENHA` e `EMAIL_REMETENTE`. Comentário: em hml e prod, só no serviço `worker` do Easypanel (GAP-INF-001); no dev, o Mailpit.
  - **Carga como `sgo_sync`** (R6): `SYNC_DATABASE_URL="postgresql://sgo_sync:sgo_sync@127.0.0.1:55432/sgo_dev"`.
  - **Chave de salários** (R7): `CHAVE_CIFRA_SALARIOS=` e `CHAVE_CIFRA_SALARIOS_ID=dev1`, com o comentário "gere com `openssl rand -base64 32`; em hml e prod, só no serviço `app` do Easypanel".
  - **Dados de referência e CC provisório** (R15, R16): `CARGA_DADOS_REFERENCIA=1` e `CC_CARGA_PROVISORIA=1`, com o comentário "nunca em prod".
- Modify: `docker-compose.yml`. No serviço `worker`, acrescentar `SMTP_HOST: mailpit`, `SMTP_PORTA: "1025"`, `SMTP_SEGURANCA: nenhuma` e `EMAIL_REMETENTE: "SGO 2.0 (dev) <nao-responda@sgo.local>"`. A porta SMTP do Mailpit **não** é publicada: o worker de dev roda no perfil `app` do compose (o mesmo caminho da Task 6b do P5).
- Modify (só se o Step 4 falhar): `next.config.ts` com `serverExternalPackages: ['exceljs']`.
- Test: `tests/arquitetura/compose-dev.test.ts`.

- [ ] **Step 1: Teste que falha** em `compose-dev.test.ts`: o serviço `worker` tem `SMTP_HOST=mailpit` e o `mailpit` não publica a porta 1025 (nenhuma porta além de `127.0.0.1:${MAILPIT_PORT}:8025`).
- [ ] **Step 2:** `npx vitest run --project arquitetura tests/arquitetura/compose-dev.test.ts` → FAIL.
- [ ] **Step 3: Implementar** e rodar `npm install` com as versões exatas.
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm test && npm run test:arq && npm run build` → PASS (o `build` sozinho, D12).
- [ ] **Step 5: PR** "Compartilhado do P4: ExcelJS, Nodemailer, virtualização, variáveis de cadastros e SMTP do worker de dev", labels `compartilhado` e `frente:B`, `Refs #47`. Lentes: plano/spec, testes e segurança (versões fixas, nenhum segredo no `.env.example`). A frente A faz *rebase* logo depois do merge (§12.5).

### Task 1: Envio real de e-mail pelo worker (US-025, #47; fecha o C4)

**Files:**
- Create: `src/modules/ger/domain/renderizar-email.ts`, `src/modules/ger/domain/modelos/usuario-senha-inicial.v1.ts`, `src/modules/ger/domain/modelos/usuario-senha-redefinida.v1.ts`
- Create: `src/modules/ger/infrastructure/config-smtp.ts`, `src/modules/ger/infrastructure/smtp.ts`, `src/modules/ger/infrastructure/trabalhador-email.ts`, `src/modules/ger/infrastructure/registrar-trabalhadores.ts`
- Modify: `src/modules/ger/domain/modelos-email.ts` (versões e validação dos dados), `src/modules/ger/application/email.ts` (real), `src/modules/ger/falsos.ts` (mesma validação), `src/modules/ger/index.ts`, `worker/index.ts`, `docs/operacao/ambientes.md` (variáveis SMTP por nome, no `worker` de hml e prod)
- Test: `src/modules/ger/domain/renderizar-email.test.ts`, `src/modules/ger/domain/modelos-versoes.test.ts`, `src/modules/ger/infrastructure/config-smtp.test.ts`, `src/modules/ger/infrastructure/trabalhador-email.test.ts`, `src/modules/ger/infrastructure/email.int.test.ts`; Modify: `src/modules/ger/contrato-c4.test.ts` (o real deixa de lançar `email.indisponivel`)

**Interfaces:**
- Consumes:
  - de `@/shared/filas`: `registrarNoOutbox(tx, 'email.enviar', dados)`, `publicarOutbox(fila, cliente)`, `criarFila(url)` e `FilaGerenciada` (`registrarTrabalhador`, `consultar`, `apagarJob`);
  - `auditar(tx, evento)` de `@/shared/audit`, `lerEnvAcesso()` de `@/shared/config` (`urlPublica`), `criarPrisma` de `@/shared/db`;
  - `iniciarBancoTeste()` de `tests/integracao/banco.ts` (`urlApp`, `urlFila`).
- Produces (o `@/modules/ger` continua com o mesmo C4; acrescenta):

```ts
// domain/modelos-email.ts
export const VERSAO_ATUAL: { readonly [M in ModeloEmail]: number }; // R8
export type MensagemEmail = {
  [M in ModeloEmail]: { modelo: M; versao: number; destinatario: Destinatario; dados: DadosModeloEmail[M] };
}[ModeloEmail]; // payload do outbox e do job
export type EmailRenderizado = { assunto: string; texto: string; html: string };
// Valida tamanho, caracteres de controle e o urlAcesso (mesma origem de urlPublica, caminho interno).
// @throws ErroDominio('email.dados_invalidos')
export function validarDadosModelo(modelo: ModeloEmail, dados: unknown, urlPublica: string): void;

// domain/renderizar-email.ts (puro; escapa HTML; sem nome de instituição fixo)
// @throws ErroDominio('email.modelo_desconhecido') para modelo/versão fora do registro
export function renderizarEmail(m: MensagemEmail, contexto: { nomeExibicao: string }): EmailRenderizado;

// infrastructure/config-smtp.ts
export type ConfigSmtp = {
  host: string; porta: number; seguranca: 'tls' | 'starttls' | 'nenhuma';
  usuario?: string; senha?: string; remetente: { nome: string; email: string };
};
// null = SMTP não configurado. Inválida → Error que cita só os nomes das variáveis.
// Com NODE_ENV=production, 'nenhuma' é recusada.
export function lerConfigSmtp(fonte?: Readonly<Record<string, string | undefined>>): ConfigSmtp | null;

// infrastructure/smtp.ts
export class ErroEnvioEmail extends Error { readonly permanente: boolean } // 5xx = permanente
export interface TransporteEmail {
  enviar(m: { para: Destinatario; assunto: string; texto: string; html: string }): Promise<void>;
}
export function criarTransporteSmtp(cfg: ConfigSmtp): TransporteEmail; // nodemailer; connectionTimeout 10 s, socketTimeout 30 s

// infrastructure/trabalhador-email.ts
export const NOVAS_TENTATIVAS_EMAIL = 3; // R9, UC0.06 E1
export type DepsTrabalhadorEmail = {
  fila: FilaGerenciada; transporte: TransporteEmail; cliente: PrismaClient;
  obterNomeExibicao: () => Promise<string>; // R10: () => '' até a Task 9
};
export function criarTrabalhadorEmail(deps: DepsTrabalhadorEmail): (m: MensagemEmail, job: { id: string }) => Promise<void>;

// registrar-trabalhadores.ts, exportado pelo index.ts; carrega o resto com await import()
// (o index do ger também é importado por componentes cliente)
export function registrarTrabalhadoresGer(
  fila: FilaGerenciada,
  deps: { cliente: PrismaClient; obterNomeExibicao?: () => Promise<string> },
): Promise<{ email: boolean }>; // false = sem SMTP: log [EMAIL_SEM_SMTP], jobs ficam pendentes e visíveis
```

**Regras do trabalhador:**
- **Envio com sucesso:**
  1. renderiza a versão gravada;
  2. envia com o destinatário estruturado (`{ name, address }`);
  3. grava o Histórico `SISTEMA` (`funcionalidade 'ger.email'`, `origem 'SISTEMA'`), com modelo, versão, destinatário mascarado, tentativa e resultado, **sem** os dados;
  4. se o modelo for sensível, chama `fila.apagarJob`.
- **Falha temporária com `tentativas < NOVAS_TENTATIVAS_EMAIL`:** grava o Histórico "falha temporária (tentativa k)" e relança, para a fila tentar de novo com *backoff*.
- **Falha definitiva** (erro permanente ou tentativa ≥ 3): grava o Histórico "falha definitiva", apaga o job (sensível ou não, para não reenviar) e retorna sem erro. Fica o log `[EMAIL_FALHA_DEFINITIVA]` com o modelo e o destinatário mascarado. O caminho de recuperação é a redefinição de senha.
- **Entrega "pelo menos uma vez":** se o processo cair entre o aceite do SMTP e o fim do job, o e-mail pode sair duas vezes (risco aceito, Riscos).

- [ ] **Step 0: Preparar o banco de dev da frente B.** O volume 56432 ainda não tem o `sgo_fila` (memória §5). Recriar com `docker compose down -v` (**apaga** só o banco de dev local da frente B), `docker compose up -d --wait`, `npm run db:deploy` e `npm run db:seed` (**escrevem** no dev local), depois de conferir `MIGRATE_DATABASE_URL`/`SHADOW_DATABASE_URL` em `127.0.0.1:56432`.
- [ ] **Step 1: Testes de unidade (falham):**
  - **`renderizarEmail`:**
    - com `nomeExibicao` vazio, assunto `[SGO 2.0][Acesso] …` e corpo sem nome de instituição;
    - com `nomeExibicao = 'Instituto X'`, o nome aparece no cabeçalho;
    - `nome = '<script>'` sai escapado no HTML;
    - nenhuma saída contém a marca vedada (`encontrarMarcaVedada`);
    - versão `99` → `email.modelo_desconhecido`.
  - **`modelos-versoes.test.ts`:** o SHA-256 do texto-fonte de cada `(modelo, versão)` bate com a tabela do teste (R8); todo `ModeloEmail` tem `VERSAO_ATUAL` registrada.
  - **`validarDadosModelo`:**
    - `urlAcesso` de outra origem (`https://outro.site/login`), `javascript:` ou com `\n` → erro;
    - `URL_PUBLICA + '/login'` → ok.
  - **`lerConfigSmtp`:**
    - sem `SMTP_HOST` → `null`;
    - porta `abc` → erro citando `SMTP_PORTA`, sem o valor;
    - `NODE_ENV=production` com `nenhuma` → erro;
    - a mensagem de erro nunca contém o valor de `SMTP_SENHA`.
  - **`trabalhador-email.test.ts`** (transporte, fila e `auditar` falsos):
    - sucesso → 1 envio, 1 Histórico e `apagarJob` chamado (modelo sensível);
    - falha temporária com `consultar` → `tentativas: 1` → relança, sem `apagarJob`;
    - falha temporária com `tentativas: 3` → não relança, Histórico "falha definitiva" e `apagarJob`;
    - `ErroEnvioEmail` permanente na 1ª tentativa → definitiva;
    - um espião em `console.*` e o `depois` do Histórico não contêm a `senhaTemporaria`.
- [ ] **Step 2: Teste de integração `email.int.test.ts` (falha)** — `iniciarBancoTeste()`, `criarFila(urlFila)` e `smtp-server` em `127.0.0.1` sem TLS:
  - **commit:** `enviarEmail` dentro de `$transaction` → `publicarOutbox` → trabalhador registrado. A mensagem chega ao `smtp-server` com o assunto da versão 1. A linha do *outbox* fica com `dados = {}`, `fila.consultar` devolve `null` (job apagado) e o Histórico tem "enviado";
  - **rollback:** `enviarEmail` numa transação desfeita → nenhuma linha no *outbox* e nada chega ao SMTP;
  - **SMTP recusando com 550** → um só Histórico "falha definitiva" e o job apagado;
  - **SMTP fora do ar:** a 1ª execução relança, e o job continua com os dados para a nova tentativa;
  - **destinatário inválido** → `email.destinatario_invalido` antes de gravar.
- [ ] **Step 3:** `npx vitest run --project unidade src/modules/ger` e, sozinho (D12), `npx vitest run --project integracao src/modules/ger` → FAIL.
- [ ] **Step 4: Implementar.**
  - **`enviarEmail` real:** `validarDestinatario` → `validarDadosModelo(modelo, dados, lerEnvAcesso().urlPublica)` → `const { registrarNoOutbox } = await import('@/shared/filas')` → `registrarNoOutbox(tx, 'email.enviar', { modelo, versao: VERSAO_ATUAL[modelo], destinatario, dados })`. O `emailFalso` passa a chamar a mesma `validarDadosModelo`.
  - **`worker/index.ts`:** chama `registrarTrabalhadoresGer(fila, { cliente: prisma })` depois do `criarFila`; sem SMTP, emite `[EMAIL_SEM_SMTP]` uma vez.
  - **JSDoc do C4:** corrigir para 3 tentativas (R9).
  - **Bundle do worker:** conferir que o `worker/build.mjs` inclui o nodemailer (`node worker/build.mjs`).
- [ ] **Step 5:** suíte do Step 3 + `npm run lint && npm run typecheck && npm run test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 6: Prova no dev com o Mailpit** (com a frente A sem build/test:int rodando, D12):
  1. `docker compose --profile app up -d worker`;
  2. um script de teste em `tsx` (fora do repositório, no *scratchpad*) chama `enviarEmail` num `$transaction` com o `urlMigrator` do dev local (**escreve** no dev local);
  3. a mensagem aparece em `http://127.0.0.1:8225`, e o job some do `pgboss.job`;
  4. `docker compose --profile app stop worker`.

  Registrar no PR (captura do Mailpit sem a senha).
- [ ] **Step 7: PR** "[US-025] Envio de e-mail pelo worker com nova tentativa e modelos versionados", `Closes #47`, label `frente:B`.
  - **No corpo:** a mudança de comportamento do C4 (o link precisa ter a origem de `URL_PUBLICA`; 3 tentativas, R9) e o pedido de revisão de consumidor à frente A (P5, Task 6a).
  - **Issue para a frente A:** dados da mensagem abandonada no `publicarOutbox` (Interações).
  - **Pendência do PO:** P7 (SMTP de hml e prod).

  Lentes: plano/spec, testes, segurança, `security-review` e `silent-failure-hunter`.

### Task 2: Contrato C1 — estrutura financeira (`cad`)

**Files:**
- Create: `src/modules/cad/domain/estrutura.ts` (tipos), `src/modules/cad/application/estrutura-financeira.ts` (reais, ainda indisponíveis), `src/modules/cad/falsos.ts`
- Modify: `src/modules/cad/index.ts`
- Test: `src/modules/cad/contrato-c1.test.ts`

**Interfaces:**
- Consumes: `TxCliente` de `@/shared/db`; `NoArvore` de `@/shared/totalizer`; `ErroDominio` de `@/shared/kernel`.
- Produces (exportado por `@/modules/cad`, inclusive os falsos):

```ts
// C1 — Estrutura financeira (spec §6.1, §6.1a, D7). Chave natural: a classificação.
export type Nivel = 1 | 2 | 3 | 4 | 5;
export type TipoConta = 'SINTETICA' | 'ANALITICA';
export type NoConta = {
  classificacao: string;          // '4.1.1.1.001', única
  codigoReduzido: string | null;  // obrigatório e único nas analíticas; null nas sintéticas
  descricao: string;              // sem a marca vedada (GAP-CAD-005)
  nivel: Nivel;                   // analítica ⇔ nível 5
  tipo: TipoConta;
  ativa: boolean;
  filhos: readonly NoConta[];     // ordenados pela classificação (segmentos numéricos)
};
export type TipoCentroCusto = 'SINTETICO' | 'ANALITICO';
export type NaturezaCentroCusto = 'FINALISTICO' | 'APOIO' | 'ADMINISTRATIVO' | 'GESTAO';
export type NoCentroCusto = {
  classificacao: string;          // '4.3.2.11', única; não fixa dígitos por segmento (GAP-CC-002)
  codigoReduzido: string;         // '14.370', único
  descricao: string;              // a sugerida da minuta
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

// Para validar milhares de linhas sem uma consulta por linha (US-121).
export type IndiceEstruturaFinanceira = {
  contaAnaliticaAtiva(classificacao: string): boolean;
  centroCustoAnalitico(classificacao: string): boolean;
  // Escopo do Gestor de Diretoria (C25, R8 do P5): CCs analíticos ativos da subárvore, inclusive a raiz se analítica.
  // Raiz inexistente → [].
  centrosCustoAnaliticosSob(classificacaoRaiz: string): readonly string[];
  nosContas: readonly NoArvore[];        // id = classificação, para o totalizar(); só ativos
  nosCentrosCusto: readonly NoArvore[];  // SINTETICO → 'SINTETICA', ANALITICO → 'ANALITICA'
};
export function carregarIndiceEstrutura(tx: TxCliente): Promise<IndiceEstruturaFinanceira>;

// Falsos (só para testes dos consumidores). Padrão: trechos reais do plano oficial (4 → 4.1.1.1.001,
// 4.1.1.1.003, 4.1.1.1.005, 4.1.1.2.001 e 4.1.1.5.005) e da minuta (4 → 4.3 → 4.3.0, 4.3.2 → 4.3.2.10, 4.3.2.11; 4.4).
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
    - `ehContaAnaliticaAtiva(tx, '4.1.1.1.001')` → `true`; `'4.1.1.1'` (sintética) → `false`;
    - `ehCentroCustoAnalitico(tx, '4.3.2')` → `false`; `'4.4'` → `true`;
    - `centrosCustoAnaliticosSob('4.3')` → `['4.3.0', '4.3.2.10', '4.3.2.11']`;
    - `nosContas` passa no `totalizar(nos, new Map())` sem erro;
  - **os reais**, antes da Task 4 → `ErroDominio('cad.estrutura_indisponivel')`;
  - **tipos:** `// @ts-expect-error` num `NoConta` com `nivel: 6`, verificado pelo `npm run typecheck`;
  - **o `@/modules/cad`** exporta tudo acima.
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/cad` → FAIL.
- [ ] **Step 3: Implementar** os tipos, os falsos e os reais lançando `cad.estrutura_indisponivel`. O JSDoc registra as regras que as Tasks 4 e 5 cumprem: R3, R5, só ativos por padrão e descrição sem a sigla.
- [ ] **Step 4:** `npx vitest run --project unidade src/modules/cad && npm run lint && npm run typecheck` → PASS.
- [ ] **Step 5: PR de contrato** "[C1] Contrato da estrutura financeira (`cad`)", labels `frente:B` e `contrato`, `Refs #65 #68 #143`. A frente A revisa e registra no PR que o contrato atende a US-121 e o CC de escopo (R8 do P5). O PR entra na fila antes dos demais não compartilhados (§12.9). Lentes: plano/spec, testes, segurança e `type-design-analyzer`.

### Task 3: Contrato C2 — custo de pessoal (`cad`)

**Files:**
- Create: `src/modules/cad/domain/custo-pessoal.ts` (tipos), `src/modules/cad/application/premissas.ts` (reais, ainda indisponíveis)
- Modify: `src/modules/cad/index.ts`, `src/modules/cad/falsos.ts`
- Test: `src/modules/cad/contrato-c2.test.ts`

**Interfaces:**
- Consumes: `Dinheiro`, `Percentual`, `Resultado`, `ErroDominio` de `@/shared/kernel`; `TxCliente` de `@/shared/db`; `ContextoAuditoria` de `@/shared/audit`.
- Produces (exportado por `@/modules/cad`):

```ts
// C2 — Custo de pessoal (spec §6.4, §6.6, C33). Mês 1 = janeiro; séries sempre com 12 posições.
export type AdicionalTrabalhista =
  | { tipo: 'PERICULOSIDADE' }                                        // 30% sobre o salário (RN_CAR_10)
  | { tipo: 'INSALUBRIDADE'; grau: 'MINIMO' | 'MEDIO' | 'MAXIMO' };  // 10/20/40% sobre o SMN (RN_CAR_11)
export type PosicaoPessoal = {
  quantidade: number;        // inteiro ≥ 1 (contagem, não dinheiro)
  salarioMensal: Dinheiro;   // > 0; Fonte Ativa do cargo ou o salário digitado na planilha (C34)
  mesInicio: number;         // 1..12
  mesSaida: number;          // mesInicio..12
  adicional?: AdicionalTrabalhista; // só cargo; a planilha-modelo não usa
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
  | { componente: `beneficio.${string}`; nome: string; forma: 'PERCENTUAL_SALARIO'; percentual: Percentual; conta: string };
export type PremissasExercicio = {
  ano: number;
  versao: number;            // muda a cada alteração; quem grava snapshot guarda junto
  congelado: boolean;        // exercício oficializado (R10)
  provisorio: boolean;       // algum valor padrão não confirmado (GAP-ORC-003, GAP-CAR-005)
  reajuste: Percentual;      // pontos: 5 = 5%
  mesDataBase: number;       // 1..12
  ipca: Percentual;
  salarioMinimo: Dinheiro | null; // RN_CAR_13
  encargos: readonly { componente: ComponenteEncargo; nome: string; percentual: Percentual; conta: string }[];
  contas: Readonly<Record<Exclude<ComponenteFixo, ComponenteEncargo>, string>>; // R14
  beneficios: readonly BeneficioPremissa[]; // posição padrão com valor (R12); VALOR_DIARIO já convertido
  avisos: readonly string[];  // ex.: 'Benefício Vale-refeição sem valor em 2027'
};
export type LinhaComponente = { componente: CodigoComponente; conta: string; meses: readonly Dinheiro[]; total: Dinheiro };
export type SerieMensalComponentes = {
  ano: number;
  versaoPremissas: number;
  linhas: readonly LinhaComponente[]; // só componentes com algum mês ≠ 0
  totalMes: readonly Dinheiro[];      // 12
  total: Dinheiro;
};

// Função pura. Erros como Resultado (campo 'quantidade', 'salarioMensal', 'mesInicio', 'mesSaida', 'adicional').
export function calcularCustoPosicao(posicao: PosicaoPessoal, premissas: PremissasExercicio): Resultado<SerieMensalComponentes>;
export function obterPremissasExercicio(tx: TxCliente, ano: number): Promise<PremissasExercicio | null>;
// US-055: cria os parâmetros do ano copiando o último ano anterior (ou os padrões provisórios). Idempotente, auditado.
export function garantirPremissasExercicio(tx: TxCliente, contexto: ContextoAuditoria, ano: number): Promise<PremissasExercicio>;
// Oficialização do exercício (P6): congela o ano. Idempotente, auditado.
export function congelarPremissasExercicio(tx: TxCliente, contexto: ContextoAuditoria, ano: number): Promise<void>;

// Falsos
export function premissasExemplo(ano?: number): PremissasExercicio; // padrões provisórios (R14), benefícios VR 800, saúde 600, vida 50
export function custoPessoalFalso(premissas?: readonly PremissasExercicio[]): {
  calcularCustoPosicao: typeof calcularCustoPosicao; // regra simplificada: tudo em 'salario' (qtd × salário nos meses ativos)
  obterPremissasExercicio: typeof obterPremissasExercicio;
  garantirPremissasExercicio: typeof garantirPremissasExercicio;
  congelarPremissasExercicio: typeof congelarPremissasExercicio;
  chamadas: { posicao: PosicaoPessoal; premissas: PremissasExercicio }[];
  congelados: ReadonlySet<number>;
};
```

O falso **não** reproduz a fórmula. Os testes da frente A verificam as chamadas e a gravação da série devolvida, nunca os valores. Os valores oficiais são provados na Task 11.

- [ ] **Step 1: Teste do contrato (falha):**
  - **o falso:**
    - registra as chamadas;
    - `calcularCustoPosicao` com `mesInicio 3`, `mesSaida 10` → só os meses 3 a 10 ≠ 0;
    - `quantidade 0` → `{ ok: false, erros: [{ campo: 'quantidade', … }] }`;
    - `congelarPremissasExercicio(…, 2027)` põe 2027 em `congelados`;
  - **os reais**, antes das Tasks 9 e 11 → `ErroDominio('cad.custo_pessoal_indisponivel')`;
  - **`premissasExemplo(2027)`:** os encargos somam 51 pontos (38 + 8 + 1 + 3,8 + 0,2);
  - **tipos:** `// @ts-expect-error` em `componente: 'bonus'`, e `salarioMensal: 7500` (`number`) não compila.
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/cad` → FAIL.
- [ ] **Step 3: Implementar** os tipos e os falsos, com o JSDoc das regras R13 e R14.
- [ ] **Step 4:** `npx vitest run --project unidade src/modules/cad && npm run lint && npm run typecheck` → PASS.
- [ ] **Step 5: PR de contrato** "[C2] Contrato do custo de pessoal (`cad`)", labels `frente:B` e `contrato`, `Refs #73 #75 #143`. A frente A revisa e registra que atende a US-121 e a US-055 (`garantirPremissasExercicio`). Lentes: plano/spec, testes, segurança e `type-design-analyzer`.

### Task 4: Plano de contas — modelo, validação, carga e C1 real das contas (US-043 parte 1, `Refs #65`)

**Files:**
- Create: `prisma/schema/cad.prisma`, `prisma/migrations/<AAAAMMDDHHMM>_cad_plano_contas/migration.sql`
- Create: `src/modules/cad/domain/plano-contas.ts`, `src/modules/cad/domain/carga.ts` (planejamento do *merge*, puro)
- Create: `src/modules/cad/infrastructure/{ler-xlsx,cliente-sync,seed,seed-referencia}.ts` e `src/modules/cad/infrastructure/dados/plano-contas-oficial.json`
- Create: `src/modules/cad/application/importar-plano.ts`
- Modify: `src/modules/cad/application/estrutura-financeira.ts` (C1 real das contas), `src/modules/cad/index.ts`, `docs/operacao/ambientes.md` (`SYNC_DATABASE_URL` no serviço `app`)
- Test: `src/modules/cad/domain/plano-contas.test.ts`, `src/modules/cad/domain/carga.test.ts`, `src/modules/cad/infrastructure/ler-xlsx.test.ts`, `src/modules/cad/infrastructure/dados-oficiais.test.ts`, `src/modules/cad/application/importar-plano.int.test.ts`, `src/modules/cad/infrastructure/privilegios.int.test.ts`

**Modelos (`cad.prisma`):**
- **`ContaContabil` (`conta_contabil`):**
  - identificação: `id` uuid, `classificacao` único, `codigoReduzido?` único;
  - conteúdo: `descricao`, `nivel` smallint, `tipo` (enum `TipoConta`), `paiId?` (FK para a própria tabela, `ON DELETE RESTRICT`);
  - situação: `ativa`, `inativadaEm?`;
  - lote e controle: `cargaId`, `criadoEm`, `atualizadoEm`.
- **`CargaEstrutura` (`carga_estrutura`):**
  - identificação: `id`, `tipo` (`PLANO_CONTAS` | `CENTROS_CUSTO` | `CARGOS`), `arquivoNome`, `arquivoSha256`;
  - contagens: `linhas`, `incluidas`, `alteradas`, `inativadas`, `inalteradas`, `avisos` (jsonb);
  - provisório e aprovação: `provisoria`, `aprovacaoData?`, `aprovacaoDocumento?` (R16);
  - autoria: `usuarioId?`, `criadoEm`.

**Migration** (à mão, depois do `--create-only`):
- **`CHECK`:**
  - `nivel BETWEEN 1 AND 5`;
  - `nivel = array_length(string_to_array(classificacao, '.'), 1)`;
  - `(tipo = 'ANALITICA') = (nivel = 5)`;
  - `(tipo = 'ANALITICA') = (codigo_reduzido IS NOT NULL)`.
- **Constraint trigger** `DEFERRABLE INITIALLY DEFERRED`: o pai tem nível − 1; analítica não tem filho; sintética ativa tem filho ativo.
- **Privilégios (R6):**
  - `REVOKE INSERT, UPDATE, DELETE ON conta_contabil, carga_estrutura FROM sgo_app`;
  - `REVOKE DELETE ON conta_contabil, carga_estrutura FROM sgo_sync`.

**Interfaces — Produces (`@/modules/cad`):**

```ts
export type ErroLinha = { linha: number; coluna?: string; mensagem: string };
export type ResumoCarga = {
  cargaId: string; linhas: number; incluidas: number; alteradas: number; inativadas: number; inalteradas: number;
  avisos: readonly ErroLinha[]; // ex.: sigla retirada da 4.1.1.8.005
};
export type ArquivoCarga = { nome: string; conteudo: Uint8Array };
// exigir(ctx, 'cad.plano_contas', 'executar'). Erros por linha em ErroCampo { campo: 'linhas.<n>.<coluna>' }.
export function importarPlanoContas(ctx: ContextoRequisicao, arquivo: ArquivoCarga, deps?: DepsCarga): Promise<Resultado<ResumoCarga>>;
export type DepsCarga = { clienteSync: PrismaClient; agora: () => Date }; // padrão: cliente-sync.ts (SYNC_DATABASE_URL)
export const seedCad: Seed;                 // C6 e padrões (R15); nesta tarefa, só a funcionalidade cad.plano_contas
export const seedDadosReferenciaCad: Seed;  // só com CARGA_DADOS_REFERENCIA=1 (R15)
```

**Internas** (`domain/` e `infrastructure/`, não exportadas):
- `lerPlanilha(conteudo, { aba?, colunas, linhaCabecalhoMax, limiteLinhas: 20000, limiteBytes: 1_048_576 }): Promise<Resultado<LinhaBruta[]>>`;
- `validarPlanoContas(linhas): { ok: true; contas: ContaValidada[]; avisos } | { ok: false; erros: ErroLinha[] }`;
- `planejarCarga(atuais, novas, chave): { incluir; alterar; inativar; reativar; inalteradas }`.

**Funcionalidade (C6):** `cad.plano_contas`
- local: módulo `CADASTROS`, grupo "Plano de Contas", nome "Plano de Contas", rota `/cad/plano-contas`;
- ações: `consultar` e `executar` (importação), com `nivelLog` `SIMPLES`;
- `perfisPadrao`: GFIN `['consultar', 'executar']`; ORCAMENTISTA, ANALISTA_GRH, OPERADOR_VIAGENS, AUDITOR, GESTOR_DIRETORIA e DIREX `['consultar']`.

- [ ] **Step 1: Testes de domínio (falham):**
  - **`validarPlanoContas`**, com o JSON oficial → 174 contas, 12 sintéticas e 162 analíticas, sem erro;
  - **erros por linha:**
    - nível 6;
    - classificação com 4 segmentos e nível 5;
    - pai inexistente;
    - pai de nível errado;
    - analítica no nível 4;
    - analítica sem reduzido;
    - reduzido repetido (as duas linhas citadas);
    - classificação repetida;
    - sintética sem filho;
  - **sigla:** descrição com a sigla em qualquer caixa sai sem ela, com um aviso na linha;
  - **`planejarCarga`:**
    - mesma lista → tudo `inalteradas`;
    - analítica com o mesmo reduzido e nova descrição → `alterar`;
    - ausente → `inativar`;
    - inativa que volta → `reativar`;
    - sintética casa pela classificação (R5).
- [ ] **Step 2: Testes de leitura (falham)**, com planilhas montadas pelo ExcelJS no próprio teste:
  - colunas fora de ordem e com caixa e acento diferentes → lidas pelo nome;
  - coluna "Conta Reduzida" ausente → erro;
  - 20.001 linhas → erro antes de ler a 20.002ª;
  - 1 MB + 1 byte → erro sem abrir;
  - célula com fórmula → vale o resultado;
  - `1234.56` numérico → `"1234.56"`, e `1234.567` → erro (Review Focus 1);
  - texto com `\u0007` → erro.
- [ ] **Step 3: `dados-oficiais.test.ts` (falha):** acha `especificacao/Plano_de_Contas_5_Niveis_*.xlsx` por *glob* (falha se não achar, sem pular) e compara com `plano-contas-oficial.json` linha a linha. A única diferença aceita é a descrição saneada da 4.1.1.8.005.
- [ ] **Step 4: Testes de integração (falham)**, com `iniciarBancoTeste()`, URL do `sgo_sync` montada no teste e `ctx` de GFIN:
  - **carga inicial:** 174 contas, 1 `carga_estrutura` e 1 Histórico `INSERCAO` (`funcionalidade 'cad.plano_contas'`) com as contagens;
  - **`recarga idempotente`:** o mesmo arquivo → nenhuma linha de conta muda (`atualizado_em` igual), e só nasce o lote novo, com `inalteradas = 174`;
  - **`conta ausente inativa`:** arquivo sem uma analítica → ela fica `ativa = false`, e a sintética mãe continua ativa porque tem outros filhos;
  - **`carga atômica`:** um arquivo com um erro na última linha → nada gravado, e o `Resultado` lista a linha;
  - **`carga concorrente`:** duas importações em paralelo → uma passa e a outra recebe "Já existe uma carga do plano de contas em andamento. Tente de novo em instantes.";
  - **desempenho (RNF_DES_003):** 10.000 linhas sintéticas válidas em menos de 30 s. Rodar sozinho (D12) e registrar o tempo no PR;
  - **§10.2, item 1:** com o `auditar` falhando, nada é gravado;
  - **§10.2, item 3:** ORCAMENTISTA → `ErroPermissao`;
  - **C1 real:**
    - `listarArvoreContas` devolve a raiz `4` com 162 folhas;
    - `ehContaAnaliticaAtiva('4.1.1.1.001')` → `true`, e a inativada → `false`;
    - `carregarIndiceEstrutura().nosContas` passa no `totalizar`;
  - **`privilegios.int.test.ts`:** o `sgo_app` não consegue `INSERT`, `UPDATE` nem `DELETE` em `conta_contabil`; o `sgo_sync` não consegue `DELETE`;
  - **seed:**
    - `seedCad` duas vezes → *dump* das tabelas do `cad`, do catálogo e do Histórico idêntico;
    - `seedDadosReferenciaCad` sem a variável → não faz nada; com `CARGA_DADOS_REFERENCIA=1` → 174 contas.
- [ ] **Step 5:** `npx vitest run --project unidade src/modules/cad` e, sozinho, `npx vitest run --project integracao src/modules/cad` → FAIL.
- [ ] **Step 6: Implementar.**
  - **Migration:** `npm run db:migrate -- --name cad_plano_contas --create-only` (**escreve** no banco de dev local 56432; conferir as URLs antes). Renomear para o carimbo maior que o da última migration da `main` e acrescentar à mão os `CHECK`, o *trigger* e os privilégios.
  - **Carga:** o `importarPlanoContas` segue a ordem:
    1. `exigir`;
    2. leitura e validação em memória (fora da transação);
    3. na transação do `clienteSync`: `pg_try_advisory_xact_lock`, leitura das atuais, `planejarCarga`, `createMany` das novas, `UPDATE … FROM (VALUES …)` em lote das alteradas, inativação, `carga_estrutura` e `auditar`;
    4. um `SET CONSTRAINTS ALL IMMEDIATE` antes do commit, para o *trigger* falhar ainda dentro do caso de uso.
  - **C1:** o `listarArvoreContas` e o índice são montados com uma consulta só.
- [ ] **Step 7:** suíte do Step 5 + `npm run lint && npm run typecheck && npm run test:arq` → PASS. No dev local, `npm run db:deploy` (**escreve**) e `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code` → sem diferença.
- [ ] **Step 8: PR** "[US-043] Plano de contas: validação, carga idempotente e consulta do contrato C1 (parte 1/2)", `Refs #65`, labels `frente:B` e `migration`. Lentes: plano/spec, testes, segurança, `security-review` e `silent-failure-hunter`.

### Task 4b: PR compartilhado — seeds do `cad` no orquestrador

- [ ] **Files:** Modify `prisma/seed.ts`. Acrescentar `seedCad` e `seedDadosReferenciaCad` **depois** de `seedAdm`, porque os perfis precisam existir antes das permissões padrão (C6).
- [ ] **Teste:** `npm run db:seed` duas vezes no dev local da frente B (**escreve** no dev local) → a segunda não grava nada.
- [ ] **PR** "Compartilhado: seeds do cad no orquestrador", labels `compartilhado` e `frente:B`, `Refs #65`. Comentar na issue de "seed no deploy" (P5 Task 1) que hml precisa de `CARGA_DADOS_REFERENCIA=1` e `CC_CARGA_PROVISORIA=1` no serviço de migração, e que prod nunca tem as duas (R15, R16).

### Task 5: Centros de custo — modelo, validação, carga e C1 real dos CCs (US-046 parte 1, `Refs #68`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_centros_custo/migration.sql`
- Create: `src/modules/cad/domain/centros-custo.ts`, `src/modules/cad/application/importar-cc.ts`, `src/modules/cad/infrastructure/dados/cc-minuta-rev23102026.json`
- Modify: `src/modules/cad/application/estrutura-financeira.ts` (C1 real dos CCs), `src/modules/cad/infrastructure/{seed,seed-referencia}.ts`, `src/modules/cad/index.ts`
- Test: `src/modules/cad/domain/centros-custo.test.ts`, `src/modules/cad/application/importar-cc.int.test.ts`; Modify: `dados-oficiais.test.ts`, `privilegios.int.test.ts`

**Modelo `CentroCusto` (`centro_custo`):**
- identificação: `id`, `classificacao` único, `codigoReduzido` único, `paiId?`;
- conteúdo: `descricao`, `descricaoOriginal?`, `nivel`, `tipo` (enum `TipoCentroCusto`);
- atributos: `aceitaLancamento`, `deGestao`, `natureza?` (enum);
- situação e lote: `provisorio`, `ativo`, `inativadoEm?`, `cargaId`, `criadoEm`, `atualizadoEm`.

**Migration:**
- **`CHECK`:**
  - nível 1..5 e igual ao número de segmentos;
  - `aceita_lancamento = (tipo = 'ANALITICO')`;
  - `tipo = 'SINTETICO' OR nivel >= 2`;
  - `codigo_reduzido ~ '^\d{2}\.\d{3}$'`.
- **Constraint trigger** deferida: o pai tem nível − 1; analítico sem filho; sintético ativo com filho ativo.
- **Privilégios:** os mesmos `REVOKE` da Task 4 (R6).

**Interfaces — Produces:**

```ts
export type AprovacaoDirex = { data: string /* AAAA-MM-DD */; documento: string /* 3..120 caracteres */ };
// exigir(ctx, 'cad.centros_custo', 'executar'). Sem CC_CARGA_PROVISORIA=1, exige `aprovacao` (R16).
export function importarCentrosCusto(
  ctx: ContextoRequisicao, arquivo: ArquivoCarga, aprovacao: AprovacaoDirex | null, deps?: DepsCarga & { cargaProvisoriaPermitida?: boolean },
): Promise<Resultado<ResumoCarga>>; // avisos da regra R3 em ResumoCarga.avisos
```

**Funcionalidade (C6):** `cad.centros_custo`
- local: grupo "Plano de Contas", nome "Centros de Custo", rota `/cad/centros-custo`;
- ações: `consultar` e `executar`, com os mesmos perfis padrão de `cad.plano_contas`.

- [ ] **Step 1: Testes de domínio (falham):**
  - **com o JSON da minuta:** 35 CCs, 8 sintéticos e 27 analíticos, 7 `deGestao` e nenhum aviso da R3;
  - **erros por linha:** reduzido numérico (`14.18`) ou fora do formato; `Aceita lançamento = S` num sintético; analítico no nível 1; pai inexistente; sintético sem filho; reduzido repetido;
  - **avisos da R3** (sem bloquear): uma gerência sem o `.10`, ou com dois → aviso na linha da gerência;
  - **descrição:** vale a "sugerida", e a "original" fica em `descricaoOriginal`.
- [ ] **Step 2: Testes de integração (falham):**
  - **carga com aprovação** → `provisorio = false`, com `aprovacaoData` e `aprovacaoDocumento` no lote e no Histórico;
  - **carga sem aprovação:** `cargaProvisoriaPermitida: false` → erro em `aprovacao`, nada gravado; `true` → `provisorio = true` em todos os CCs do lote;
  - **R5 e D7:** recarga idempotente e CC ausente inativado;
  - **concorrência:** carga concorrente recusada (`sync-cc`);
  - **C1 real:**
    - `ehCentroCustoAnalitico('4.4')` → `true`, e `'4.3.2'` → `false`;
    - `centrosCustoAnaliticosSob('4.3')` → os 14 analíticos da DAF (4.3.0 e os 13 de nível 4 das três gerências);
    - `listarArvoreCentrosCusto` mostra `provisorio`;
  - **privilégios:** `sgo_app` sem escrita em `centro_custo`;
  - **seed:** com `CARGA_DADOS_REFERENCIA=1`, a minuta entra provisória.
- [ ] **Step 3:** `npx vitest run --project unidade src/modules/cad` e, sozinho, a integração → FAIL.
- [ ] **Step 4: Implementar** (a migration gerada como na Task 4; o leitor e o `planejarCarga` são reutilizados).
- [ ] **Step 5:** suíte + `npm run lint && npm run typecheck && npm run test:arq` → PASS; `db:deploy` e `migrate diff` no dev local, como na Task 4.
- [ ] **Step 6: PR** "[US-046] Centros de custo: validação, regra de gestão e carga provisória (parte 1/2)", `Refs #68`, labels `frente:B` e `migration`. Lentes: plano/spec, testes, segurança, `security-review` e `silent-failure-hunter`.

### Task 6a: Tree Grid virtualizada e com teclado (US-021 parte 1, `Refs #43`)

**Files:**
- Create: `src/modules/ger/ui/grade-virtual.ts` (cálculo puro da janela)
- Modify: `src/modules/ger/ui/grade-arvore.tsx`, `src/modules/ger/ui/grade-logica.ts`
- Test: `src/modules/ger/ui/grade-virtual.test.ts`, `src/modules/ger/grade-unica.test.ts`; Modify: `src/modules/ger/contrato-c3.test.ts`

**Interfaces:**
- Consumes: `useVirtualizer` de `@tanstack/react-virtual`; as *props* atuais do C3.
- Produces (*props* novas, todas opcionais; nenhuma quebra o C3):

```ts
export type PropsGradeArvore<C extends string = string> = {
  // … props atuais do C3 …
  alturaLinha?: number;   // px, padrão 32
  alturaVisivel?: number; // px da área com rolagem, padrão 600 (RNF0004: o container ajusta à largura)
};
// grade-virtual.ts (puro)
export function janelaVisivel(p: { total: number; topo: number; alturaLinha: number; alturaVisivel: number; folga: number }):
  { inicio: number; fim: number; espacoAntes: number; espacoDepois: number };
```

- [ ] **Step 1: Testes (falham):**
  - **`janelaVisivel`:** `{ total: 5000, topo: 0, alturaLinha: 32, alturaVisivel: 600, folga: 10 }` → `inicio 0` e `fim ≤ 29`; `topo` no fim → `fim = 4999`; `espacoAntes + linhas × 32 + espacoDepois = 5000 × 32`;
  - **SSR:** `renderToString(createElement(GradeArvore, props))` com 5.000 nós expandidos → no máximo 40 `<tr>` no corpo, `aria-rowcount="5001"` e `aria-rowindex` corretos. As *props* passam por `JSON.parse(JSON.stringify(props))`, como no C3;
  - **teclado** (lógica pura em `grade-logica.ts`): ↓ do último fica no último; → num nó fechado abre; ← num nó aberto fecha, e num filho volta ao pai;
  - **`grade-unica.test.ts`:** em `src/`, só `ger/ui/grade-arvore.tsx` contém `role="treegrid"` ("componente único", critério da US-021).
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/ger` → FAIL.
- [ ] **Step 3: Implementar** com `useVirtualizer({ count, estimateSize: () => alturaLinha, initialRect: { height: alturaVisivel, width: 0 } })`, linhas espaçadoras e `tabIndex` rolante na linha focada. A expansão continua no `sessionStorage` (C3).
- [ ] **Step 4:** suíte + `npm run lint && npm run typecheck` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: Medida manual** (D12, sozinho):
  1. no dev da frente B, uma rota temporária **não versionada** (`git stash push -u -m p4-grade-medida`, removida depois) renderiza 5.000 nós;
  2. o Chrome DevTools (Performance) mede a rolagem: ≥ 55 FPS e nenhuma tarefa longa acima de 50 ms;
  3. anexar o resultado no PR.
- [ ] **Step 6: PR** "[US-021] Tree Grid virtualizada com navegação por teclado (parte 1/3)", `Refs #43`, label `frente:B`. A frente A é avisada no PR, porque as telas do P5 usam a grade. Lentes: plano/spec, testes e segurança.

### Task 6b: Exportação XLSX real (US-021 parte 2, `Refs #43`; implementação do C3)

**Files:**
- Modify: `src/modules/ger/infrastructure/exportar-xlsx.ts`
- Test: Modify `src/modules/ger/contrato-c3.test.ts`; Create `src/modules/ger/infrastructure/exportar-xlsx.test.ts`

**Interfaces:** sem mudança de assinatura (`exportarXlsx(planilhas): Promise<Resultado<Uint8Array>>`). Valem as regras da R21.

- [ ] **Step 1: Testes (falham)** — exportar e ler de volta com ExcelJS:
  - 2 abas com os nomes certos;
  - o `"1234.50"` de dinheiro vira célula numérica `1234.5` com `numFmt '#,##0.00'`, e `"0.10"` não vira `0.1000000001`;
  - `"=HYPERLINK(…)"` é gravado como texto (`cell.type` ≠ fórmula);
  - competência `"Jan/27"` é gravada como texto;
  - as validações do C3 continuam (limite de 5.000, nome de aba).
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/ger` → FAIL.
- [ ] **Step 3: Implementar** com `const ExcelJS = (await import('exceljs')).default` dentro da função.
- [ ] **Step 4:** suíte + lint + typecheck e, sozinho, `npm run build` → PASS (o ExcelJS fora do *bundle* do cliente: conferir o relatório do build).
- [ ] **Step 5: PR** "[US-021] Exportação XLSX real do contrato C3 (parte 2/3)", `Refs #43`, label `frente:B`. Lentes: plano/spec, testes, segurança e `security-review` (injeção de fórmula).

### Task 6c: Filtros retidos na sessão (US-021 parte 3, `Closes #43`)

**Files:**
- Create: `src/modules/ger/ui/grade-filtros.ts` (puro)
- Modify: `src/modules/ger/ui/grade-arvore.tsx`, `src/modules/ger/index.ts`
- Test: `src/modules/ger/ui/grade-filtros.test.ts`; Modify: `contrato-c3.test.ts`

**Interfaces — Produces (`@/modules/ger`):**

```ts
export type DefinicaoFiltro<C extends string = string> =
  | { tipo: 'texto'; id: string; rotulo: string; campos: readonly C[] }   // contém; sem diferenciar maiúsculas e acentos
  | { tipo: 'selecao'; id: string; rotulo: string; campo: C; opcoes: readonly { valor: string; rotulo: string }[] }
  | { tipo: 'ocultarZerados'; id: string; rotulo: string; campos: readonly C[] }; // RF0006: todos os campos = 0
export type ValoresFiltro = Readonly<Record<string, string | boolean>>;
export type PropsGradeArvore<C extends string = string> = {
  // … anteriores …
  filtros?: readonly DefinicaoFiltro<C>[];
  escopoSessao?: string; // hash do sessaoUid, calculado no servidor (R18); sem ele, o estado não é retido
};
// grade-filtros.ts (puro)
export function aplicarFiltros<C extends string>(nos: readonly NoGrade<C>[], defs: readonly DefinicaoFiltro<C>[], valores: ValoresFiltro):
  { nos: readonly NoGrade<C>[]; abrir: ReadonlySet<string> };
// RF0003: texto até 100 caracteres, sem caractere de controle; opção fora da lista é recusada
export function validarValoresFiltro(defs: readonly DefinicaoFiltro[], valores: unknown): Resultado<ValoresFiltro>;
export function lerFiltrosSalvos(texto: string | null, escopo: string | undefined): ValoresFiltro | undefined;
```

- [ ] **Step 1: Testes (falham):**
  - **`aplicarFiltros`:**
    - texto `"salario"` acha "Salários" (acento) e mantém os ancestrais `4`, `4.1`, `4.1.1` e `4.1.1.1`, com eles em `abrir`;
    - busca pelo reduzido `"900"` acha a 4.1.1.1.001;
    - `ocultarZerados` remove os nós com todos os campos `"0.00"`;
    - sem filtro, a árvore fica igual (mesma referência);
  - **`validarValoresFiltro`:** 101 caracteres ou `\u0000` → erro; opção inexistente → erro;
  - **`lerFiltrosSalvos`:** escopo diferente → `undefined` (outro login na mesma aba); JSON corrompido → `undefined`;
  - **componente (SSR):** com `filtros`, renderiza a barra com "Limpar filtros"; sem `escopoSessao`, nada é lido do armazenamento;
  - **varredura:** nenhum arquivo de `src/` usa `localStorage` (RNF0002).
- [ ] **Step 2:** `npx vitest run --project unidade src/modules/ger` → FAIL.
- [ ] **Step 3: Implementar.**
  - O estado fica em `sessionStorage['sgo.grade.<idGrade>.filtros'] = { escopo, valores }`.
  - "Limpar filtros" apaga a chave (limpeza manual, RNF0005).
  - Filtro inválido mostra a mensagem ao lado do campo e mantém o resultado anterior (UC0.01 A3).
- [ ] **Step 4:** suíte + lint + typecheck e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-021] Filtros da Tree Grid retidos na sessão (parte 3/3)", `Closes #43`, label `frente:B`. No corpo, os três critérios com o link da prova: medida da 6a, teste de retenção e teste de componente único. Lentes: plano/spec, testes e segurança.

### Task 7a: Tela de importação do plano de contas (US-043 parte 2, `Closes #65`)

**Files:**
- Create: `src/modules/cad/application/acoes-plano.ts` (`'use server'`), `src/modules/cad/ui/importar-estrutura.tsx`, `src/app/(sistema)/cad/plano-contas/importar/page.tsx`
- Modify: `src/modules/cad/index.ts`, `src/modules/cad/infrastructure/seed.ts` (ajuda da funcionalidade)
- Test: `src/modules/cad/application/acoes-plano.int.test.ts`, `src/modules/cad/ui/importar-estrutura.test.ts`

**Interfaces — Produces:**

```ts
// definirAcao({ funcionalidade: 'cad.plano_contas', acao: 'executar', entrada: esquemaArquivoCarga }, …)
// A entrada vem do FormData: z.preprocess pega o File, confere .xlsx e ≤ 1 MB, e converte para ArquivoCarga.
export const acaoImportarPlanoContas: (entrada: unknown) => Promise<RespostaAcao<ResumoCarga>>;
```

- [ ] **Step 1: Testes (falham):**
  - **ação:**
    - GFIN com o arquivo oficial → `ok` e o resumo;
    - ORCAMENTISTA → 403 auditado (§10.2, item 3);
    - `.csv` ou 2 MB → erro em `arquivo`, sem ler;
    - arquivo com erro → a lista `linhas.<n>.<coluna>`, e nada gravado;
  - **componente:**
    - mostra a lista de erros por linha (até 200, com o total);
    - os avisos ficam separados dos erros;
    - o botão Importar fica desabilitado durante o envio;
    - a mensagem final é "Plano de contas importado: X incluídas, Y alteradas, Z inativadas, W sem alteração.";
  - **página:** começa com `exigirPagina('cad.plano_contas', 'executar')`.
- [ ] **Step 2:** testes da tarefa → FAIL.
- [ ] **Step 3: Implementar** com o `Formulario` do C3 (`acao` = a Server Action) e a lista de erros num `GradeArvore` plana.
- [ ] **Step 4:** suíte + `npm run lint && npm run typecheck && npm run test:arq` e, sozinho, `npm run build` → PASS. No dev, importar a planilha oficial pela tela e conferir o Histórico.
- [ ] **Step 5: PR** "[US-043] Tela de importação do plano de contas (parte 2/2)", `Closes #65`, label `frente:B`. Os 4 critérios provados: validação (Task 4), recarga idempotente (Task 4), 10.000 linhas em menos de 30 s (Task 4) e sigla retirada (Task 4). Lentes: plano/spec, testes, segurança e `security-review`.

### Task 7b: Consulta do plano de contas em árvore (US-044, `Closes #66`)

**Files:**
- Create: `src/modules/cad/application/consultar-estrutura.ts`, `src/modules/cad/ui/arvore-contas.tsx`, `src/app/(sistema)/cad/plano-contas/page.tsx`
- Test: `src/modules/cad/application/consultar-estrutura.int.test.ts`, `src/modules/cad/ui/arvore-contas.test.ts`

**Interfaces — Produces:**

```ts
// exigir(ctx, 'cad.plano_contas', 'consultar'); devolve NoGrade<'classificacao'|'reduzido'|'descricao'|'tipo'|'situacao'>[]
// já serializável (strings), para a GradeArvore.
export function consultarArvoreContas(ctx: ContextoRequisicao, deps?): Promise<readonly NoGrade[]>;
```

- [ ] **Step 1: Testes (falham):**
  - **dados:** a árvore tem 174 nós; a inativa aparece com a situação "Inativa", e só se o filtro "Mostrar inativas" estiver marcado;
  - **tela:**
    - sem botões Novo, Alterar ou Excluir (C27, RN_PLA_001), e o teste busca esses rótulos no HTML;
    - o botão "Importar arquivo" só aparece com `cad.plano_contas:executar`;
    - o filtro de texto cobre classificação, reduzido e descrição.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.** A página calcula `escopoSessao = sha256(ctx.sessaoUid)` em base64url, com 16 caracteres.
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-044] Consulta do plano de contas em árvore, só leitura", `Closes #66`, label `frente:B`. Lentes: plano/spec, testes e segurança.

### Task 8: Telas de centros de custo e trava da DIREX (US-046 parte 2, `Closes #68`)

**Files:**
- Create: `src/modules/cad/application/acoes-cc.ts`, `src/modules/cad/ui/{arvore-cc,importar-cc}.tsx`, `src/app/(sistema)/cad/centros-custo/{page,importar/page}.tsx`
- Test: `src/modules/cad/application/acoes-cc.int.test.ts`, `src/modules/cad/ui/arvore-cc.test.ts`

**Interfaces — Produces:** `acaoImportarCentrosCusto` (`cad.centros_custo:executar`; o `FormData` traz o arquivo, `aprovacaoData` e `aprovacaoDocumento`) e `consultarArvoreCentrosCusto(ctx)`, como na Task 7b.

- [ ] **Step 1: Testes (falham):**
  - **trava da DIREX (Review Focus 7):** sem `CC_CARGA_PROVISORIA` e sem os campos de aprovação → erro "Informe a data e o documento de aprovação da DIREX. A carga de centros de custo em produção só acontece depois dessa aprovação (GAP-CC-001).";
  - **com `CC_CARGA_PROVISORIA=1`:** o formulário mostra "Carga provisória (minuta)", e a árvore mostra o selo "Provisório";
  - **na árvore:**
    - o reduzido aparece ao lado da classificação (§6.1a: "o CC é sempre mostrado com o reduzido");
    - o CC de gestão tem um selo;
    - sem Novo, Alterar ou Excluir;
  - **avisos da R3:** aparecem no resumo da carga.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS. No dev, importar a minuta pela tela.
- [ ] **Step 5: PR** "[US-046] Telas de centros de custo com a trava de aprovação da DIREX (parte 2/2)", `Closes #68`, label `frente:B`. Pendência no corpo: a carga em prod depende do GAP-CC-001 (US-115, P7). Lentes: plano/spec, testes, segurança e `security-review`.

### Task 9: Parâmetros por exercício (US-053, `Closes #75`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_parametros/migration.sql`
- Create: `src/modules/cad/domain/{parametros,semaforo}.ts`, `src/modules/cad/application/{parametros,acoes-parametros}.ts`, `src/modules/cad/ui/form-parametros.tsx`, `src/app/(sistema)/cad/{parametros,salario-minimo}/page.tsx`
- Modify: `src/modules/cad/application/premissas.ts` (`garantir`/`congelar` reais), `src/modules/cad/infrastructure/seed.ts`, `src/modules/cad/index.ts`, `worker/index.ts` (`obterNomeExibicao` real, R10)
- Test: `src/modules/cad/domain/{parametros,semaforo}.test.ts`, `src/modules/cad/application/parametros.int.test.ts`

**Modelos:**
- **`ParametrosExercicio` (`parametros_exercicio`, pk `ano`):**
  - premissas: `reajuste` NUMERIC(9,4), `mesDataBase`, `ipca` NUMERIC(9,4), `salarioMinimo?` NUMERIC(15,2), `diasUteisMes` (22);
  - semáforo: `semaforoVerdeAte`, `semaforoAmareloAte` e `semaforoLaranjaAte` (70, 85 e 95);
  - situação: `provisorio`, `congeladoEm?`;
  - controle: `versao`, `atualizadoEm`.
- **`EncargoExercicio`:** (`ano`, `componente`) pk; `nome`, `percentual` NUMERIC(9,4), `conta`, `provisorio`.
- **`ContaComponenteExercicio`:** (`ano`, `componente`) pk; `conta`, `provisorio`.
- **`ParametroSistema`:** `chave` pk (`instituicao.nome_exibicao`, `instituicao.logotipo`), `valor` (padrão `''`).
- **Migration:**
  - `CHECK`: `ano BETWEEN 2000 AND 2099`, `mes_data_base BETWEEN 1 AND 12` e `semaforo_verde_ate < semaforo_amarelo_ate < semaforo_laranja_ate <= 100`;
  - `REVOKE DELETE … FROM sgo_app`;
  - `REVOKE ALL … FROM sgo_sync`.

**Interfaces — Produces (`@/modules/cad`):**

```ts
export type FaixaSemaforo = 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO';
// RN_PLA_006 / C7: ≤ verde → VERDE; ≤ amarelo → AMARELO; ≤ laranja → LARANJA; acima → VERMELHO. Sem orçamento (null) → null.
export function classificarSemaforo(uso: Percentual | null, faixas: { verdeAte: Percentual; amareloAte: Percentual; laranjaAte: Percentual }): FaixaSemaforo | null;
export type ParametrosExercicio = Omit<PremissasExercicio, 'beneficios' | 'avisos'> & {
  diasUteisMes: number;
  semaforo: { verdeAte: Percentual; amareloAte: Percentual; laranjaAte: Percentual };
};
export function obterParametrosExercicio(ctx: ContextoRequisicao, ano: number, deps?): Promise<ParametrosExercicio | null>; // cad.parametros:consultar
export function alterarParametrosExercicio(ctx: ContextoRequisicao, ano: number, versao: number, dados: EntradaParametros, deps?): Promise<Resultado<void>>; // cad.parametros:alterar
export function alterarSalarioMinimo(ctx: ContextoRequisicao, ano: number, versao: number, valor: string, deps?): Promise<Resultado<void>>; // cad.salario_minimo:alterar
export function obterParametroSistema(tx: TxCliente, chave: 'instituicao.nome_exibicao' | 'instituicao.logotipo'): Promise<string>;
// garantirPremissasExercicio e congelarPremissasExercicio: reais a partir desta tarefa (C2)
```

**Funcionalidades (C6):** as duas no grupo "Central de Cálculos" (R10 do P5).
- **`cad.parametros`:** ações `consultar` e `alterar`. GFIN tem as duas; ORCAMENTISTA, ANALISTA_GRH, AUDITOR e DIREX, só `consultar`.
- **`cad.salario_minimo`:** ações `consultar` e `alterar`. ANALISTA_GRH e GFIN têm as duas (C&S V4 §6.3; §11.3); AUDITOR, só `consultar`.

**Seed (padrões provisórios de 2027):**
- premissas: reajuste 5, data-base 5, IPCA 4 (GAP-ORC-003) e dias úteis 22;
- encargos e contas como na R14, com obrigações e riscos provisórios (GAP-CAR-005);
- SMN nulo (a GRH cadastra);
- semáforo 70/85/95;
- `parametro_sistema` vazio.

- [ ] **Step 1: Testes de domínio (falham):**
  - **`classificarSemaforo`:** 70,00 → VERDE; 70,01 → AMARELO; 85,00 → AMARELO; 95,00 → LARANJA; 95,01 → VERMELHO; 131,91 → VERMELHO; `null` → `null`;
  - **validação:**
    - mês 13;
    - reajuste negativo ou acima de 100;
    - encargo com percentual negativo, ou com soma acima de 100;
    - faixas fora de ordem;
    - conta que não é analítica ativa (pelo índice do C1);
    - SMN ≤ 0;
    - valores com mais casas do que o tipo.
- [ ] **Step 2: Testes de integração (falham):**
  - **alteração auditada:** um `ALTERACAO` com antes e depois em `Dinheiro`/`Percentual`, e `versao` incrementada;
  - **concorrência:** `versao` velha → "Este registro foi alterado por outro usuário. Recarregue a tela." (§10.2, item 4);
  - **permissão:** GRH altera o SMN, mas recebe 403 em `alterarParametrosExercicio`;
  - **`garantirPremissasExercicio(2028)`:**
    - sem 2028, copia 2027 e audita;
    - na segunda chamada, não faz nada;
    - sem nenhum ano, usa os padrões provisórios;
  - **`congelarPremissasExercicio(2027)`:** depois dele, `alterarParametrosExercicio(2027)` e `alterarSalarioMinimo(2027)` → `cad.exercicio_congelado` (Review Focus 8);
  - **§10.2, itens 1 e 5:** auditoria falhando → nada gravado; `provisorio` ou `congeladoEm` no *payload* → ignorados;
  - **`obterParametroSistema('instituicao.nome_exibicao')`:** `''` depois do seed.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar.**
  - **Migration:** como na Task 4.
  - **Tela:** "Parâmetros do exercício", com seletor de ano no topo, o bloco de encargos com o total, as contas por componente (seleção entre as analíticas) e o selo "Provisório" nos valores padrão. A tela do SMN é separada.
  - **`worker/index.ts`:** passa `obterNomeExibicao: () => prisma.$transaction((tx) => obterParametroSistema(tx, 'instituicao.nome_exibicao'))`.
- [ ] **Step 5:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 6: PR** "[US-053] Parâmetros por exercício, SMN, semáforo e encargos", `Closes #75`, labels `frente:B` e `migration`. Avisar a frente A no PR: `garantirPremissasExercicio` e `congelarPremissasExercicio` são reais a partir daqui. Lentes: plano/spec, testes, segurança e `security-review`.

### Task 10: Tabela Mestre de Benefícios por exercício (US-050 parte 1, `Refs #72`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_beneficios/migration.sql`
- Create: `src/modules/cad/domain/beneficios.ts`, `src/modules/cad/application/{beneficios,acoes-beneficios}.ts`, `src/modules/cad/ui/tabela-mestre.tsx`, `src/app/(sistema)/cad/beneficios/page.tsx`
- Modify: `src/modules/cad/infrastructure/seed.ts`, `src/modules/cad/index.ts`
- Test: `src/modules/cad/domain/beneficios.test.ts`, `src/modules/cad/application/beneficios.int.test.ts`

**Modelo `BeneficioMestre` (`beneficio_mestre`):**
- chave: pk (`ano`, `codigo`);
- conteúdo: `nome`, `forma` (enum `VALOR_MENSAL` | `VALOR_DIARIO` | `PERCENTUAL_SALARIO`), `valor?` NUMERIC(15,2), `percentual?` NUMERIC(9,4), `conta`;
- situação: `padraoPosicao`, `ativo`, `provisorio`;
- controle: `versao`, `atualizadoEm`.
- `CHECK`: a forma bate com o campo preenchido.
- Privilégios: `REVOKE DELETE FROM sgo_app`.

**Interfaces — Produces:**

```ts
export type FormaBeneficio = 'VALOR_MENSAL' | 'VALOR_DIARIO' | 'PERCENTUAL_SALARIO';
export type BeneficioMestre = {
  codigo: `beneficio.${string}`; nome: string; forma: FormaBeneficio;
  valor: Dinheiro | null; percentual: Percentual | null; conta: string;
  padraoPosicao: boolean; ativo: boolean; provisorio: boolean; versao: number;
};
export function listarBeneficiosMestre(ctx: ContextoRequisicao, ano: number, deps?): Promise<readonly BeneficioMestre[]>; // cad.beneficios:consultar
export function incluirBeneficioMestre(ctx: ContextoRequisicao, ano: number, dados: EntradaBeneficio, deps?): Promise<Resultado<void>>; // cad.beneficios:incluir
export function alterarBeneficioMestre(ctx: ContextoRequisicao, ano: number, codigo: string, versao: number, dados: EntradaBeneficio, deps?): Promise<Resultado<void>>; // cad.beneficios:alterar
// domínio, usado pelas premissas (Task 11)
export function valorMensalPorPessoa(b: BeneficioMestre, diasUteisMes: number): Dinheiro | null; // DIARIO → valor × dias; PERCENTUAL → null (depende do salário)
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
  - **`valorMensalPorPessoa`:** VR diário de 36,50 com 22 dias → 803,00; mensal 600,00 → 600,00; percentual → `null`;
  - **validação:**
    - forma `PERCENTUAL_SALARIO` sem percentual;
    - valor negativo;
    - conta que não é analítica ativa;
    - código fora de `^beneficio\.[a-z0-9_]{2,40}$`;
  - **integração:**
    - a alteração é auditada com antes e depois;
    - com o ano congelado → `cad.exercicio_congelado` (Review Focus 8);
    - `versao` velha → erro de concorrência;
    - GFIN → 403 ao alterar;
    - auditoria falhando → nada gravado.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar** (migration como na Task 4; tela com seletor de ano e selo "Provisório" ou "Sem valor").
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 5: PR** "[US-050] Tabela Mestre de Benefícios por exercício (parte 1/2)", `Refs #72`, labels `frente:B` e `migration`. Lentes: plano/spec, testes e segurança.

### Task 11: `MotorCustoPessoal` real e premissas completas (US-051 parte 1, `Refs #73`; **C2 real**)

**Files:**
- Create: `src/modules/cad/domain/motor-custo-pessoal.ts`
- Modify: `src/modules/cad/application/premissas.ts` (`obterPremissasExercicio` real), `src/modules/cad/index.ts`
- Test: `src/modules/cad/domain/motor-custo-pessoal.test.ts`, `src/modules/cad/application/premissas.int.test.ts`; Modify: `contrato-c2.test.ts`

**Interfaces:**
- Consumes: `Dinheiro`, `Percentual` e `Resultado` (kernel); o índice do C1 (contas ativas); `parametros_exercicio`, `encargo_exercicio`, `conta_componente_exercicio` e `beneficio_mestre`.
- Produces: `calcularCustoPosicao` e `obterPremissasExercicio` reais, com as assinaturas da Task 3, sem mudança. Também, para a Task 14 e para a tela de cargo:

```ts
// Encargo isolado (RN_CAR_17, REQ_CAR_013): total pelo percentual somado e resto no INSS (R13).
export function calcularEncargo(base: Dinheiro, encargos: PremissasExercicio['encargos']):
  { total: Dinheiro; componentes: readonly { componente: ComponenteEncargo; valor: Dinheiro }[] };
```

**Valores conferidos à mão** (planilha de conferência anexada ao PR, com a conta linha a linha):
- **Encargo do C&S V4 (§6.1):** `calcularEncargo(6.500,00)`:

  | Componente | Valor |
  | --- | --- |
  | INSS | 2.470,00 |
  | FGTS | 520,00 |
  | PIS | 65,00 |
  | Obrigações | 247,00 |
  | Riscos | 13,00 |
  | **Total** | **3.315,00** |

- **Posição do exemplo da planilha-modelo:** 2 × 7.500,00, de janeiro a dezembro, com reajuste de 5% a partir de maio, encargo de 51% e benefícios de VR 800,00 + saúde 600,00 + vida 50,00 por pessoa/mês (`premissasExemplo`).

  | Componente | Jan–Abr (cada mês) | Mai–Dez (cada mês) |
  | --- | --- | --- |
  | Salário | 15.000,00 | 15.750,00 |
  | Férias + 1/3 | 1.666,67 | 1.750,00 |
  | 13º | 1.250,00 | 1.312,50 |
  | Base do encargo | 17.916,67 | 18.812,50 |
  | Encargo total | 9.137,50 (9.137,5017) | 9.594,38 (9.594,375, Half-Even para cima, porque 7 é ímpar) |
  | INSS | 6.808,34 (6.808,33 + resto de 0,01) | 7.148,76 (7.148,75 + resto de 0,01) |
  | FGTS | 1.433,33 | 1.505,00 |
  | PIS | 179,17 | 188,12 (188,125 → Half-Even para 188,12) |
  | Obrigações | 680,83 | 714,88 |
  | Riscos | 35,83 | 37,62 |
  | Benefícios | 2.900,00 | 2.900,00 |
  | **Total do mês** | **29.954,17** | **31.306,88** |

  Total anual: **370.271,72**; salário anual: 186.000,00. A soma das linhas de cada mês é igual ao `totalMes`, e a soma dos 12 meses é igual ao `total` (sem *drift*, §10.2 item 6).
- **Recortes:**
  - início 3 e saída 10 → meses 1, 2, 11 e 12 zerados;
  - insalubridade de grau médio com SMN de 1.518,00 → `adicional` 303,60 por pessoa/mês, sem reajuste;
  - periculosidade em 5.000,00 → `adicional` 1.500,00 (C&S V4 §6.2), e 1.575,00 depois da data-base.

- [ ] **Step 1: Testes de domínio (falham)** com os valores acima, nome a nome (ex.: `RN_CAR_17 encargo do exemplo do C&S`, `C33 posição da planilha-modelo mês 5`). Também:
  - **erros (`Resultado`):** quantidade 0 ou 1,5; salário 0; `mesSaida < mesInicio`; mês 13; insalubridade sem SMN (RN_CAR_13: "Cadastre o Salário Mínimo Nacional do exercício antes de usar insalubridade."); periculosidade e insalubridade juntas não compilam (tipo); componente sem conta;
  - **benefício `PERCENTUAL_SALARIO`** de 2% sobre 7.500,00 → 150,00 por pessoa/mês, sem reajuste.
- [ ] **Step 2: Testes de integração (falham):**
  - **com os padrões do seed:** `obterPremissasExercicio(2027)` → `provisorio: true`, encargos somando 51, `beneficios: []` e três avisos de "sem valor" (VR, saúde básico, seguro de vida);
  - **valores preenchidos:** a GRH preenche VR diário de 36,50 → `beneficio.vr` com `VALOR_MENSAL` de 803,00, e a `versao` muda;
  - **ano inexistente** → `null`;
  - **ano congelado** → `congelado: true`;
  - **conta inativada pela recarga do plano** → as premissas trazem aviso, e `calcularCustoPosicao` recusa o componente sem conta ativa.
- [ ] **Step 3:** testes → FAIL.
- [ ] **Step 4: Implementar.** Função pura, só com `Dinheiro`/`Percentual`; nada de `number` em valor (o lint barra em `domain/`). A série é montada mês a mês e somada com `Dinheiro.somarTodos`.
- [ ] **Step 5:** suíte + `npm run lint && npm run typecheck` → PASS.
- [ ] **Step 6: PR** "[US-051] MotorCustoPessoal real e premissas do exercício (contrato C2) (parte 1/2)", `Refs #73`, label `frente:B`.
  - **No corpo:**
    - a planilha de conferência;
    - o aviso à frente A de que o C2 real está na `main`, para a US-121 trocar o falso pelo real nos testes de integração;
    - a nota sobre a cifra e a máscara do salário da posição no `orc` (Interações).
  - **Lentes:** plano/spec, testes (o revisor confere 3 valores da tabela com calculadora), segurança, `type-design-analyzer` e `silent-failure-hunter`.

### Task 12a: Cargos — modelo, cifra, domínio e importação dos dados do Rubi (US-049 parte 1, `Refs #71`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_cargos/migration.sql`
- Create: `src/modules/cad/domain/cargo.ts`, `src/modules/cad/infrastructure/cifra-salarios.ts`, `src/modules/cad/application/importar-cargos.ts`, `src/modules/cad/infrastructure/dados/cargos-sinteticos.json`
- Modify: `src/modules/cad/infrastructure/seed-referencia.ts`, `src/modules/cad/index.ts`, `docs/operacao/ambientes.md` (`CHAVE_CIFRA_SALARIOS*` no `app`; a cópia da chave fica com o PO, fora da VPS)
- Test: `src/modules/cad/domain/cargo.test.ts`, `src/modules/cad/infrastructure/cifra-salarios.test.ts`, `src/modules/cad/application/importar-cargos.int.test.ts`; Modify: `privilegios.int.test.ts`

**Modelos:**
- **`Cargo` (`cargo`):**
  - **origem Rubi** (ORIGEM BLINDADA, escrita só pelo `sgo_sync`): `codigo` único, `nomeOficial`, `nomeMercado`, `tabelaSalarialCodigo?`, `tabelaSalarialDescricao?`, `faixaCodigo?`, `faixaDescricao?`, `nivelCodigo?`, `nivelDescricao?` e `salarioRealCifrado?`;
  - **manuais:** `funcaoGratificadaCifrada?`, `salarioDefinidoCifrado?`, `mercadoMinimo?` NUMERIC(15,2), `mercadoMaximo?`, `origemMercado?` (`TABELA_SALARIAL` | `MANUAL`), `origemMercadoRotulo?`, `fonteAtiva?` (enum `MINIMO` | `MAXIMO` | `TOTAL` | `REAL` | `DEFINIDO`), `adicionalTipo?`, `adicionalGrau?` e `vinculoFuncionalId?` (R11);
  - **controle:** `ativo`, `versao`, `cargaId?`, `criadoEm`, `atualizadoEm`.
- **`Senioridade`:** `id`, `nome` único (sem diferenciar maiúsculas), `protegida` (Júnior, Pleno e Sênior pela seed), `ativo`.
- **`FaixaSalarial` (`faixa_salarial`):** `id`, `cargoId` (FK), `senioridadeId` (FK), `minimo` e `maximo` (`CHECK minimo < maximo`), `ativo`, `versao`. Sem unicidade de cargo + senioridade (RN_TAB_03).

**Migration:**
- **`CHECK`:** periculosidade sem grau; insalubridade com grau (RN_CAR_12); `mercado_minimo < mercado_maximo` quando os dois existem.
- **Privilégios (R6):**
  - `REVOKE INSERT, DELETE ON cargo FROM sgo_app` e `REVOKE UPDATE ON cargo FROM sgo_app`;
  - `GRANT UPDATE (funcao_gratificada_cifrada, salario_definido_cifrado, mercado_minimo, mercado_maximo, origem_mercado, origem_mercado_rotulo, fonte_ativa, adicional_tipo, adicional_grau, vinculo_funcional_id, ativo, versao, atualizado_em) ON cargo TO sgo_app`;
  - `GRANT UPDATE` só nas colunas de origem Rubi para o `sgo_sync`, sem `DELETE`;
  - `REVOKE DELETE ON senioridade, faixa_salarial FROM sgo_app`.

**Interfaces — Produces:**

```ts
export type FonteAtiva = 'MINIMO' | 'MAXIMO' | 'TOTAL' | 'REAL' | 'DEFINIDO'; // C20: DEFINIDO [PROVISÓRIA]
// domínio (puro)
export type SalariosCargo = { minimo: Dinheiro | null; maximo: Dinheiro | null; funcaoGratificada: Dinheiro | null; real: Dinheiro | null; definido: Dinheiro | null };
export function salarioTotal(s: SalariosCargo): Dinheiro | null;        // R19: máximo + função gratificada
export function salarioDaFonte(s: SalariosCargo, fonte: FonteAtiva): Dinheiro | null;
export function desvioDeMercado(s: SalariosCargo): 'ABAIXO' | 'DENTRO' | 'ACIMA' | null; // REQ_CAR_005
// infrastructure (não exportado)
interface CifraSalarios { cifrar(valor: Dinheiro, aad: string): string; decifrar(envelope: string, aad: string): Dinheiro }
function criarCifraSalarios(fonte?: Readonly<Record<string, string | undefined>>): CifraSalarios; // R7
// caso de uso (exportado)
export function importarCargos(ctx: ContextoRequisicao, arquivo: ArquivoCarga, deps?: DepsCarga & { cifra?: CifraSalarios }): Promise<Resultado<ResumoCarga>>; // cad.cargos:executar
```

- [ ] **Step 1: Testes de domínio (falham):**
  - **`salarioTotal`:** máximo 9.000,00 + FG 1.200,00 → 10.200,00; sem FG → 9.000,00; sem máximo → `null`;
  - **`salarioDaFonte`:** cada uma das 5 fontes;
  - **`desvioDeMercado`:** real de 8.000 com faixa 8.500–9.000 → ABAIXO;
  - **validações:** periculosidade junto com insalubridade → "Um cargo pode ter apenas um adicional trabalhista: Periculosidade OU Insalubridade." (E5); mínimo ≥ máximo (E3, RN_TAB_02).
- [ ] **Step 2: Testes da cifra (falham):**
  - ida e volta de "7500.00";
  - o envelope começa com `v1:<id>:`;
  - AAD de outro cargo ou de outro campo → erro (Review Focus 5);
  - envelope adulterado (1 byte) → erro;
  - sem `CHAVE_CIFRA_SALARIOS` → `cad.cifra_indisponivel`, e a mensagem não tem a chave;
  - chave com 31 bytes → erro;
  - envelope da chave anterior decifra com `CHAVE_CIFRA_SALARIOS_ANTERIOR`.
- [ ] **Step 3: Testes de integração (falham):**
  - **importação:** cria os cargos com o salário real cifrado (o `SELECT` direto não acha "7500" em nenhuma coluna);
  - **recarga:**
    - pelo código, idempotente;
    - não toca os campos manuais;
    - o cargo ausente é inativado;
  - **privilégios:** o `sgo_app` não consegue `UPDATE cargo SET salario_real_cifrado = …`, `INSERT` nem `DELETE`;
  - **Histórico:** o `depois` tem o envelope, nunca o valor em claro;
  - **seed:** com `CARGA_DADOS_REFERENCIA=1`, entram os cargos sintéticos.
- [ ] **Step 4:** testes → FAIL.
- [ ] **Step 5: Implementar** (migration como na Task 4; leitor e carga reutilizados; layout `CAD-CARGOS v1.0`, R20).
- [ ] **Step 6:** suíte + lint + typecheck + `test:arq` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 7: PR** "[US-049] Cargos: dados do Rubi por arquivo e salários cifrados (parte 1/3)", `Refs #71`, labels `frente:B` e `migration`. Pendências no corpo: P1 a P4. **PO:** gerar a chave e cadastrar `CHAVE_CIFRA_SALARIOS`/`_ID` no serviço `app` de hml e prod, e guardar a cópia fora da VPS. Lentes: plano/spec, testes, segurança, `security-review` e `type-design-analyzer`.

### Task 12b: Telas de cargo com mascaramento por perfil (US-049 parte 2, `Refs #71`)

**Files:**
- Create: `src/modules/cad/application/{cargos,acoes-cargos}.ts`, `src/modules/cad/ui/{lista-cargos,form-cargo}.tsx`, `src/app/(sistema)/cad/cargos/{page,[id]/page,importar/page}.tsx`
- Modify: `src/modules/cad/infrastructure/seed.ts`, `src/modules/cad/index.ts`
- Test: `src/modules/cad/application/cargos.int.test.ts`, `src/modules/cad/ui/form-cargo.test.ts`

**Interfaces — Produces:**

```ts
export type CargoTela = {
  id: string; codigo: string; nomeOficial: string; nomeMercado: string;
  tabelaSalarial: string | null; faixa: string | null; nivel: string | null; // "[código] — [descrição]" (RN_CAR_09)
  salarios: { [K in keyof SalariosCargo]: string | null }; // decimal em texto; null se vazio ou mascarado
  mascarado: boolean;                                       // R7
  origemMercado: string | null;                             // REQ_TAB_005
  fonteAtiva: FonteAtiva | null; adicional: AdicionalTrabalhista | null;
  desvioDeMercado: 'ABAIXO' | 'DENTRO' | 'ACIMA' | null; ativo: boolean; versao: number;
};
export function listarCargos(ctx: ContextoRequisicao, deps?): Promise<readonly CargoTela[]>;  // cad.cargos:consultar
export function obterCargo(ctx: ContextoRequisicao, id: string, deps?): Promise<CargoTela | null>;
// Sem campo de origem Rubi no esquema (ORIGEM BLINDADA, E2). Insalubridade exige o SMN do ano corrente (E6, RN_CAR_13).
export function alterarCargo(ctx: ContextoRequisicao, id: string, versao: number, dados: EntradaCargo, deps?): Promise<Resultado<void>>; // cad.cargos:alterar
```

**Funcionalidade (C6):** `cad.cargos`
- local: grupo "Pessoal", nome "Cargos e Salários", rota `/cad/cargos`;
- ações: `consultar`, `alterar` e `executar` (importação);
- perfis: ANALISTA_GRH tem todas; GFIN, ORCAMENTISTA, AUDITOR e DIREX, só `consultar`.
- **Sem máscara:** quem tem `cad.cargos:alterar` ou `cad.parametros:alterar` (R7, pendência P5).

- [ ] **Step 1: Testes (falham):**
  - **máscara (Review Focus 5):** ORCAMENTISTA recebe `mascarado: true` e todos os `salarios` nulos; o HTML da página não tem os valores; GRH e GFIN recebem os valores;
  - **ORIGEM BLINDADA (§10.2, item 5):** `alterarCargo` com `salarioReal` ou `nomeOficial` no *payload* → recusado, nada gravado;
  - **E6:** insalubridade sem SMN no ano → erro em `adicional`;
  - **concorrência:** `versao` velha → erro de concorrência (§10.2, item 4);
  - **escrita sem permissão:** AUDITOR → 403 auditado;
  - **auditoria:** com o `auditar` falhando, nada é gravado; o Histórico tem envelope, não valor;
  - **tela:**
    - os campos de origem Rubi aparecem desabilitados;
    - a Fonte Ativa tem as 5 opções;
    - o desvio de mercado aparece com cor e com texto (não só cor);
    - não há botão Novo (cargo nasce na importação, R20).
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar** (decifra só no servidor e só para quem pode ver; a regravação cifrada só quando o valor muda, R7).
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-049] Telas de cargos com salários mascarados por perfil (parte 2/3)", `Refs #71`, label `frente:B`. Lentes: plano/spec, testes, segurança e `security-review`.

### Task 12c: Tabela salarial e senioridades (US-049 parte 3, `Closes #71`)

**Files:**
- Create: `src/modules/cad/application/{tabela-salarial,acoes-tabela-salarial}.ts`, `src/modules/cad/ui/tabela-salarial.tsx`, `src/app/(sistema)/cad/tabela-salarial/page.tsx`
- Modify: `src/modules/cad/ui/form-cargo.tsx` (botão "Tabela Salarial"), `src/modules/cad/infrastructure/seed.ts`
- Test: `src/modules/cad/application/tabela-salarial.int.test.ts`

**Interfaces — Produces:**
- **Faixas:** `listarFaixasSalariais(ctx, cargoId?)`, `incluirFaixaSalarial`, `alterarFaixaSalarial` e `inativarFaixaSalarial` (`cad.tabela_salarial`).
- **Senioridades:** `incluirSenioridade` e `inativarSenioridade` (RN_TAB_01: as protegidas não saem; a customizada só sai sem faixa ativa, E4).
- **Cópia para o cargo:** `copiarFaixaParaCargo(ctx, cargoId, faixaId, versao)` copia mínimo e máximo com o rótulo "Preenchido via Tabela Salarial — <cargo>/<senioridade>" (REQ_TAB_003, RN_TAB_04). Editar o valor depois troca o rótulo para "Editado manualmente".

**Funcionalidade (C6):** `cad.tabela_salarial`
- local: grupo "Pessoal", rota `/cad/tabela-salarial`;
- ações: `consultar`, `incluir`, `alterar` e `excluir` (inativação);
- perfis: ANALISTA_GRH tem todas; GFIN, só `consultar`.

- [ ] **Step 1: Testes (falham):**
  - mínimo ≥ máximo → erro nos dois campos (RN_TAB_02);
  - dois registros para o mesmo cargo e senioridade → os dois aceitos e listados (RN_TAB_03);
  - inativar "Pleno" → erro; inativar uma customizada com faixa ativa → erro (E4);
  - a cópia grava o rótulo de origem, e a edição manual troca para "Editado manualmente";
  - os testes §10.2 de 1, 3 e 4.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-049] Tabela salarial e senioridades (parte 3/3)", `Closes #71`, label `frente:B`. Os três critérios provados: as 5 fontes (12a), periculosidade e insalubridade (12a e 12b) e salário cifrado e mascarado (12a e 12b). Lentes: plano/spec, testes e segurança.

### Task 13: Benefícios do cargo e sobrescrita pela Tabela Mestre (US-050 parte 2, `Closes #72`)

**Files:**
- Modify: `prisma/schema/cad.prisma`; Create: `prisma/migrations/<AAAAMMDDHHMM>_cad_beneficio_cargo/migration.sql`
- Modify: `src/modules/cad/application/beneficios.ts` (sobrescrita), `src/modules/cad/application/cargos.ts`, `src/modules/cad/ui/form-cargo.tsx` (subtela de benefícios, REQ_CAR_003)
- Test: `src/modules/cad/application/beneficio-cargo.int.test.ts`

**Modelo `BeneficioCargo` (`beneficio_cargo`):**
- chave: pk (`cargoId`, `ano`, `codigo`);
- conteúdo: `ativo`, `valorManual?` NUMERIC(15,2), `origem` (`MESTRE` | `MANUAL`), `atualizadoEm`.
- Privilégios: `REVOKE DELETE FROM sgo_app`.

**Interfaces — Produces:**
- `alterarBeneficiosCargo(ctx, cargoId, ano, versaoCargo, itens: readonly { codigo; ativo; valorManual: string | null }[])` (`cad.cargos:alterar`): grava `origem = MANUAL` quando há valor manual (RN_CAR_07).
- O `alterarBeneficioMestre` (Task 10) passa a, na mesma transação, apagar o `valorManual` de todos os cargos daquele `(ano, codigo)` e pôr `origem = MESTRE` (RN_CAR_06, C8). Cada cargo afetado ganha um Histórico `ALTERACAO` com antes e depois.
- **Auxílio creche:** item manual do cargo (`beneficio.auxilio_creche`), fora da Tabela Mestre (R12).

- [ ] **Step 1: Testes (falham):**
  - **sobrescrita:** 3 cargos com VR manual; a GRH altera o VR da Tabela Mestre de 2027 → os 3 voltam a `MESTRE`, com 3 Históricos com o valor anterior;
  - **outro ano:** o cargo com VR manual de 2028 não muda;
  - **congelado:** com 2027 congelado, a alteração da Tabela Mestre é recusada, e nada muda nos cargos ("nunca altera snapshot oficializado");
  - **atomicidade:** com a auditoria falhando no 2º cargo, nada muda (§10.2, item 1);
  - **na tela:** cada benefício mostra a origem ("Tabela Mestre" ou "Manual").
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar** (migration como na Task 4).
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS; `db:deploy` e `migrate diff` no dev local.
- [ ] **Step 5: PR** "[US-050] Benefícios do cargo com sobrescrita auditada pela Tabela Mestre (parte 2/2)", `Closes #72`, labels `frente:B` e `migration`. Lentes: plano/spec, testes, segurança e `silent-failure-hunter`.

### Task 14: Custo do cargo pelo motor (US-051 parte 2, `Closes #73`)

**Files:**
- Create: `src/modules/cad/application/custo-cargo.ts`, `src/modules/cad/ui/bloco-encargo.tsx`
- Modify: `src/modules/cad/ui/form-cargo.tsx`, `src/modules/cad/index.ts`
- Test: `src/modules/cad/application/custo-cargo.int.test.ts`, `src/modules/cad/ui/bloco-encargo.test.ts`

**Interfaces — Produces:**

```ts
// Custo unitário mensal do cargo no exercício: a posição de 1 pessoa, de janeiro a dezembro, com a Fonte Ativa,
// o adicional e os benefícios ativos do cargo (valor manual ou da Tabela Mestre), pelo calcularCustoPosicao.
// Usa os dados sem máscara só internamente; quem não pode ver salário recebe o total e os componentes mascarados.
export function calcularCustoCargo(ctx: ContextoRequisicao, cargoId: string, ano: number, deps?):
  Promise<Resultado<{ serie: SerieMensalComponentes; encargo: ReturnType<typeof calcularEncargo>; mascarado: boolean }>>;
```

- [ ] **Step 1: Testes (falham):**
  - **cargo com periculosidade:** Fonte Ativa 5.000,00 + periculosidade → no mês 1, `salario` 5.000,00 e `adicional` 1.500,00, com a base do encargo calculada pela R14. Os valores são conferidos à mão no PR, como na Task 11;
  - **bloco de encargo (REQ_CAR_013):** mostra o consolidado (R$ e 51%) e o detalhe dos 5 componentes ao mesmo tempo;
  - **sem Fonte Ativa** → mensagem "Selecione a Fonte Ativa para calcular o custo." e nenhum cálculo;
  - **ORCAMENTISTA** → o bloco aparece mascarado.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** suíte + lint + typecheck + `test:arq` e, sozinho, `npm run build` → PASS.
- [ ] **Step 5: PR** "[US-051] Custo do cargo pelo MotorCustoPessoal (parte 2/2)", `Closes #73`, label `frente:B`. Os três critérios provados: encargo parametrizado (Tasks 9 e 11), componentes nas contas analíticas (Task 11) e valores conferidos à mão (Tasks 11 e 14). Pendência: GAP-CAR-005 (contas de obrigações e riscos). Lentes: plano/spec, testes e segurança.

---

## Riscos

- **SMTP de prod indefinido (GAP-INF-001):** até o PO decidir (P7), o worker de hml/prod sobe sem trabalhador de e-mail (`[EMAIL_SEM_SMTP]`). Os e-mails ficam pendentes e visíveis na fila, e a US-038 (frente A) não entrega senha em hml. Mitigação: o código está testado com `smtp-server` e Mailpit; ao cadastrar as variáveis, os pendentes saem.
- **E-mail duplicado:** a entrega é "pelo menos uma vez". Se o processo cair entre o aceite do SMTP e o fim do job, o usuário pode receber duas vezes a mesma senha temporária. Risco aceito: a senha é a mesma e vale 24 h.
- **Senha temporária no WAL e nos backups:** já aceito na spec §11.2a. A US-025 limpa o *outbox* e o job, não o WAL.
- **Perda da chave de salários:** sem a cópia guardada pelo PO, os salários cifrados ficam ilegíveis, inclusive no backup. Mitigação: o passo do PO na Task 12a e o registro em `docs/operacao/ambientes.md`.
- **Medida de 60 FPS manual:** a rolagem de 5.000 linhas é medida no navegador (Task 6a), e não por teste automático no CI. A spec §10.3 manda medir em hml com volumetria de referência; isso fica para a homologação do PO.
- **Minuta de CC mudando depois de 16/11:** a recarga por reduzido (R5) absorve a mudança de descrição e de estrutura. Reduzido trocado (GAP-CC-003) vira CC novo, e o antigo é inativado. Se a frente A já tiver lançado posições num CC inativado, a US-121 precisa recusar (C1: `ehCentroCustoAnalitico` só aceita ativo).
- **Benefícios sem valor na Tabela Mestre:** se a GRH não preencher até a US-121, o custo das posições sai sem benefícios. A US-121 recebe isso como aviso nas premissas, e não como erro.
- **Fila de migrations:** seis migrations neste bloco, uma por PR, num período em que a frente A também gera migrations no P5 e no P6. Uma colisão de ordem obriga a regerar a migration (§12.7 item 3); custa minutos, não dados.

## Encerramento do P4

- [ ] Critérios de aceite das issues #43, #47, #65, #66, #68, #71, #72, #73 e #75 marcados, com o link da prova em cada um.
- [ ] `npm run lint && npm run typecheck && npm test && npm run test:arq` verdes na `main`; depois, `npm run test:int` e `npm run build`, cada um sozinho (D12).
- [ ] Contratos C1 e C2 reais na `main`, com o falso ainda exportado para os testes da frente A.
- [ ] Revisão do bloco (§12.12) num comentário nos épicos EP06 (estrutura financeira), EP07 (pessoal-base) e EP03 (componentes).
- [ ] Pendências do PO (P1 a P8) registradas na memória, com o que cada uma destrava.
- [ ] Spec v1.6 (PR `compartilhado` de spec): R7 (D10), R9 (3 tentativas do e-mail), R11 (vínculo funcional opcional na trilha), R19 (Total da Fonte Ativa) e o `Refs #n` pendente do P3.
- [ ] Atualizar `docs/memoria/memoria-do-projeto.md` (estado, pendências e diário).
- [ ] Detalhar o P7 (go-live, US-115 a US-117) com o writing-plans, a partir das cargas reais deste bloco.
