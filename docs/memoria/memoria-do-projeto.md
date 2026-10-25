# SGO 2.0 — Memória do projeto

> **Leia este arquivo no início de toda sessão** (frente A, frente B ou qualquer outra conta) e **atualize-o ao fim** da sessão, com a data, em PR. É o contexto compartilhado entre as contas do Claude Code: nenhuma sessão vê a conversa ou a memória local das outras.
>
> Hierarquia: a **spec** (`docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md`) é a norma. O **backlog** (`docs/backlog/`) é o que construir e em que ordem. Este arquivo é **estado, decisões recentes e pendências**. Em caso de conflito, vale a spec.

Última atualização: 25/10/2026 (frente A, US-003 a US-010 e fim do P1; frente B, abertura, plano do P3 e Tarefas 1 a 5 do P3).

---

## 1. O projeto em uma tela

| Item | Valor |
| --- | --- |
| Sistema | SGO 2.0, Sistema de Gestão Orçamentária, refeito do zero |
| Repositório | `fabianojp06/sgov2` (privado). Clone na VPS em `/root/sistemas/sgo` |
| PO / BA | Fabiano Garcia. Responder sempre em **português do Brasil** |
| Fonte de requisitos | **Somente** a pasta `especificacao/` (EPs, plano de contas, plano de CC). O repositório `sistemaSgo` é só referência técnica |
| Stack | Monólito modular Next.js + TypeScript strict, PostgreSQL 16 + Prisma, decimal.js (Half-Even, NUMERIC(15,2)), pg-boss, Zod, Tailwind/shadcn, TanStack, ExcelJS, Vitest/Testcontainers/Playwright (spec §4) |
| Hospedagem | VPS Hostinger srv2039095 (2 vCPU, 8 GB, 96 GB, **sem swap** até a US-122) com Easypanel + Traefik (80/443); Easypanel na porta 3000. Projetos `sgo-hml` e `sgo-prod` (app, worker, db sem porta pública). **O dev das duas frentes roda na mesma VPS** (D12), com mitigações obrigatórias |
| Deploy | GitHub Actions → GHCR → webhook do Easypanel. Backup: pgBackRest PITR para storage externo + dump diário + snapshot + teste de restauração mensal |
| Projeto no GitHub | "SGO 2.0 – Roadmap": https://github.com/users/fabianojp06/projects/4 |

## 2. Regras invioláveis

1. **Fontes:** decisões vêm só da pasta `especificacao/` e da spec. As notas pessoais versionadas na raiz do repositório (`profile.md`, `preferences.md`, `areas/`, `projects/`, `people/`, `topics/`) **não são fonte de nada** e não devem ser lidas, citadas, movidas nem apagadas sem pedido do PO.
2. **Marca neutra:** o nome "CTCEA" **nunca** aparece no sistema (código, seeds, telas, modelos gerados). Na spec e nos documentos de especificação ele pode aparecer. O nome exibido vem do parâmetro `instituicao.nome_exibicao` (spec §6.7).
3. **Banco de produção** (incidente de 14/08/2026, spec §11.5): antes de qualquer comando que toque um banco, dizer se ele **escreve, apaga ou reseta**; conferir `DATABASE_URL` e `SHADOW_DATABASE_URL`; `shadowDatabaseUrl` **nunca** aponta para prod; nunca `migrate reset`, `db push` ou `migrate diff` fora do dev. Na dúvida, perguntar.
4. **`main` protegida:** tudo entra por PR, com merge *squash*. Ninguém faz push direto, nem o dono.
5. **Ações externas** (GitHub, e-mail, serviços) só com confirmação do PO.
6. **Segredos:** a `ANTHROPIC_API_KEY` e as credenciais de prod ficam só nas variáveis do Easypanel. Nunca no repositório nem em `.env` de dev.
7. **Commits** terminam com os trailers de coautoria da sessão e com `Frente: A` ou `Frente: B` (spec §12.4).
8. **Code review (§12.12):** nenhum PR vai para o PO sem o comentário "Revisão de código (12.12)". O merge na `main` é sempre aprovado explicitamente pelo PO (o sistema de permissões bloqueia merge sem essa aprovação).
9. **Duas frentes:** cada pasta tem um dono (spec §12.3). Não alterar código da outra frente sem a label `toca-outra-frente`.
10. **Dev na VPS de produção (D12):** nunca acessar contêineres, redes, volumes ou variáveis de `sgo-prod`/`sgo-hml` (`docker exec`, `docker cp`, `docker compose`, `psql`). Os hooks bloqueiam; exceção só com pedido explícito do PO.

## 3. Decisões principais (detalhe na spec)

| Tema | Decisão | Spec |
| --- | --- | --- |
| Organização | Única, sem multi-tenant. Isolamento por unidade (TP) com `unidade_id`, `UsuarioUnidade`, guarda e RLS | §5, C31 |
| Autenticação | Login próprio (Argon2id, sessão em banco). Unificação com a intranet depois (GAP-AUT-001) | §4, C29 |
| Entrada | Sem página pública: o sistema abre no login | C32 |
| Perfis | Administrador, Orçamentista, GFIN, Analista GRH, Operador de Viagens, Auditor, Gestor de Diretoria | §11.3, C30 |
| Plano de contas | 5 níveis, da planilha oficial (174 contas, 162 analíticas). Sem CRUD: consulta, importação, sincronização e parâmetros locais | §6.1, D7, C27 |
| Centros de custo | 5 níveis (minuta Rev23102026: 35 CCs, 27 analíticos), aguardando a DIREX (GAP-CC-001) | §6.1a |
| Viagens | Fórmula exatamente como a RN_VIA_03, sem transporte | C19, C28 |
| Adm. Central | Menu próprio; exercícios anuais (UC04.17); pessoal pelo MotorCustoPosicao com encargo de 51%; base zero; receitas = rateio dos TPs (confirmado × previsto); teto padrão = rateio líquido confirmado; ISS a definir (GAP-ORC-007) | §6.6, §6.7 |
| IA | Infra na F0 (porta `ProvedorIA`, adaptador Anthropic `claude-opus-5-5`, flags desligadas). Catálogo IA-01 a IA-18. O número oficial nunca vem da IA | §4.4, §6.8 |
| Processo | Duas contas do Claude Code em duas frentes, com dono por pasta, contratos, fila de migrations e CI de fronteira | §12 |
| Primeiro plano | Trilha 2027 (41 histórias), não a F0 + F1 completas | §3.3 |
| Dev × produção | Dev na mesma VPS, com swap, prioridade da produção, earlyoom, limites, hooks e alerta; gatilho de revisão | D12, §4.3 |
| Custo de pessoal | Motor único `MotorCustoPessoal` (módulo `cad`): base + férias 1/3 + 13º, encargo de 51% sobre o total, benefícios; proposta e Adm. Central [PROVISÓRIA, Wellington] | C33, §6.4 |
| Cargo na trilha | Texto livre na planilha e na importação; vínculo com C&S depois de 30/11 | C34 |
| Receita na transição | Rateio digitado pela GFIN (`MANUAL_TRANSICAO`), substituído pelo do TP quando ele for oficializado | C35, §6.6 |
| Aprovação da Adm. Central | GFIN envia; perfil **Diretoria Executiva (DIREX)** aprova ou rejeita | C36, §11.3 |
| Code review | Três camadas: CI; agentes em 3 lentes (plano/spec, testes, segurança) + revisores dedicados por tipo de PR, registrados num comentário "Revisão de código (12.12)" no PR; PO. Bloqueante/importante impedem merge; revisão de bloco no fim de P1–P7; `/code-review ultra` opcional (PO) em P1 e P6 | §12.12 |

## 4. Orçamento 2027 da Adm. Central: trilha híbrida (prioridade máxima)

- **Meta:** orçamento 2027 **lançado e aprovado até 30/11/2026** (decisão do PO em 24/10/2026).
- **Modelo híbrido:**
  1. os gestores lançam na **planilha-modelo** `docs/modelos/orcamento-adm-central-2027-modelo-v1.0.xlsx` (US-120, layout `ADMC-ORC v1.0`);
  2. o sistema importa a planilha (US-121), recalcula pelo motor oficial e a revisão e a aprovação acontecem nele.
- **Plano B:** se o sistema atrasar, a aprovação de 30/11 é feita sobre a planilha, e o sistema a importa depois como orçamento oficial.
- **Recorte:** 41 histórias com a label `trilha-2027`, 384 h (461 h com contingência). A frente A tem 23 histórias (196 h) e a frente B tem 18 (188 h), incluindo a US-122 (mitigações de D12), que é a primeira da frente B.
- **Previsão do cronograma:** a trilha termina por volta de **11/12/2026** a 40 h/semana por frente, e de **27/11/2026** a 60 h/semana por frente.
- **Antes de distribuir a planilha:** a GRH precisa preencher os benefícios em Premissas; a GFIN precisa confirmar reajuste, data-base e IPCA (GAP-ORC-003). A lista de CCs é a minuta e pode mudar.

## 5. Estado atual (24/10/2026)

**Código (P1 Fundação, frente A)**
- Na `main`: US-001 (#149, fronteiras de módulo e `.github/frentes.yml`), US-002/US-012 (#152, `CLAUDE.md`, hooks e marca neutra), US-122/US-016 (#151, mitigações de D12 na VPS).
- US-003 (#162) na `main`: `docker compose up -d` sobe db e mailpit da frente A; app e worker ficam no perfil `app`. O compose exige um `.env` local (fora do git) com `COMPOSE_PROJECT_NAME`, as portas e `POSTGRES_PASSWORD`.
- US-004 (#164) na `main`: Prisma 7 (`prisma.config.ts`, schema em `prisma/schema`), papéis `sgo_migrator`/`sgo_app`/`sgo_sync`, migration de privilégios, `src/shared/{config,db}`. As URLs do Prisma ficam no `.env.local`. O `prisma.config.ts` recusa `migrate dev/reset/diff` e `db push` fora do dev local, inclusive via `npm run db:migrate`.
- Testes de integração (Testcontainers): porta só em 127.0.0.1, 512 MB, `oom_score_adj` 500 e **sem o Ryuk**. Se um teste morrer no meio, limpar com `docker rm -f $(docker ps -aq --filter label=org.testcontainers=true)`.
- US-005 (#166 lint, #167 kernel) na `main`: `Dinheiro`, `Percentual`, `Competencia` e `distribuirEm12` em `@/shared/kernel`; o lint barra `parseFloat`, `Math.round` e `.toFixed` em `domain/` e `kernel/` (exceção: `kernel/decimal.ts`).
- Decisões do PO (25/10, issue #168): dezembro pode ficar com sinal oposto em valores pequenos (igual à planilha); a diferença de 1 centavo entre o `ROUND` do Excel e o Half-Even do sistema é aceita, e a conferência da US-121 precisa tolerá-la.
- **Fim do período de fundação.** Spec 1.3: `src/shared/{config,db,filas}/` e `tests/integracao/` passam a ser da frente A. Texto de abertura da frente B em `docs/backlog/abertura-frente-b.md`.
- US-006 (#171) na `main`: Histórico de Operações append-only (`auditar(tx, evento)` em `@/shared/audit`). Regras para quem audita: chamar sempre com o `tx` de `$transaction` (o cliente raiz é recusado); INSERCAO/ALTERACAO/EXCLUSAO exigem `registroId` e antes/depois; `ip` é um IP só (o proxy resolve o `X-Forwarded-For`); auditar dinheiro como `Dinheiro`/`Percentual`, não `Decimal` cru; credenciais são omitidas automaticamente.
- US-008 (#174 authz, #175 teste de arquitetura) na `main`: toda Server Action com `definirAcao` e todo Route Handler com `definirRota` (`@/shared/authz`), o que o teste de arquitetura impõe. Com o `auditar`, fecha o contrato C5. Até o `aut` (P5) registrar o provedor (`@/shared/authz/configuracao`, com `id` estável), tudo responde 401.
- US-009 (#178) na `main`: `totalizar`/`totalizarSerie` (`@/shared/totalizer`), motor único de totais e sintéticas (função pura).
- US-010 (#180 compartilhado, #181) na `main`, **fim do P1 Fundação** (25/10). O que entrou:
  - `@/shared/filas`: `criarFila` com pg-boss (`retryLimit` 5, backoff) e outbox transacional (`registrarNoOutbox` dentro do `tx`; o worker publica a cada 10 s, uma mensagem por transação, e apaga os dados ao publicar).
  - `FilaGerenciada`: `consultar`, `reprocessar` e `apagarJob`. A US-025 (C4) usa o `apagarJob` para apagar a senha temporária do job.
  - Só `ErroDominio` gasta tentativa do outbox (até 10). Erro de infraestrutura derruba o worker para o orquestrador reiniciar.
  - Papel `sgo_fila`, dono do schema `pgboss` (`createSchema: false`), com `search_path` fixo e sem CREATE no banco. URL em `FILA_DATABASE_URL`.
  - `worker:start` = `node --import tsx worker/index.ts`, porque o `npm`/`npx` não repassam o SIGTERM.
  - Menores na issue #182.
- Desde o #176 (US-013 parte 1), **todo PR precisa da label `frente:A` ou `frente:B`, inclusive o `compartilhado`**, além de `Closes #n` ou `Refs #n`. O check "Fronteira de frente" reprova sem isso.
- **Nome de migration (as duas frentes):** as migrations do núcleo têm data no futuro (`202610260000`, `202610260100`). Toda migration nova precisa ordenar **depois da última existente**, senão a tabela nasce sem os privilégios padrão de `sgo_app`. Até 26/10/2026 01:00, use um nome maior que o da última migration da `main`.
- O Prisma recusa `migrate reset` chamado pelo Claude Code: para recriar o banco de dev, `docker compose down -v` + `docker compose up -d --wait` + `npm run db:deploy` + `npm run db:seed`.
- **Frente B aberta (25/10):** worktree `/root/sistemas/sgo-b` com `.env`/`.env.local` próprios (banco 56432, Mailpit 8225, só em 127.0.0.1), `npm ci`, migrations e seed aplicadas no banco de dev da frente B. A conta 2 pede confirmação para comandos que citem `sgo-prod`/`sgo-hml` (regras `ask` no settings de usuário da conta 2).
- **Plano do P3 Entrega** (`docs/superpowers/plans/2026-10-25-trilha-2027-p3-entrega.md`): US-013 em 3 partes, contratos C3 e C4 até ~30/10, papéis de hml/prod, US-014, US-015 e US-119. Revisão 12.12 em 3 rodadas. Decisões do PO (todas pela recomendação): `Refs #n` aceito no vínculo; deploy de prod sempre com aprovação do PO no *environment* `producao`; teste de papéis em `deploy/` via `vitest.config.ts`; trava de tag/aprovação/rollback no hook. Imagem de prod em pacote GHCR separado (`sgov2-prod`).
- O PO aceita a recomendação do Claude sempre que houver dúvida (25/10).
- O progresso da execução do plano fica em `.superpowers/sdd/<plano>/progress.md` (fora do git).
- **P3 da frente B na `main` (25/10):** Tarefas 1 a 5 e o Step 10 da Tarefa 4. Faltam as Tarefas 6 e 7, bloqueadas pelo GAP-INF-001, e a 8 (runbook).
  - **Tarefa 1, verificações de PR (#176):** "Fronteira de frente" e jobs de integração, migrations e scripts de operação.
  - **Contratos:** C3, componentes de tela em `ger` (#183); C4, e-mail por outbox (#184).
  - **Travas do P3 no hook (#187):** tag `v*`, aprovação de *environment*, `gh workflow run imagem.yml`.
  - **Imagem e deploy:** imagem e `imagem.yml` (#188). A origem do digest vem do artefato do run da `main` (#192), porque a atestação do GitHub não existe em repositório privado de usuário. Worker na imagem, com bundle esbuild, *healthcheck* por sinal de vida e webhook próprio (#197 e #198).
  - **Papéis de hml e prod (#191):** `deploy/postgres/01-papeis-ambiente.sql`. O dev ganhou o `docker/postgres/init/03-privilegios.sql`: sem TEMP, funções sem EXECUTE para PUBLIC e pgvector. **Volumes de dev já existentes só recebem o 03 se forem recriados ou com o comando do `docs/operacao/ambientes.md`. O volume da frente B (56432) ainda não tem nem o `sgo_fila`.**
- **Deploy (`docs/operacao/deploy.md`):** cada merge na `main` publica `sgov2:hml` e chama os webhooks de hml (por enquanto só avisa, sem webhook). O prod sai de tag `v*`, com aprovação do PO. Imagem única: CMD `app` ou `worker`.
- **Teste da imagem na VPS** (`docker/testes/testar-imagem.sh`): conferir antes que a outra frente não está rodando `vitest`/build (D12). Na sessão de 25/10, a frente B esqueceu de conferir uma vez.

**Repositório (documentação)**
- Spec oficial **versão 1.4** (1.1: rodada de revisão R1–R15; 1.2: rotina de code review §12.12; 1.3: propriedade de config, db, filas e tests/integracao na §12.3; 1.4: `prisma/schema/nucleo.prisma` da frente A). Status: aguardando a aprovação final do PO.
- Backlog: `docs/backlog/backlog-sgo-v2.md` e `.csv`, com 122 histórias (US-001 a US-122), 22 épicos e releases R0 a R9. Total de 1294 h (1557 h com contingência). O gerador fica em `docs/backlog/fonte/`.
- Planilha-modelo do orçamento 2027, com o gerador em `docs/modelos/fonte/`.
- Scripts de sincronização com o GitHub em `docs/backlog/fonte/github/`.

**GitHub**
- Issues: 22 épicos (#1–#22) e 122 histórias (#23–#143 e a US-122 em #145), ligadas como sub-issues, com dependências nativas ("blocked by"). O PR #144 (memória) usou o número seguinte.
- Labels:
  - tipo, prioridade, tamanho, modo e épico;
  - `trilha-2027`, `frente:A`/`frente:B` e `bloqueada-por-gap`;
  - do processo: `compartilhado`, `toca-outra-frente`, `migration`, `contrato` e `decisao`.
- Milestones R0 a R9 com as datas do cronograma: R0 15/12/2026, R1 13/01/2027, R2 04/01/2027, R3 27/01/2027, R4 16/03/2027, R5 12/04/2027, R6 19/05/2027, R7 07/06/2027, R8 24/05/2027, R9 27/01/2027.
- Projeto com os campos Tipo, Release, Prioridade, Tamanho, Modo, Frente, Trilha 2027, Épico, Horas, Ordem, Início e Fim. O Status está em português: A fazer, Em andamento, Em homologação e Concluído.
- Visões: o PO criou a **Cronograma** (Roadmap). Faltam **Quadro** (Board por Status, agrupado por Frente) e **Backlog** (tabela por Release, com soma de Horas).
- Proteção da `main`: PR obrigatório (0 aprovações, porque todas as contas usam o mesmo usuário do GitHub), vale para admins, histórico linear, sem force push e sem deleção, conversas resolvidas. Só *squash* e a branch é apagada após o merge.

**Protótipos (artifacts privados do claude.ai, só referência visual)**
- Orçamento da Adm. Central (v8): https://claude.ai/artifact/A9SEjticw6ourPCtWP4gfP
- Telas do sistema (v12): https://claude.ai/artifact/NrxtL5RZyRZRia9wGcemUg

## 6. Duas frentes (resumo da spec §12)

| | Frente A | Frente B |
| --- | --- | --- |
| Conta | conta 1 | conta 2 |
| Diretório | `/root/sistemas/sgo` | `/root/sistemas/sgo-b` (worktree) |
| Início | `claude` | `CLAUDE_CONFIG_DIR=/root/.claude-frente-b claude` |
| tmux | `tmux new -s sgo-a` | `tmux new -s sgo-b` |
| Épicos | EP00, EP04, EP05, EP09–EP16, EP18 | EP01–EP03, EP06–EP08, EP17, EP19–EP21 |

- **Período de fundação:** até as US-001 e US-004 entrarem na `main`, só a frente A escreve no repositório. A frente B começa depois, com a worktree e um texto de abertura que a frente A prepara.
- **Coordenação:** só pelo GitHub (quadro, issues, PRs). Ao encerrar uma sessão com trabalho aberto, deixar comentário de passagem na issue e atualizar este arquivo.
- **Guia de comandos:** `docs/backlog/desenvolvimento-em-duas-frentes.md`.

## 7. Pendências

**Do PO**
- [ ] Aprovar a spec. Depois disso, a frente A escreve o plano da F0 + F1 (writing-plans) e começa pela US-001.
- [ ] Criar no projeto as visões **Quadro** e **Backlog**.
- [ ] Priorizar o catálogo de IA (GAP-IA-001).
- [ ] **Até ~05/11/2026:** domínio, storage do backup externo e provedor SMTP (GAP-INF-001), que bloqueiam as US-014/015 da trilha.
- [ ] **Até ~16/11/2026:** aprovação dos CCs pela DIREX (GAP-CC-001), para a carga em prod.
- [ ] Planilha-modelo: obter os benefícios com a GRH e confirmar as premissas com a GFIN, antes de distribuir aos gestores.
- [ ] ISS sobre o rateio (GAP-ORC-007): "definirei depois".

**Técnicas**
- [ ] Após a US-013 (pipeline de CI), incluir o check de CI como obrigatório na proteção da `main` (`required_status_checks`, *strict*).
- [x] Na US-002, criar o `CLAUDE.md` com o resumo das regras da seção 2 e da spec §12, além dos hooks: bloquear `prisma migrate reset`/`db push`/`migrate diff` fora do dev, avisar se aparecer "CTCEA" e allowlist de comandos.
- [x] Na US-001, criar `.github/frentes.yml` (mapa de propriedade da spec §12.3).
- [x] Texto de abertura da primeira sessão da frente B (25/10).
- [x] Worktree `/root/sistemas/sgo-b` criada a partir da `main` (25/10, após o PR #169).
- [ ] PO: abrir a primeira sessão da frente B (`cd /root/sistemas/sgo-b && CLAUDE_CONFIG_DIR=/root/.claude-frente-b claude`, `/login` com a conta 2) e colar `docs/backlog/abertura-frente-b.md`.
- [ ] Autenticar os MCPs context7 e hostinger (`/mcp`), se forem usados.
- [ ] Frente B: copiar para a conta 2 as regras de `autoMode` da conta 1 (o classificador recusou a cópia pela sessão; o PO faz pelo `/config` ou aprova).
- [x] Frente B: PRs `compartilhado` antes das Tarefas 4 e 5 do P3 (#187).
- [ ] Frente B: registrar `Refs #n` na spec (v1.5).
- [ ] Frente B: plugin `superpowers` não está instalado na conta 2 (o plano do P3 foi escrito à mão, no formato do P1/P2).
- [x] Frente B, US-014 parte 1: script de papéis de hml e prod, com `sgo_fila`, `pgboss`, `REVOKE TEMP`/`CONNECT` e pgvector (#191). O PO roda o script na Tarefa 6.
- [ ] PO, antes de cadastrar segredos e da primeira tag: restringir o *environment* `homologacao` à `main`, que foi criado sozinho sem restrição, e criar o `producao` com o PO como revisor e só as tags `v*` (`deploy.md`, "Antes da primeira tag").
- [ ] PO, na Tarefa 6: segredos `EASYPANEL_WEBHOOK` e `EASYPANEL_WEBHOOK_WORKER` nos dois *environments* e `GHCR_PROD_TOKEN` no `producao`. Depois, incluir o check `Imagem` nos obrigatórios da `main`.
- [ ] Frente A: `statement_timeout`/`lock_timeout` nas conexões do worker (`src/shared/db`), sugestão da revisão do #198. Revisão de consumidor dos contratos C3 e C4.
- [ ] Frente B: subir as actions que ainda usam Node 20, que está sendo descontinuado (checkout, setup-buildx, login, build-push).
- [ ] Frente A: detalhar o plano do P5 (Acesso) com writing-plans.

**Com SMEs**
- [ ] Wellington: ISS, GAP-CAD-004/005 e GAP-CAR-005 (contas de obrigações e riscos trabalhistas).
- [ ] Adriana: GAP-APR-001.
- [ ] DIREX: aprovação do plano de centros de custo (GAP-CC-001 a 006).

## 8. Diário de sessões

| Data | Frente | Resumo |
| --- | --- | --- |
| 25/10/2026 | B | P3: verificações de PR (#176), contratos C3/C4 (#183/#184), travas no hook (#187), imagem e deploy (#188), origem pelo artefato do run da `main` (#192), papéis de hml/prod (#191), worker na imagem (#197/#198); revisão 12.12 em todos |
| 25/10/2026 | B | Abertura da frente B (ambiente de dev, regras de confirmação para sgo-prod/sgo-hml na conta 2); plano do P3 Entrega com os contratos C3 e C4, revisão 12.12 em 3 rodadas |
| 25/10/2026 | A | US-010 (worker, filas e outbox, #180/#181), fim do P1 Fundação com a `main` verde; menores na issue #182; merges do #176, #180 e #181 |
| 25/10/2026 | A | US-006 (Histórico append-only, #170/#171), US-008 (guarda de autorização, #174/#175) e US-009 (totalizador); spec 1.4 |
| 25/10/2026 | A | US-005: núcleo de dinheiro e lint contra `number` (dois PRs); spec 1.3 (§12.3: config, db, filas e tests/integracao da frente A); texto de abertura da frente B (worktree criada após o merge) |
| 25/10/2026 | A | US-004: Prisma 7, papéis de banco, trava do shadow e de comandos destrutivos; helper de Testcontainers com D12 (127.0.0.1, sem Ryuk); revisão 12.12 em 4 lentes |
| 25/10/2026 | A | US-003: compose de dev com limites de D12 (portas em 127.0.0.1, `mem_limit`/`memswap_limit`, nome do projeto obrigatório), revisão 12.12 em 3 lentes com uma rodada de correção |
| 24/10/2026 | A | Spec 1.2 com a rotina de code review (§12.12); planos P1/P2 escritos (PR #147); início do P1 Tarefa 1 por fluxo de agentes |
| 24/10/2026 | A | Rodada de revisão da spec (v1.1): D12 dev na VPS com mitigações e US-122; trilha 2027 como primeiro plano; C33–C36 (motor único, cargo texto livre, receita de transição, aprovador DIREX); prazos dos GAPs |
| 24/10/2026 | A | Revisão da especificação e spec oficial; plano de contas e CC de 5 níveis; protótipos de telas e do orçamento da Adm. Central; infra de IA e catálogo; backlog (121 histórias); trilha híbrida do orçamento 2027; planilha-modelo; processo de duas frentes (spec §12); publicação no GitHub (issues, milestones, projeto); push da spec para a `main` e proteção da `main`; criação desta memória |

## 9. Como atualizar este arquivo

- Ao fim de cada sessão: atualizar a data no topo, as seções 5 (estado) e 7 (pendências) e acrescentar uma linha no diário (seção 8).
- Decisão nova: registrar primeiro na spec (fonte normativa) e aqui só o resumo com a referência.
- Nunca colocar aqui senhas, tokens, dados pessoais nem conteúdo das notas pessoais da raiz do repositório.
- A alteração vai num PR próprio ou junto do PR da história da sessão. Se as duas frentes mexerem neste arquivo no mesmo dia, cada uma acrescenta só as suas linhas, e quem fizer o merge depois resolve o conflito mantendo as duas.
