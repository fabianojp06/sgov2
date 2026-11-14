# SGO 2.0 — Memória do projeto

> **Leia este arquivo no início de toda sessão** (frente A, frente B ou qualquer outra conta) e **atualize-o ao fim** da sessão, com a data, em PR. É o contexto compartilhado entre as contas do Claude Code: nenhuma sessão vê a conversa ou a memória local das outras.
>
> Hierarquia: a **spec** (`docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md`) é a norma. O **backlog** (`docs/backlog/`) é o que construir e em que ordem. Este arquivo é **estado, decisões recentes e pendências**. Em caso de conflito, vale a spec.

Última atualização: 14/11/2026 (frente B, madrugada: #469 e #473 a pedido da frente A, US-107 completa com #476, #484 e #488, conserto #482; US-099 bloqueada); 13/11/2026 (frente A, noite: P20 e US-070 pessoal da proposta #467, #92 fechada); 13/11/2026 (frente A, tarde: P19 e US-067 metas da proposta #461, #89 fechada; `semMarcas` linear #463); 13/11/2026 (frente B, manhã: US-118 #456, US-054 decidida, ensaios da US-119 parte 2 e autonomia das sessões na seção 2); 13/11/2026 (frente B, madrugada: US-048 parte 2 #447, US-052 impostos #448, US-047 agrupadores #449, US-022 #450 e #453, US-023 #451, teste frágil do cad #454; #44, #45, #69 e #74 fechadas); 13/11/2026 (frente A, US-066 versionar e duplicar a proposta #445, #88 fechada); 12/11/2026 (frente A, noite: GAP-CC-004 decidido, spec 1.7 #435; raiz 4 da Adm. Central #439; US-065 proposta de TP #440, #87 fechada); 12/11/2026 (frente A, P16: tela de correspondência #420, benefícios em lote #424, pendências menores do núcleo #425 e travas dos hooks #426; lint e guarda #430; #431 e #432); 12/11/2026 (frente B, hml no ar com deploy automático e monitor externo; #39 fechada; #406, #407, #408 e #412; à tarde, backup US-015 parte 1, runbook US-119 parte 1 e lote do C2: #417, #418, #421, #422 e #423); 12/11/2026 (frente A, P15 completo: #411, #413 e #414; issues #403 e #410); 11/11/2026 (frente B, US-024 completa com o PDF; US-018 e US-019, a infraestrutura de IA, na `main`); 10/11/2026 (frente B, P7: carga, metas de servidor e plano sintético; conferência da carga completa; US-024 em 3 partes; máscara do Histórico); 10/11/2026 (frente A, P8 na `main` depois da volta do CI; CSP completa; P9 planejado e na `main`: US-011, US-035, US-036 e US-033; P10: US-039 e US-041 parte 1; P11: US-057 pacotes base zero pela tela; à noite, P12: US-056 posições de pessoal pela tela; P13: US-037 perfis e permissões; pedidos da frente B na #138: exportação assíncrona do Histórico e meta do recálculo); 04/11/2026 (frente A, P8 planejado e implementado, merges esperando o CI); 04/11/2026 (frente B, P7 planejado e iniciado: plano, roteiro de homologação, conferência da carga, segurança e carga); 03/11/2026 (frente B, P4 completo na `main`, acréscimos ao C2 e ao C3 pedidos pela frente A, E2E no CI e seed no deploy; à noite, #302 e #221); 03/11/2026 (frente A, P6 completo na `main`, ressalvas do P5 e melhorias menores); 02/11/2026 (frente A, P5 Acesso na `main`, plano do P6 e P6 implementado em branches locais); 02/11/2026 (frente B, P4: pilha mergeada; à tarde, #222 com a M5, ambiente único, Node 24 no CI e as telas do plano de contas); 25/10/2026 (frente A, US-003 a US-010 e fim do P1; frente B, abertura, plano do P3 e Tarefas 1 a 5 do P3).

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

**Autonomia das sessões (PO, 13/11/2026, vale para as duas frentes).** Nas palavras do PO: "voce ta parando o tempo inteiro, para este tipo de parada voce tá autorizado a seguir sua recomendação não precisa parar".
- A sessão não para para confirmar escolhas entre opções, o próximo passo da fila ou o contorno de um bloqueio, nem para relatar etapas no meio da tarefa. Ela segue a própria recomendação, registra a decisão no PR ou nesta memória e responde no fim.
- Continua sendo preciso parar para: prod (`sgo-prod`, tag, aprovação do *environment*), segredo novo, gasto, ação irreversível fora do combinado e regra de negócio sem fonte.
- Commit e merge seguem a autonomia dada pelo PO em 12/11 (CI verde, comentário 12.12 e aviso na #138).

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
- **P4 da frente B (02/11): pilha mergeada na `main` pelo PO**, todos com a revisão 12.12 aprovada: #208 (US-025 parte 2), #209 (C1), #210 (C2), #212 (US-043 parte 1, leitor seguro de .xlsx), #214 (US-043 parte 2, plano de contas, staging e merge no worker como `sgo_sync`), #215 (US-043 parte 3, seeds), #217 (Task 4d, seeds no `prisma/seed.ts`), #216 (US-053 parte 1, parâmetros por exercício), #220 (US-046 parte 1, centros de custo), #225 (US-050 parte 1, Tabela Mestre), #226 (US-051 parte 1, motor real do C2), #219 (US-021 parte 1, Tree Grid) e #224 (documentação do C3). Na mesma tarde, também o #222 (US-021 parte 3, filtros, com a M5 decidida pelo PO: quem casa pela busca leva a subárvore).
  - **Mergeados em 02/11 à noite:** #240 (ambiente único), #241/#242 (Node 24 no CI), #244 (US-043 parte 4, tela de importação do plano), #245 (US-044, consulta em árvore) e #248 (US-046 parte 2, telas de CC com a trava da DIREX). **Aberto, com a revisão 12.12 (2 rodadas) e o CI verde:** #249 (US-053 parte 2, telas dos parâmetros e do SMN; o worker passa a ler o nome de exibição do `parametro_sistema`).
  - ~~**#221** (US-021 parte 2, exportação real)~~ **na `main` em 03/11 (`2bc237a`)**, depois do "de acordo" da frente A e da aprovação do PO na #223.
  - **Lições das telas (Task 7a):** o `tests/arquitetura/guarda-acoes.test.ts` exige `definirAcao` explícito em cada export de arquivo `'use server'`, então não há fábrica de ações (`criarAcaoConsultarCarga` do plano virou `consultarCargaDoGrupo`). Os avisos de saneamento só vêm na resposta do envio, e os da R5 só no lote. O `Formulario` do C3 não devolve o resultado da ação. As Tasks 8 e 12b reusam `acao-carga.ts`, `domain/arquivo-carga.ts` e `ui/importar-estrutura.tsx`.

  Pilha de PRs: depois de cada merge *squash*, rebasear o PR de cima com `git rebase --onto <nova main> <commit antigo da base>`. **Antes do merge, trocar a base dos PRs dependentes para `main`** (`gh api -X PATCH repos/fabianojp06/sgov2/pulls/N -f base=main`); senão o GitHub fecha o dependente quando apaga a branch de base (aconteceu com o #214 e o #221).
  - **Conflitos esperados no rebase sobre o #208:** `src/modules/ger/servidor.ts` (manter as duas exportações), `worker/index.ts` (manter os trabalhadores do ger e o processador de cargas) e `worker/build.mjs` (manter o metafile e o plugin `semArgon2`; o `worker/build.test.ts` reprova se o plugin sumir).
  - **Migrations novas do cad:** `202611021000_cad_plano_contas`, `202611021100_cad_parametros`, `202611021200_cad_centros_custo` e `202611021300_cad_beneficios`. O dev da frente B (56432) já está com as quatro, e o `migrate diff` dá zero.
  - **Desempenho:** a carga de 10.000 linhas leva de 15 a 26 s, contra o limite de 30 s (RNF_DES_003); a margem é curta com a VPS carregada. A auditoria em lote dependeria do `@/shared/audit`, da frente A.
  - **C3 mudou de lugar:** o `exportarXlsx` real sai só pelo `@/modules/ger/servidor`, porque o `index.ts` do ger vai para o navegador (Review Focus 10). Para usá-lo, chamar de `application/` (caso de uso ou `'use server'`), nunca de `app/`. O plano-mestre e o P3 já foram atualizados (#224); "de acordo" da frente A e aprovação do PO na #223, e o código entrou com o #221 em 03/11.
  - **Stub do argon2 no bundle do worker:** a seed do cad usa o `index.ts` do adm, que alcança o `@node-rs/argon2`. O conserto limpo é o `adm/servidor.ts` (#213).
  - **Revisão 12.12:** o plano permite no máximo 2 rodadas, depois disso o PO decide. A US-043 parte 1 (#212) teve 3 rodadas, e o PR registra isso.
- **P4 da frente B completo na `main` (03/11)**, com a autorização do PO para seguir as recomendações e fazer o merge, cada PR com a revisão 12.12 por agente independente e o CI verde:
  - US-053, telas de parâmetros (#249); US-050, inclusão e seletor de ano na Tabela Mestre (#254);
  - cargos: carga do Rubi com o salário real cifrado (12a, #261), telas e importação (12b, #267), tabela salarial e senioridades (12c, #270), benefícios do cargo com a sobrescrita pela Tabela Mestre (13, #272) e custo de 1 pessoa pelo motor, com o bloco do encargo (14, #274, fecha #73);
  - migrations novas: `202611031000_cad_cargos`, `202611031100_cad_tabela_salarial` e `202611031200_cad_beneficio_cargo`. O dev da frente B (56432) está com as 15, sem pendência.
- **Encargo do cargo (decisão pelo UC03.19 §6.1):** o consolidado é sobre a Fonte Ativa + adicional (5.000,00 + 1.500,00 → 3.315,00, 51%). A tabela de janeiro do bloco mostra também o encargo sobre férias e 13º provisionados (C33), com rótulo próprio.
- **Acréscimos aos contratos para a frente A (03/11):**
  - C3: `aria-invalid`/`aria-describedby` só com erro no Formulario e `LegendaComErro` (#278, #229); `AcaoConfirmada` no `ger` (#284, #230); leitor com várias abas (`lerPlanilhasSegura`, `indiceAba`, prazo único, até 10 abas; #279, #231) e células avulsas (`celulas: ['E1']`; #287, #232);
  - C2: `provedorSemaforo` para o `deps.semaforo` do `orc` e o teste da corrida da oficialização (#295, #234). A ordem dos locks nos benefícios do cargo foi corrigida no mesmo PR (linha do ano antes do cargo).
- **Plataforma (03/11):** job **E2E** no `ci.yml` (#292, #228: 18 passaram e 1 foi pulado); a imagem confere o Argon2 nativo e a ausência do Playwright (#297, #190); seed no deploy pelo serviço `migracao` com `implantar` (#299, #195; `docs/operacao/deploy.md`, "Seed e administrador inicial", com o break-glass).
- **Correções do `cad` (03/11):** Histórico dos cadastros globais sem TP, `sessaoUid` vazio recusado no lote e Zod em `ptBR` (#276); log das cargas sem valores da linha, porque o nome do cargo ia para o log (#288).

**P5 Acesso (frente A, plano `2026-10-25-trilha-2027-p5-acesso.md`): concluído na `main` em 02/11**
- PRs: compartilhado do P5 (#189), US-034 com o **contrato C6** (#193), seed no orquestrador (#194), US-026 login (#196, #200), US-032 logoff (#201), US-030 troca de senha (#203), US-031 tela principal, menu, seletor de TP e ajuda (#206), E2E de acesso (#235), US-038 parte 1, casos de uso de usuário (#236), e US-038 parte 2, telas (#237, fecha a #60). Todos com a revisão 12.12.
- **`src/modules/adm/servidor.ts`** (#236): entrada só de servidor do adm, com `instalarFuncionalidades` e `DeclaracaoFuncionalidade`. A seed do cad importa dele, e o stub do argon2 saiu do `worker/build.mjs`. Agora o `worker/build.test.ts` reprova qualquer argon2 no bundle. Isso resolve a #213.
- O #237 entrou com o GitGuardian vermelho, com a aprovação do PO: dois falsos positivos (`'adm.usuarios:incluir'` e `resetarSenha: acao`) em commits antigos do PR. O commit final já não tem os padrões. Os incidentes 39442399 e 39442400 continuam abertos no painel.
- **Ressalvas da revisão de bloco do P5 corrigidas em 03/11:**
  - itens 2 e 3 (#263): gerar nova senha para usuário bloqueado é recusado ("Desbloqueie o usuário antes de gerar nova senha" [PROVISÓRIO]), e a troca de senha pelo próprio usuário não muda mais a `versao` do cadastro;
  - itens 1 e 5 (#266): o Histórico do cadastro de usuários sai sem TP, e o `error.tsx` de `(sistema)` tem texto de página ("Não foi possível exibir esta página. Tente novamente ou contate o Administrador." [PROVISÓRIO]).
- Verificação manual da US-038 com o worker e o Mailpit (02/11), aprovada:
  - o cadastro chegou ao Mailpit;
  - o login com a senha temporária levou à troca obrigatória;
  - o job do pg-boss foi apagado e o outbox ficou publicado com os dados esvaziados.
- **Decisões do PO:**
  - o limite de login por IP conta só as falhas (NAT);
  - o E2E roda no contêiner oficial do Playwright;
  - em 26/10, ficaram aceitos como risco (1) o Administrador trocar o e-mail de um usuário e gerar nova senha, sem aviso ao e-mail anterior, e (2) a corrida entre o bloqueio pelo login e a proteção do último Administrador (o *break-glass* mitiga).
- **Regras do bloco para quem vem depois:**
  - componente cliente nunca importa o `index.ts` de um módulo com servidor; recebe ações e dados por props;
  - toda `page.tsx` de `(sistema)` começa com `await exigirPagina(...)`;
  - reset e desbloqueio de usuário usam a ação `alterar`;
  - o último Administrador conta só quem consegue entrar;
  - CC de escopo (C25) só com o perfil Gestor de Diretoria;
  - teste sem literal com cara de credencial (`x:y` ou `Senha: valor`), porque o GitGuardian acusa.
- **Textos [PROVISÓRIOS] da US-038**, para o PO validar:
  - "Este usuário está bloqueado por excesso de tentativas de acesso sem sucesso."
  - "Nova senha gerada e enviada para o e-mail do usuário."
  - "Usuário cadastrado com sucesso. A senha foi enviada para o e-mail informado."
  - "Usuário desbloqueado com sucesso"
  - "Versão do registro inválida. Recarregue a tela."
  - "Não foi possível concluir a operação. Tente novamente."

**P6 Orçamento da Adm. Central (frente A): completo na `main` em 03/11**
- **Plano:** `docs/superpowers/plans/2026-11-02-trilha-2027-p6-orcamento.md` (#238). As decisões D-P6-1 a D-P6-7 continuam pendentes do PO, e vale a recomendação.
- **PRs, todos com a revisão 12.12 e o CI verde:**
  - 02/11: C6 `exibirNoMenu` (#243, fecha a #211) e a US-055 parte 1, schema do `orc` com o CHECK do `enviado_por` (#247);
  - 03/11: seed do `orc` no orquestrador (#251), US-121 em três partes (#252 cálculo, #253 validação, #258 importação, fecha a #143), US-055 parte 2 (#255, fecha a #77), US-060 (#256, fecha a #82), US-058 (#259, fecha a #80), US-059 (#260, `Refs #81`), US-061 (#262, fecha a #83) e o E2E (#265).
- **E2E do P6 (#265):**
  - o `e2e/aut/semear.ts` roda as seeds reais na ordem do `prisma/seed.ts`, com o C1 e o C2 reais, e recusa banco que não seja o efêmero do teste;
  - usuários novos `gfin`, `direx`, `gestor` (escopo 4.1) e `semPermissao` (perfil criado só no teste: com as seeds do `cad` e do `orc`, todo perfil padrão tem menu);
  - seis cenários; o semáforo é conferido como "—" com o aviso até a #234;
  - E2E completo: 18 passaram e 1 foi pulado (a rolagem da frente B).
- **Para a frente B (#218):** o usuário `gfinPlano` já está semeado. O `e2e/cad/rolagem-plano.spec.ts` segue em `fixme`, porque a carga de 5.000 linhas depende do worker, que o E2E não sobe. A frente B decide se o plano entra pelo migrator ou subindo o worker.
- **Pendentes do P6:**
  - **Semáforo do teto:** entra por injeção até a Task 9a do P4 (#234). Por isso a #81 continua aberta.
- **Revisão de bloco do P6 (03/11):** três lentes independentes (plano/spec, segurança, testes/acessibilidade), todas "aprovado com ressalvas", sem bloqueante. Correções no #273 e no #275:
  - limites de texto contam caracteres como o `char_length` do banco;
  - com escopo, a importação recusa premissas desatualizadas e esconde o erro de CC de fora;
  - o Histórico da importação registra a versão das premissas;
  - testes que faltavam;
  - regiões vivas da importação; semáforo "Indisponível";
  - D-P6-7 marcada [PROVISÓRIA].
  - `/code-review ultra` do P6 continua opcional, a critério do PO.
- **CC de escopo pelo C1 (#264):** o cadastro de usuário recusa CC de escopo novo sem CC analítico ativo na subárvore ("CC de escopo sem centro de custo analítico ativo." [PROVISÓRIA]). O CC já gravado é mantido pelo Salvar, decisão nova para o PO validar.

**Repositório (documentação)**
- Spec oficial **versão 1.6** (1.1: rodada de revisão R1–R15; 1.2: rotina de code review §12.12; 1.3: propriedade de config, db, filas e tests/integracao na §12.3; 1.4: `prisma/schema/nucleo.prisma` da frente A; 1.5: decisões do PO no plano do P5; 1.6: limite por IP só com falhas de credencial, §11.2a, #257). Status: aguardando a aprovação final do PO.
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
- **Coordenação:** o registro oficial fica só no GitHub (quadro, issues, PRs); o aviso direto abaixo complementa, mas não substitui esse registro. Ao encerrar uma sessão com trabalho aberto, deixar comentário de passagem na issue e atualizar este arquivo.
- **Aviso direto entre frentes** (pedido do PO, 03/11): quando uma frente depende da outra, ela avisa a outra direto. O PO não leva recado. Avisar quando:
  - um "de acordo" for publicado;
  - um contrato (C1 a C5) mudar;
  - um merge afetar a outra frente (schema ou compartilhados);
  - uma frente ficar esperando uma entrega da outra.

  Canal:
  - primeiro, mensagem entre sessões (`ListAgents` e `SendMessage`). A sessão da frente A se chama `frente-a`; a frente B informa o nome da dela no primeiro aviso. Como cada frente usa uma conta própria (`CLAUDE_CONFIG_DIR`), a mensagem entre sessões pode não funcionar;
  - se a outra sessão não estiver alcançável, comentário na issue ou no PR do assunto (sem pedir autorização a cada vez: o PO autorizou os comentários de coordenação em 04/11; criar ou fechar issue e mudar label continuam com ele) e uma linha para o PO dizendo o que a outra frente precisa saber.

  O aviso informa e não pede mudança no código da outra frente (regra 9).
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
- [x] PO: merge do #249; o #221 depois da #223 (aprovação do PO na #223 e merge do #221 em 03/11; #223 fechada).
- [ ] PO, no `worker` de hml e prod: `SYNC_DATABASE_URL` com o `sgo_sync`, e o `app` **sem** ela; `AMBIENTE` no `app`, no `worker` e no serviço de migração (`docs/operacao/ambientes.md`). As variáveis da seed no deploy ficaram na #195.
- [ ] Frente A: ~~`adm/servidor.ts` (#213)~~ feito no #236; ~~usuário GFIN no `global-setup` do e2e (#218)~~ semeado no #265 (falta a frente B tirar o `fixme`); ~~`exibirNoMenu` no C6 (#211)~~ feito no #243; ~~"de acordo" com o `exportarXlsx` só pelo `servidor.ts` (#223)~~ publicado em 03/11.
- [ ] Frente B: filtrar o `meta` do Prisma no log dos lotes de cargos (Task 12a). O stub do argon2 já saiu com o `adm/servidor.ts` da frente A (#236), e a troca do `ambienteDoCad` está no #240. "Mostrar inativas" do plano de contas não é retido na sessão (pendência do #245). Pendências baixas registradas nos PRs: aria-invalid nos campos da DIREX com só o erro geral (#248); lista de campos blindados igual nas duas ações dos parâmetros (#249); sem jsdom, os formulários não têm teste de interação.
- [ ] Frente B, Tasks seguintes do P4: US-050 parte 2 (inclusão de benefícios pela tela e seletor de ano; reusar o `ui/seletor-ano.tsx` do #249), 12a a 12c (cargos), 13 e 14. Telas comuns já prontas: `ui/importar-estrutura.tsx` (com campos extras por `children`), `ui/arvore-estrutura.tsx` e `domain/arvore-tela.ts`.
- [x] Frente A: detalhar o plano do P5 (Acesso) com writing-plans.

**Frente A (03/11)**
- [x] **Decisões do PO de 03/11, todas pela recomendação:**
  - D-P6-1 a D-P6-7 validadas como estão no plano;
  - o CC de escopo já gravado é mantido pelo Salvar (#264);
  - na revisão de bloco do P6 (#298): o snapshot sem o salário de cada posição; o veto em pacote das contas que as premissas usam (encargos 4.1.1.8.x incluídos); e o `conferirSnapshot`;
  - dívida técnica:
    - a origem padrão da auditoria fica como está (login anônimo é ação de pessoa);
    - o Histórico não é truncado;
    - a unidade nas negações de funcionalidade global fica até existir funcionalidade por TP;
    - a tipagem do C5 será combinada com a frente B.
- [ ] PO: validar os textos [PROVISÓRIOS] (não houve recomendação):
  - os da US-038;
  - os das ressalvas do P5 (#263, #264, #266);
  - os das fronteiras de erro (#290);
  - os do semáforo e da importação com escopo (#273);
  - os textos de tela do `orc` fora do `MENSAGENS_ORC`.
- [ ] PO: marcar como falso positivo, no painel do GitGuardian, os incidentes 39442399 e 39442400 (#237).
- [x] Ressalvas da revisão de bloco do P5, todas corrigidas (issue #280):
  - 1 e 5 no #266;
  - 2 e 3 no #263;
  - 4 no #293: o `obterContexto` passa pelo `cache` do React, uma chamada do provedor por render. Medido no E2E de menu e logoff: 9 chamadas sem o cache, 5 com ele. Fora de um render (ação, rota), o cache só repassa.
- [x] Achados menores das revisões de 03/11:
  - fronteiras de erro da raiz em pt-BR (#290, compartilhado);
  - diálogos do `aut` com foco e Esc, sem `aria-modal` (#281);
  - um `<main>` só na área logada (#291, com teste que lê os arquivos da frente A).
- [ ] A negação auditada (`guarda.ts`) grava a unidade do contexto também para funcionalidade global. Por decisão do PO, fica até existir funcionalidade por TP.
- [ ] **Para a frente B:**
  - páginas do `cad` em `src/app/(sistema)/cad/` com `<main>` aninhado dentro do `main.sgo-conteudo` da casca (11 ocorrências; a frente A trocou as suas no #291);
  - `trabalhador-email.ts` (`motivoDoErro`): com o `ErroAuditoria` (#282), o log mostra só o nome, sem o código;
  - `cad/application/parametros.ts`, `beneficios.ts` e `importar-estrutura.ts` gravam o TP do seletor no Histórico de cadastro global (o adm passou a gravar nulo no #266);
  - `processador-cargas.ts` aceita `sessaoUid` vazio (o `auditar` passou a recusar no #268);
  - `acoes-parametros.ts` usa `z.locales.pt()`; as ações e o adm usam `ptBR` (#269).
- [ ] Melhorias menores, em parte feitas em 03/11:
  - #172: #268, #282 (`ErroAuditoria` fora do `ErroDominio`; `toJSON` recursivo) e #294 (`[omitido: alterado]`);
  - #177: #269 (Zod em pt-BR);
  - #165: #283 (shadow vazia; mensagens sem credencial) e #286 (proxy do prisma);
  - #168: #285 (expoente e dígitos do Decimal; mensagem escapada; `igual()`);
  - #182: #289 (testes de privilégios do `sgo_fila` e do índice do outbox).
  - O resto continua aberto: regex de credencial, tipos do C5 (a combinar com a frente B) e lint compartilhado.
- [x] "De acordo" da frente A no C3 publicado na #223, com a autorização do PO. À noite, o PO aprovou a mudança na #223, a frente B fez o merge do #221 (2bc237a) e a #223 foi fechada como concluída.
- [ ] Criação de issue e comentário em issue pelo agente: o classificador nega sem autorização explícita do PO. A #280 foi aberta com a autorização dele. Comentário de coordenação entre as frentes não precisa de autorização a cada vez (o PO autorizou em 04/11; seção 6, aviso direto). Criar ou fechar issue e mudar label continuam com o PO.
- [ ] D12: em 03/11, duas rodadas de E2E da frente A coincidiram com o `vitest` da frente B (o `flock` do #257 só vale para quem usa `npm run test:int`/`test:e2e`; rodar o vitest direto escapa do lock).

**Frente A (04/11)**
- [x] Na `main`, pela manhã: R10 com comparação do conteúdo das premissas (#309); semáforo real do teto (#310); importação com o leitor seguro e a versão do layout em `Instruções!E1` (#311); `AcaoConfirmada` do `ger` no `adm` e no `orc` (#312); Playwright com nova tentativa no CI (#314, compartilhado); credencial no Histórico pelo nome inteiro e trava do Histórico nas migrations (#315); aviso de referência circular (#316); memória de 03/11 (#304).
- [x] PO, 04/11: comentários de coordenação entre as frentes não precisam de autorização a cada vez (seção 6). O próximo bloco da frente A é o **P8, base de R0/R1** (plano no #325).
- [x] **P8 na `main` em 10/11.** O CI ficou parado por cobrança de 04/11, 10:22, até 10/11 (o PO regularizou). Merges, com o PO autorizando até 15:30: #325, #326, #327 (com o #328), #329 (com o #330), #331, #332, #333, #334 e #335. Os empilhados entraram por *squash* na branch-pai (merge commit é vedado no repositório), porque o #329 sozinho reprova a matriz de autorização do E2E (#322): a funcionalidade `adm.historico` entra no catálogo e a página só vem no #330. Conflitos com a `main` resolvidos como na integração local (`adm.prisma`, `apoio.ts`, `index.ts`/`servidor.ts`/seed do `adm`, `bundle-cliente`, `autenticar.ts`, `login/page.tsx`).
- [x] **PO, 10/11: valem as recomendações do P8.** D-P8-2 (a temporária da recuperação convive com a senha vigente, desvio aceito do UC02.18); D-P8-5 e D-P8-6 (alçada por fluxo, sem escopo e sem exigir perfil GFIN; só WA01, WA02 e WA05); D-P8-8 e D-P8-9 (Auditor no Histórico, só nas funcionalidades do perfil); limite de 3 pedidos de recuperação por hora por login e 100 por IP (é o que o código faz; o D-P8-4 do plano, com 20 em 5 minutos, ficou defasado); label `bloqueada-por-gap` retirada da #64 (WA03 e WA04 continuam esperando o GAP-APR-001).
- [ ] Textos [PROVISÓRIOS] novos: versão do layout da planilha (`Instruções!E1`); mensagens das alçadas (cadastro, exclusão, avisos, "mesmo usuário" fora de WA02); período e exportação do Histórico ("A exportação passa de 5.000 linhas…"); e-mail `usuario.recuperacao_senha`; temporária da recuperação vencida. PO, 10/11: ficam [PROVISÓRIOS] até a homologação da R1, que os confirma ou troca.
- [ ] Pendências do P8 para a R4: o worker e o Consolidado dos TPs precisam de caminho próprio na RLS; toda tabela de TP nasce com a política `ANY ((SELECT app_unidades())::uuid[])` (teste de catálogo no `rls-unidade.int.test.ts`); o Histórico ainda não recorta por TP nem mostra antes/depois (falta o contrato de máscara com o `cad`).
- [x] **CSP completa na `main` (#347), decidida pelo PO em 10/11:** *nonce* por requisição no `src/proxy.ts`, `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'unsafe-inline'` (atributos `style` nas telas), `upgrade-insecure-requests` só com `URL_PUBLICA` https; E2E `e2e/aut/csp.spec.ts` confere o *nonce* no HTML de cada tela. A frente B foi avisada na #138 para ativar a parte de CSP do `fixme` de `e2e/seguranca/cabecalhos.spec.ts`.
- [ ] HSTS no Traefik de hml e prod, quando houver domínio e TLS (GAP-INF-001, Tarefa 6 do P3), e não no app, porque o dev local é HTTP.
- [ ] Pendências da CSP (conferidas em 12/11, sem PR; decisão do PO):
  - `/_not-found` e `/_global-error` são estáticos e ficam sem *nonce*: o HTML aparece e o JS é bloqueado; no erro geral, o "Tentar novamente" não funciona, mas recarregar resolve. Corrigir mexe no `layout.tsx` raiz, que é compartilhado;
  - sem `report-to`: exige um endpoint público novo e um destino para os relatórios, que é da frente B;
  - `style-src` mais estrito (`style-src-attr`/`style-src-elem`): pede trocar os atributos `style` das telas.

**Frente A (10/11), P9: fecha a R1 da frente A** (plano no #349)
- [x] Na `main`: plano (#349); US-011, concorrência otimista e trava por recurso no núcleo (#350: `ConflitoConcorrencia`, `MENSAGEM_CONFLITO`, `exigirUmaLinha`, `travarRecurso`/`tentarTravarRecurso`); US-035, módulos e funcionalidades (#351, tela `adm.modulos`); US-036 e US-033, ativar e desativar o sistema com aviso e desconexão (#352, tela `adm.sistema`, migration `202611101000_adm_sistema_ativacao`).
- [x] Como funciona a desativação (D-P9-2 a D-P9-5): grava `manutencao` e o instante em que vale (agora + `desconexao_espera_min`, padrão 5); a casca mostra o aviso com contagem (polling de 30 s em `/aut/aviso`, sem renovar a sessão pelo cabeçalho interno `x-sgo-sem-renovacao`); depois do instante, a primeira requisição efetiva (`DELETE … RETURNING`, sob a trava `adm:sistema`), derrubando as sessões criadas antes do instante, menos as de quem desativou; com o sistema inativo, quem não é administrador cai sempre e administrador fica só com a Administração. Não há job no worker.
- [ ] PO valida (recomendações no plano e nos PRs):
  - desvios: Histórico da desativação gravado no pedido, sem fila (RNF0006); desativar módulo ou funcionalidade derruba na hora, sem a contagem do UC02.15 (RN0044); Histórico da desativação do módulo numa linha só, com a lista das funcionalidades;
  - espera de 0 a 60 minutos, padrão 5 (o zero existe para o E2E; produção pode exigir um mínimo, REQ0087); worker e sincronismo continuam rodando com o sistema inativo;
  - a RN0037 pede o motivo no aviso, mas o texto do UC02.01 2.7 não o traz (o código segue o 2.7); uma desativação cancelada aparece na grade como "Desativação" seguida de "Ativação";
  - textos [PROVISÓRIOS] novos: os do D-P9-7 e D-P9-10, as mensagens de sucesso e de "não encontrado" dos módulos, o limite de 500 caracteres do motivo, as descrições do Histórico da ativação, o título do modal e os rótulos da grade, e os textos de ajuda de `adm.modulos` e `adm.sistema`.
- [ ] Para a frente B: a `AcaoConfirmada` do `ger` precisa de um nome acessível com contexto (vários "Desativar" iguais na tela de módulos); o `cad` pode trocar o `MSG_CONCORRENCIA` e o `pg_try_advisory_xact_lock` do `processador-cargas` pelos auxiliares do núcleo (#350).
- [ ] Pendência: funcionalidade nova instalada pela seed num módulo inativo nasce ativa (sem efeito enquanto o módulo estiver inativo).
- [ ] PO: fechar a #142 (US-120) e a #25 (US-003), feitas e ainda abertas.

**Frente A (10/11, tarde), P10: Should da R1** (plano no #356)
- [x] Na `main`: plano (#356); US-039, exceções de permissão por usuário (#357, migration `202611101100_adm_usuario_excecao`, painel "Funcionalidade(s) do Perfil" no formulário de usuário); US-041 parte 1, configuração das notificações de desempenho (#358, migration `202611101200_adm_notificacao_desempenho`, tela `adm.notificacoes`).
- [x] Como funciona a exceção: só **retira** de um usuário uma funcionalidade que vem de um perfil dele (REQ0080; sem concessão fora do perfil nem por ação); filtro `NOT EXISTS` em `carregarPermissoes` (menu, guarda e Histórico); nunca em `adm.*` (para não trancar o último Administrador); o formulário manda as funcionalidades exibidas e só sai a exceção exibida e remarcada; mudar exceções derruba a sessão (RN0040).
- [ ] US-041 parte 2 (#63 aberta): o envio depende do realizado (US-085, GAP-PGD-006/009), de modelo novo no C4 e de job agendado no `worker/` (frente B), do indicador na tela principal (RN0077) e da escolha do canal.
- [ ] PO valida: D-P10-1 (só retirada; as referências do backlog da US-039 apontam UC02.21–24, mas a regra está no UC02.12/13 e na REQ0080/0081); D-P10-7 (notificações só para o Administrador, contra "Usuário Comum" no EP); D-P10-9 (Adicionar e Excluir gravam na hora, sem o "Salvar" da grade); limite em "% do orçado"; textos [PROVISÓRIOS] listados no #357 e no #358.
- [ ] Pendência: relatório de usuários com a coluna "Tem acesso?" (RN0061/REQ0090), quando a lista de usuários ganhar imprimir e exportar.
- [ ] Para a frente B: o index do `@/modules/ger` leva o `@/shared/kernel` inteiro (com decimal.js) ao bundle cliente das telas que usam a `AcaoConfirmada`; separar os componentes cliente do `ger` num ponto de entrada sem kernel reduziria o peso.

**Frente A (10/11, tarde), P11: pacotes base zero pela tela** (plano no #361)
- [x] Na `main`: plano (#361) e US-057 (#362, migration `202611101500_orc_pacote_tela`, tela `orc.pacotes`). O Gestor de Diretoria (no escopo) e a GFIN incluem, alteram e excluem pacotes com prévia do anual e das 12 parcelas; toda escrita trava o exercício e sobe a versão dele; premissas iguais recalculam só o pacote, premissas mudadas recusam o Gestor e recalculam tudo para a GFIN; `sgo_app` com UPDATE por coluna em `orc_pacote` (sem `origem`, `importacao_id`, `exercicio_id`).
- [x] **Muda a R7 do P6 (D-P11-7):** a reimportação substitui só os pacotes do CC com `origem <> 'TELA'`; os da tela ficam, e o relatório e o Histórico da importação contam os mantidos. A cópia de exercício grava os pacotes TELA como COPIA no ano novo.
- [ ] PO valida: D-P11-1 (Gestor e GFIN lançam; a GFIN lançar pela tela vai além da leitura que a §11.3 lhe dá), D-P11-2, D-P11-5, D-P11-6 (prévia calculada no cliente), D-P11-7 e os textos [PROVISÓRIOS] do #362 (o UC04.17 não é EP, GAP-ORC-004).
- [x] ~~US-056 espera o PO~~ **decidido pelo PO em 10/11 (recomendações seguidas):** (a) cargo em texto livre (C34); (b) salário e anual em claro só para quem inclui ou altera, mascarados para quem só consulta; (c) salário no Histórico, mascarado na consulta. Ver o P12.

**Frente A (10/11, noite), P12: posições de pessoal pela tela** (plano no #364)
- [x] Na `main`: plano (#364) e US-056 (#365, migration `202611101800_orc_posicao_tela`, tela `orc.posicoes`), no molde do P11: o Gestor de Diretoria (no escopo) e a GFIN incluem, alteram e excluem posições; a prévia do custo (massa, férias + 13º, encargos, benefícios, anual) é calculada **no servidor** pelo motor único do `cad` (C33), sem gravar; reimportação mantém as posições TELA; `sgo_app` com UPDATE por coluna em `orc_posicao`.
- [x] Sigilo: quem só consulta (DIREX, AUDITOR) não recebe do servidor salário nem anual da posição (com quantidade 1, o anual revela o salário); a `descricao` do Histórico nunca leva valor; `mascararHistoricoOrc` (`orc/domain/mascara-historico.ts`) fica pronta para a futura tela de detalhe do Histórico, composta na camada `app` (o `adm` não importa o `orc`).
- [x] Correção levada ao #362: ao alterar pacote ou posição cujo CC saiu da estrutura ativa, o seletor começa vazio (antes o navegador enviava a primeira opção e mudava o CC em silêncio).
- [ ] #78 continua aberta (PR com `Refs`): falta o critério "cargo do cadastro de C&S, salário pela Fonte Ativa (editável com log)", depois de 30/11, com a tela de correspondência da C34 e acréscimo no C2 da frente B.
- [ ] PO valida os textos [PROVISÓRIOS] do #365 (funcionalidade "Posições de pessoal", avisos, rótulos da prévia).

**Frente A (10/11, noite), P13: perfis e permissões** (plano no #368)
- [x] Na `main`: plano (#368, D-P13-1 a 12 e ajustes A1 a A12 da revisão) e US-037 (#369, migration `202611102000_adm_perfil_tela`, tela `adm.perfis`, só do Administrador). Perfil da tela tem código gerado `P_` + 12 hexadecimais (prefixo reservado); perfis padrão só se inativam (gatilho BEFORE DELETE recusa apagar código sem `P_`); ADMINISTRADOR não se inativa e as `adm.*` dele ficam fora do diff; `adm.*` recusado a outros perfis (menos `adm.historico` ao AUDITOR); o servidor monta a lista de funcionalidades exibidas (forjada → conflito); mudar permissões ou status sobe o `acesso_versao` dos usuários do perfil; seed resolve nome repetido com " (padrão)", " (padrão 2)"…
- [x] `desconectarOutros` (módulos) agora pega a trava `adm:administradores` antes do UPDATE em massa (impasse com `alterarPerfil`).
- [ ] Para a frente B (comentário na #137): `contarUsuariosPorPerfil` não conta os perfis `P_…` criados pela tela; a conferência da carga (`rel`) os omite. Proposta: item "Outros perfis" ou `codigo: string`; a frente A muda o `adm` num PR próprio quando a frente B escolher.
- [ ] Perfil criado pela tela não tem CC de escopo (C25 depende do código GESTOR_DIRETORIA): com permissões de lançar em `orc.pacotes`/`orc.posicoes`, lança em toda a Adm. Central; a grade avisa [PROVISÓRIO].
- [ ] PO valida: leitura de "sem espaços" como "não vazio após `trim`" (os nomes padrão têm espaço interno); textos [PROVISÓRIOS] do #369.
- [ ] US-027 (#49): conferida no código; só falta o aviso ao administrador no bloqueio (hoje vai ao log `[LOGIN_TENTATIVAS]`, D-P5-1), que precisa de modelo de e-mail no `ger` (frente B). As issues #62 e #64 (US-040 e US-042, entregues no P8) seguem abertas para o PO fechar.

**Frente A (10/11, noite), pedidos da frente B na #138**
- [x] Resposta na #138 para o gerador dos 5 exercícios (D-P7-3): anos 2000–2099 (exercício criado antes pela GFIN, Rascunho/Em Elaboração, premissas do ano), limites do leitor seguro (1 MiB, 20.000 linhas por aba, 30 s, 500 erros), layout `ADMC-ORC v1.0` e validações por aba.
- [x] #372: exportação do Histórico acima de 5.000 linhas em segundo plano (`agendarExportacao`, `GERADORES_EXPORTACAO_ADM` registrado no `worker/index.ts` com `toca-outra-frente`); o gerador (`adm/application/planilha-historico.ts`) reaplica na geração permissão, usuário ativo/sem bloqueio, alcance do perfil e filtros; teto de 100.000; sem antes/depois.
- [x] #373: meta da §10.3 no `orc/application/metas-desempenho.int.test.ts`: recálculo de 1.000 linhas com p95 de 438 ms; visão pelo TotalizerService com p95 de 144 ms.
- [x] Respostas da frente B (10/11, noite): modelo `usuario.alerta_tentativas` (#376), dono do pedido no `GeradorExportacao` e bundle do worker (#377), e na #137 a escolha de `codigo: string` com todos os perfis.
- [x] Fechamento na frente A: #380 (US-027 completa, #49 fechada: e-mail pela outbox a cada administrador ativo, sem bloqueio e com e-mail, no limiar e no bloqueio, depois do commit, em transação própria com `maxWait` de 500 ms e `timeout` de 2 s; nunca derruba o login; risco aceito de diferença de tempo só para login existente, porque o bloqueio já tem mensagem própria); #381 (`contarUsuariosPorPerfil` com todos os perfis: padrão na ordem do catálogo, depois os da tela por nome); #382 (o gerador do Histórico usa `pedido.usuarioId`; `usuarioId` nos parâmetros recusa o pedido).
- [ ] PO: o GitGuardian abriu o incidente 39920249 ("Username Password") num teste do #380 (`{ login: 'otto', senha: ERRADA }`, constante de teste). Falso positivo; o branch foi reescrito sem a linha, mas o incidente segue aberto no painel e pode ser marcado como falso positivo.
- [ ] Lição: num teste, não escrever `login: '<literal>', senha: <algo>` no mesmo objeto (o GitGuardian acusa); usar variável para o login.

**Frente A (11/11), P14: IA onda 1** (plano no #387)
- [x] PO liberou o GAP-IA-001 para a onda 1 (IA-01, IA-02 e IA-03); a label `bloqueada-por-gap` saiu de #84, #85 e #86.
- [x] **Coordenação com a frente B pela #138:** a frente A propôs a interface e recebeu a US-019 parte 1 (#386), a parte 2 (#388), o #389 e o `servicoIA.disponivel`, com o `padrao` de esforço por caso (#390). A frente A avisou antes do toque no worker e da `ANTHROPIC_API_KEY` no contêiner do worker.
- [x] #393 (US-063, #85 fechada): ajuda na justificativa do pacote.
  - O selo é "Gerado com IA – revisar", e o "Usar …" só preenche o campo.
  - O Histórico marca `origem = SUGESTAO_IA` (`deveMarcarSugestao`).
  - O botão aparece por `servicoIA.disponivel`.
  - Os 3 casos são instalados inativos, com esforço `medium`, `medium` e `low`.
- [x] #394 (US-062, `Refs #84`): sugestão de conta e CC.
  - O servidor confere a resposta contra as listas do `opcoesPacote`.
  - `avaliarSugestaoConta` e os 30 casos sintéticos estão em `orc/infrastructure/avaliacao`.
- [x] #395 (US-064, `Refs #86`): revisor antes do envio.
  - Roda no worker (fila `orc.revisar`, `orc_revisao`, migration `202611111600_orc_revisao`).
  - Regras R1 a R3 com `Dinheiro`. A IA chama como a pessoa, recebe apelidos `PAC-n`/`POS-n` e nada de pessoal.
  - A leitura filtra pelo que quem vê pode consultar.
  - O PR tocou o `worker/index.ts`, com `toca-outra-frente`.
- [x] Issue #403 criada com o ok do PO: avaliação em hml da sugestão de conta (IA-01). O avaliador entrou no #411, ligado à avaliação genérica da frente B (#406, fila `ia.avaliar`). O caso tem `avaliavel: true`, a seed dá `orc.ia_sugestao_conta:executar` ao ADMINISTRADOR, e o `worker/index.ts` registra `AVALIADORES_IA_ORC`, com `toca-outra-frente`. Sem permissão, o avaliador lança `ErroIA('ia.sem_permissao')`. Com o plano de contas vazio, devolve 0/total sem chamar a IA.
- [ ] Rodar a avaliação da #403 no hml, pelo botão "Avaliar a qualidade" da `/int/ia`, quando o hml subir. A frente B combinou o GAP-INF-001 com o PO para 13/11. A #84 fecha com ela.
- [ ] PO: validar os desvios da §4.4 (Server Action sem stream na IA-01/02; o revisor sem notificação no fim, com a página atualizando a cada 5 s) e os textos [PROVISÓRIOS] de #393, #394 e #395. Conferir também a conta do caso "licença do software de BI" (4.1.1.6.007).
- [x] #398 (contrato do `orc` para o gerador da frente B: `ABAS`, `CELULA_LAYOUT`, `importarPlanilha` no índice) e #401 (`/int/saude` pública no `proxy.ts`).

**Frente A (11–12/11), P15: C&S nas posições e regras de pessoal no revisor** (plano no #409, D-P15-1 a 8)
- [x] Contrato de C&S da frente B no #408 (`listarCargosExercicio` decifrado no app, `listarCargosSemSalarioCifrado` no worker e `beneficiosDoCargo`). A frente B pôs na seed os cargos SINT-001, SINT-002 e SINT-003 com Fonte Ativa e faixa (#412, revisado pela frente A).
- [x] #413 (US-056, `Refs #78`): cargo do cadastro na posição.
  - **Banco:** migration `orc_posicao.cargo_id`, sem FK.
  - **Formulário:** abre em "Escolha o cargo". Na trilha 2027, o texto livre continua aceito (C34). O salário vem sugerido pela Fonte Ativa só para quem tem `cad.salarios:consultar`.
  - **Recusas** só quando o `cargoId` muda.
  - **Custo:** o motor usa os benefícios e o adicional do cargo.
  - **Importação e cópia:** a importação grava `cargo_id` nulo; a cópia de exercício leva o cargo.
- [x] #414 (US-064, #86 fechada): R4 (sem benefício calculável) e R5 (salário fora da faixa, com `Dinheiro.comparar` estrito) no revisor do worker. O salário nunca vai à IA. Os achados com a marca `salario` só aparecem a quem tem `cad.salarios`.
- [x] #410: feita no P16 (abaixo).
- [x] `beneficiosDosCargos` em lote: a frente B entregou no #421, e a frente A trocou no #424.
- [ ] PO: validar os textos [PROVISÓRIOS] e as decisões de tela do #413 e do #414, e os riscos da D-P15-6 (o Gestor não recebe a sugestão da Fonte Ativa; a reimportação desfaz o vínculo; a troca no `cad` só vale no próximo recálculo).
- [ ] Lição (11/11): na pane do Actions, as execuções criadas durante o incidente ficaram órfãs (`queued`, 0 jobs, sem `cancel`/`rerun`). A saída é um push novo na branch, que pode ser um commit vazio. Bloqueio comum às duas frentes por mais de 20 min: quem notar investiga e posta o diagnóstico na #138 na hora.

**Frente A (12/11), P16: tela de correspondência do cargo em texto** (plano no #419, D-P16-1 a 8)
- [x] #420 (US-056, #410 fechada): `/orc/posicoes/correspondencia`.
  - **O que faz:** lista os textos exatos das posições sem cargo, com a sugestão pelo nome igual (sem diferença de acentos, maiúsculas e espaços), e liga de uma vez as posições de um texto ao cargo escolhido. O salário gravado não muda. O recálculo segue a alteração pela tela, e o Histórico grava uma `ALTERACAO` por posição.
  - **Quem usa:** só quem altera posição com escopo TOTAL (GFIN). O Gestor de Diretoria recebe 404. O link aparece na tela de posições.
- [x] #424: o `orc` usa o `beneficiosDosCargos` (#421) no recálculo do exercício e na R4 do revisor, com uma leitura das premissas por lote.
- [x] #425: pendências menores do núcleo (#165, #168, #177, #182): tipos, testes e comentários. O corpo do PR traz o estado item a item: a maior parte já estava feita, e o resto é compartilhado, da frente B ou decisão.
- [ ] **D-P16-7: a exigência do cargo do cadastro na posição só entra depois de 30/11 (C34)**, com o cadastro da GRH preenchido. A #78 continua aberta até lá.
- [ ] PO:
  - ANALISTA_GRH na tela de correspondência (D-P16-1);
  - textos [PROVISÓRIOS] `CORRESPONDENCIA_*`;
  - fechar a #218 (o `gfinPlano` já existe; tirar o `fixme` é com a frente B) e a #172 (só restam decisões);
  - avaliar o fechamento da #165.
- [x] #426 (`compartilhado`, com o de acordo da frente B): travas dos hooks das #154 a #161, mais os ajustes da revisão 12.12. Entre eles: só o subcomando conta como push, o push sem destino é bloqueado com a `main` em checkout, e `npm`/`yarn`/`pnpm` passam a avaliar o corpo dos scripts. Limite registrado: a defesa textual é parcial, e a proteção da `main` no GitHub continua sendo a barreira principal.
- [x] #430 (`compartilhado`, de acordo da frente B): lint de dinheiro e guarda (#168, #177).
  - **Lint de dinheiro:** `toPrecision` e `globalThis.parseFloat` barrados no `domain/` e no `kernel/`. `Number()` e `Math.*` ficam liberados de propósito, porque só convertem inteiros.
  - **Guarda:** `definirAcao` e `definirRota` precisam vir de `@/shared/authz`, e os configuradores da guarda só no `aut`, conferidos pelo nome das funções.
- [x] #431 e #432 (#165): o banco dos testes usa a imagem `pgvector` fixada no digest do CI e de hml/prod; o `$disconnect` da seed não esconde o erro.
- [ ] PO: o que sobrou das #165, #168, #172, #177 e #182 é decisão ou é da frente B. Elas podem ser fechadas, com o estado item a item no #425.
- [ ] Lição (12/11): o hook lê o comando inteiro, inclusive heredoc. Corpo de PR ou de comentário que cite comando vedado vai por arquivo, escrito com a ferramenta de escrita e passado com `--body-file`.
- [ ] Regra comum combinada no #423 (12/11): **migration destrutiva em dois passos**, primeiro expandir e numa release seguinte contrair, para o rollback por tag funcionar.

**Frente A (12/11, noite), R4 destravada: GAP-CC-004 e US-065** (plano P17 no #436, D-P17-1 a 10)
- [x] **GAP-CC-004 decidido pelo PO (12/11): CC próprio por TP** (C37, spec 1.7 no #435). Cada TP ativo tem um CC analítico único numa estrutura de TPs da árvore, fora da estrutura 4, carregado pela mesma fonte (D7, depois o Senior). A raiz real é com a DIREX/GFIN; até lá, `9` sintética **[PROVISÓRIA]**.
- [x] #439: o `orc` da Adm. Central vê só a raiz `4` do C1, pelo `estruturaDaAdmCentral` no `resolverDeps` e no avaliador. A proposta usa `deps.estruturaCompleta`. Foi pedido da frente B antes da seed `9.x` (#438).
- [x] #440 (US-065, #87 fechada): proposta de TP.
  - **Tabelas:** `orc_proposta` e `orc_versao_proposta` com RLS.
  - **O TP é a unidade:** a criação grava a unidade, o vínculo do criador (que sobe a versão do usuário), a capa, a Versão 1 em Rascunho e o Histórico.
  - **CC do TP:** fica em `unidade.cc`, com índice único entre os TPs ativos. O número do TP é único sem diferença de maiúsculas.
  - **Tela e permissão:** tela `/orc/propostas`, funcionalidade `orc.propostas` (ORCAMENTISTA escreve; GFIN, Auditor e DIREX consultam) e E2E sobre a seed `9.x`.
  - **Onde mora:** a proposta fica no `orc` da frente A (D-P17-1), com o de acordo da frente B.
- [x] #445 (US-066, #88 fechada; plano P18 no #443): versionar e duplicar a proposta.
  - **Duplicar:** cria um TP novo, com número e CC próprios, em Rascunho V1. O objeto ganha o prefixo "Cópia de ", e a origem fica intacta.
  - **Nova versão** **[PROVISÓRIA até a C16 reescrever o UC03.09]**: só a partir da última versão em Rascunho ou Em Elaboração.
  - **Concorrência:** toda nova versão trava a capa subindo a `versao`. Isso fecha a lacuna do #440.
  - **Exclusão:** só com **todas** as versões em Rascunho.
  - **Linhas:** o ponto de extensão `copiarLinhasDaVersao` fica vazio. Regra para as histórias de lançamento (US-067, US-070 a 072): **toda edição de linha sobe a `versao` da capa**.
- [ ] PO:
  - o avançar (UC03.10) não tem história no backlog; a proposta é que entre no plano da US-079;
  - validar a D-P18-1 (regra de versionamento) e os textos [PROVISÓRIOS] da duplicação e da versão.
- [ ] PO: validar as D-P17 e os textos [PROVISÓRIOS] da proposta; tirar a label `bloqueada-por-gap` das histórias da R4 que só dependiam do GAP-CC-004.
- [x] #461 (US-067, #89 fechada; plano P19 no #459): metas da proposta.
  - **Tabela:** `orc_meta`, ligada à **versão** da proposta, com RLS. O número é único na versão sem diferença de maiúsculas. A exclusão é física.
  - **Regras:** metas só na categoria Meta, com a última versão em Rascunho ou Em Elaboração. Toda operação sobe a `versao` da capa, e a recusa vem antes da trava.
  - **Cópia:** o `copiarLinhasDaVersao` copia as metas (RN_DUP_003).
  - **Para as US-070 e US-071:** `metaExigida(categoria)` e `metasParaLancamento(tx, versaoId)` já existem. Os lançamentos ligam à meta por FK RESTRICT (RN0136).
  - **Tela e permissão:** tela `/orc/metas` e funcionalidade `orc.metas` (Cadastros › Metas), com a matriz de `orc.propostas`.
- [x] #463: `semMarcas` do `orc` linear (pilha). A frente B achou um DoS por CPU na revisão do #462.
- [ ] PO, sobre as metas:
  - **D-P19-4 [PROVISÓRIA]:** a capa não tem teto. A tela mostra o total e o saldo, e a trava "soma das metas = Valor Global" fica para o envio (US-079). Falta confirmar se existe um "valor do contrato" digitado.
  - **D-P19-7 [PROVISÓRIA até o GAP-VIA-001]:** a RN_VIA_04 vale só na categoria Meta.
- [x] #467 (US-070, #92 fechada; plano P20 no #466): pessoal da proposta.
  - **Tabelas:**
    - `orc_empregado`: o empregado, inclusive a vaga "A CONTRATAR" com nome nulo;
    - `orc_qtde_empregado`: os quantitativos por período e documento.
    - As duas são ligadas à **versão**, com RLS. Têm FK RESTRICT para `orc_meta` e um trigger que exige a meta da mesma versão.
  - **Empregado:**
    - **Meta:** obrigatória e ativa na categoria Meta, ausente na Consolidada.
    - **Ordem:** por meta.
    - **Salário:** é a Fonte Ativa do cargo herdada ao salvar. Trocar o cargo herda de novo.
    - **Custo:** pelo motor único, ano a ano, só para quem lança. O cache de benefícios é **por ano**.
  - **Quantitativo:** as quantidades são contadas dos empregados que cruzam o período. Períodos da mesma meta não se sobrepõem.
  - **Cópia:** a nova versão copia tudo. A duplicação só copia o pessoal quando a categoria é a mesma, e só o que cabe na vigência nova. Essa é a emenda da D-P20-8 da revisão 12.12.
  - **Tela e permissão:**
    - telas `/orc/empregados` e `/orc/qtde-empregados`;
    - funcionalidades `orc.empregados` e `orc.qtde_empregados`: ORCAMENTISTA e ANALISTA_GRH lançam; GFIN, AUDITOR e DIREX consultam.
  - **Ficou para a US-080:** o [Finalizar Lançamentos], que envia ao WA05.
  - **Para a US-071:** a viagem deve ligar ao empregado por FK RESTRICT (RN0254), e o `excluirEmpregado` já trata o erro 23503. **Revisto no P21:** o Viagens V3 não tem empregado na viagem, e a RN0254 é da execução (diárias emitidas e adiantamentos). A ligação fica para a prestação de contas.
  - **Para a US-074:** o Valor Global soma o custo do pessoal.
- [ ] PO, sobre o pessoal:
  - **D-P20-4 [PROVISÓRIA]:** o ano sem parâmetros fica sem custo, com aviso, e o reajuste não acumula entre anos.
  - **D-P20-1 [PROVISÓRIA]:** os dependentes não mudam o custo, e não há hora extra nem periculosidade digitadas.
  - **D-P20-10 [PROVISÓRIA]:** a matriz de permissões.
  - O Vínculo Funcional na grade depende de o C2 expor o setor do cargo.
- [x] #471 (US-071, #93 fechada; plano P21 no #470): viagens da proposta.
  - **Tabelas:** `orc_teto_viagem` (Camada 1, por conta sintética) e `orc_viagem` (Camada 2), as duas ligadas à **versão**, com RLS. O custo não é gravado: sai da RN_VIA_03 na leitura.
  - **Teto (C6; decisão do PO de 13/11: informado) [PROVISÓRIO até o André]:**
    - É um teto por conta sintética, sem aninhamento entre elas.
    - As contas de passagem e de diária precisam estar sob um teto.
    - O consumido conta passagem e diária, sem o transporte (C19).
    - A viagem que passa do teto é recusada (E3).
    - O teto não fica abaixo do consumido e não sai enquanto houver viagem sob ele.
  - **Alterar (RN_VIA_07):** a meta e as contas de passagem e de diária ficam só leitura. A conta de transporte só é gravada com custo de transporte.
  - **Copiar:** abre a inclusão já preenchida.
  - **Painel:** cartões, composição e ranking por localidade, com barras em CSS.
  - **Cópia nas versões:** os tetos vêm sempre. As viagens vêm na nova versão e, na duplicação, só com a mesma categoria.
  - **Tela e permissão:** tela `/orc/viagens` e funcionalidade `orc.viagens`: ORCAMENTISTA e OPERADOR_VIAGENS lançam; GFIN, AUDITOR e DIREX consultam.
- [x] #475 (US-072, #94 fechada; plano P22 no #472): bens, serviços e equipamentos (CAPEX).
  - **Tabela:** `orc_bem`, ligada à **versão**, com RLS. O valor total = quantidade × unitário é calculado na leitura (RN0157).
  - **Grade:** por conta analítica em ordem crescente, com o subtotal e o total geral, e a opção de exibir os zerados.
  - **Exclusão (RN_PLA_11, critério "soft delete quando há snapshot"):** o bem copiado de versão anterior (`origem_id`) é **inativado**; o nascido na versão é apagado. O inativo sai dos totais e da cópia.
  - **Duplicação:** sem `origem_id`, só com a mesma categoria e só o que cabe na vigência nova.
  - **Filtro CAPEX (RN0411 e RN0419) [PROVISÓRIO]:** fica como ponto de injeção, `contaCapex` nas `DepsOrc`. O pedido para a frente B expor a natureza da conta está na #138; até lá, entra qualquer analítica ativa.
  - **Tela e permissão:** tela `/orc/bens` e funcionalidade `orc.bens`: ORCAMENTISTA lança; GFIN, AUDITOR e DIREX consultam.
- [ ] PO, sobre viagens e bens:
  - **D-P21-5:** o teto informado por conta sintética (e se o André confirma a C6);
  - **D-P21-3:** o transporte como pessoas × valor, fora do custo;
  - **D-P21-10 e D-P22-10:** as matrizes de permissões;
  - **D-P22-6:** a inativação do bem copiado.
- [x] #477: coluna Vínculo Funcional na grade de empregados (RN_EMP_008), herdada do cargo pelo `vinculoFuncional` do C2 (#469 da frente B). Só exibição [PROVISÓRIO]: a trava de divergência com o organograma fica de fora.
- [x] #480: filtro CAPEX dos bens pela natureza do C1 (#473 da frente B), com aviso enquanto nenhuma conta é CAPEX [PROVISÓRIO]; `listarEmpregados` com `semCusto` e `maximo` (padrão e teto 200), a pedido da frente B (US-107).
- [x] #479 (US-074, #96 fechada; plano P23 no #474): totalizadores e Valor Global calculado.
  - **Totalizadores:** árvore de contas só leitura (Orçado, Realizado zerado até a F5, Saldo, semáforo de 70, 85 e 95%), calculada na leitura pelo `totalizar()`. A conta fora do plano ativo vai a uma linha à parte.
  - **Valor Global:** a lista de propostas e as metas deixam de mostrar 0,00.
  - **Sigilo (D-P23-5):** quem não lança empregados não vê o pessoal no total nem no Valor Global, com aviso também nas listas.
  - **Refatoração:** o custo do empregado ano a ano saiu de `empregados.ts` para `custo-empregado.ts`, para evitar o ciclo metas → totalizadores → empregados.
- [x] #485 (US-073, #95 fechada; plano P24 no #481): rateio e ISS.
  - **Grade por versão:** a sintética mandante dá a base (o orçado dela, sem o próprio rateio; os destinos não podem estar sob a mandante), em modo % ou R$, com a trava E1 e o Replicar explícito.
  - **ISS:** a alíquota é guardada (2% a 5% no Contrato; o TP é imune). O **valor fica a definir** (GAP-CAD-001).
  - **Sigilo (revisão 12.12):** para quem não vê o pessoal, o E1 sai sem a base, só o modo R$ fica disponível e as células vêm sem o %.
  - **Mudança da D-P24-5:** a célula vazia não é declarada, e o zero digitado é gravado (CHECK `valor >= 0`), porque o envio exige todas as competências declaradas.
- [x] #489 (US-075, #97 fechada; plano P25 no #483): cronograma de desembolso.
  - **Cálculo:** parcelas mensais com acumulado, % sobre o Valor Global, repasse do ciclo de 12 meses e fechamento por ano civil, mais a previsão por conta e ano.
  - **Viagens sem data:** distribuídas por igual, com a parcela arredondada para baixo e o resto no último mês [PROVISÓRIO].
  - **Conferência:** a soma dos meses é igual aos Totalizadores.
- [x] #487 (US-078, #100 fechada; plano P26 no #486): Central de Tarefas, no módulo `apr` (primeiro código dele).
  - **Solicitação:** `apr_solicitacao`, roteada pela alçada, uma só pendente por alvo, sem DELETE.
  - **Decisão:** a rejeição exige justificativa (≥ 15 caracteres, sem repetição de caractere ou palavra) [PROVISÓRIO].
  - **Efeito no alvo:** é um **manipulador injetado pela página** (`src/app/(sistema)/apr/tarefas/manipuladores.ts`), para o `apr` não importar o `orc`.
  - **Vínculo:** o aprovador roteado é vinculado à unidade do TP no envio, para a RLS [PROVISÓRIO].
  - **Seed:** a funcionalidade `apr.tarefas` entra pelo `seedOrc`, porque o `prisma/seed.ts` é compartilhado.
- [x] Lição (14/11): o E2E das propostas passou a usar usuários próprios (`orc.propostas`, `gfin.propostas`). O spec entra uma vez por passo e estourava o limite de login por usuário (20 em 5 minutos), derrubando o teste de cabeçalhos da frente B.
- [x] Lição (14/11, #482 da frente B): **campo novo em tipo da porta pública entra opcional** quando há consumidor na outra frente. O `vinculoFuncional` obrigatório quebrou o typecheck da `main` pelo stub de teste da frente B.
- [x] #492 (US-079, #101 fechada; plano P26): avançar e enviar a proposta para oficialização (WA01).
  - **Banco:** `orc_snapshot_versao`, imutável. Um gatilho de transição da situação da versão vale só para o `sgo_app` (os testes antigos mudam a situação pelo migrator).
  - **Envio:** a varredura junta situação, alçada, pendente, células do rateio em branco, contas inativas, pessoal incompleto (o snapshot não se corrige depois) e imposto sem alíquota.
  - **RN_TAX_03 (combinado com a frente B na #448):** o snapshot congela as alíquotas de `impostosVigentes` no mês de início da proposta. **A seed traz o ISS sem alíquota:** sem a GFIN cadastrar a alíquota, nenhuma proposta oficializa. O E2E cadastra uma e a apaga.
- [x] #500 (US-080, #102 fechada; plano P27): o lote de pessoal para homologação (WA05).
  - O GRH finaliza (ação `executar` em `orc.empregados`), e empregados e quantitativos ficam só leitura. O GFIN homologa ou rejeita na Central.
  - **Cronograma:** o pessoal entra só com o lote Homologado.
  - **D-P27-8 (revisão):** com empregados, o envio do WA01 exige o lote Homologado.
- [x] #501 (US-081, #103 fechada; plano P28 no #496): a validação das viagens (WA02).
  - O Operador de Viagens pede, só com a versão Oficializada, e as linhas vão num lote (`orc_lote_viagem`, que guarda as viagens que levou). Um gatilho impede ligar a viagem a lote de outra versão.
  - **Cronograma:** só as viagens validadas. A correção de viagem rejeitada é pelo Termo Aditivo, porque a Oficializada não ganha nova versão.
- [x] #503 (US-068, #90; plano P29 no #502): a pré-visualização da proposta (UC03.38, só o "Corpo"; o resto do texto é cópia do demonstrativo de provisões). O rodapé não pode ser `<footer>`, que a regra de impressão esconde.
- [x] US-084, parte determinística (#106, IA-13; plano P30 no #504): o resumo do WA01 na Central compara com a versão anterior (o snapshot dela, se houver). A ajuda de IA para redigir a recusa fica para o GAP-IA-001.
- [ ] **US-082 (#104) parada,** com comentário na issue:
  - o C3 está "Bloqueante para F4" (Adriana);
  - a vigência fica na capa, e o aditivo de Prazo pede a vigência por versão;
  - as fases 2 e 3 do wizard são da F5;
  - a US-102 não existe.

  Proposta: fazer em duas partes quando o C3 sair.
- [ ] **US-076 (#98):** esperando o PO. O UC04.02 só existe no catálogo, e a spec põe Premissas/Reajustes na F5.
- [x] Lição (14/11): o build do Next falha em worktree com `node_modules` em symlink. Build e E2E só no sgo-p15, com `npx prisma generate` antes, porque o cliente gerado fica em `src/generated` de cada worktree.
- [x] Lição (14/11): o squash do PR anterior deixa o branch seguinte com commits duplicados. Para rebasear, usar `git rebase --onto origin/main <último commit da história anterior>`.
- [ ] PO, sobre as histórias desta madrugada:
  - **D-P23-2:** as faixas fixas do semáforo;
  - **D-P24-2 e D-P24-3:** a base do rateio sem circularidade e o modo por grade;
  - **D-P25-2:** as viagens distribuídas por igual no cronograma;
  - **D-P26-4 e D-P26-5:** o vínculo do aprovador à unidade e a leitura da "justificativa genérica";
  - **D-P26-1:** as contas analíticas ativas no lugar do sincronismo com o ERP.
  - **D-P27-2, D-P27-4, D-P27-5 e D-P27-8:** quem finaliza o pessoal, o efeito da homologação só no cronograma, a imutabilidade e o envio exigindo a homologação;
  - **D-P28-2 e D-P28-3:** o WA02 só com a versão Oficializada e todas as linhas num lote;
  - **D-P29-1 e D-P29-3:** quem pré-visualiza e a "fórmula" como origem do valor;
  - **D-P30-2 a D-P30-4:** a base da comparação, o teto e o rateio, e as faixas de atenção;
  - **produção:** a GFIN precisa cadastrar a alíquota do ISS antes da primeira oficialização.

**Frente B (03/11)**
- [ ] PO:
  - incluir o check **E2E** nos obrigatórios da `main` depois de algumas rodadas verdes (#292);
  - criar o serviço `migracao` (argumento `implantar`) em hml e prod na Tarefa 6. Até o webhook dele existir, o *redeploy* do `migracao` é manual antes do `app`, e o log é conferido à mão (`[IMPLANTAR_CONCLUIDO]` × `[ADMIN_INICIAL_*]`);
  - ~~decidir se os benefícios do cargo passam para o exercício novo~~ **decidido pelo PO em 03/11 (recomendação seguida):** o `criarParametrosDoAno` copia do ano-base o ativo/inativo, o valor manual e a origem (`MANUAL` continua `MANUAL`, para o GRH revisar), inclusive de cargo inativo, com um Histórico do exercício e a linha do ano-base presa durante a cópia (#302). Quando houver tela do Histórico, o `valorManual` de `cad.cargos` deve sair mascarado sem `cad.salarios:consultar` (R24);
  - ~~marcar como falso positivo, no GitGuardian, os incidentes 39444187 e 39442400 do #221~~ **feito pelo PO em 03/11**;
  - ~~fechar a #223~~ **fechada pelo PO em 03/11**, depois do #221 na `main`.
- [ ] **Para a frente A:**
  - ~~trocar as cópias da `AcaoConfirmada` do `adm` e do `orc` pela do `ger`~~ **feito pela frente A (#312)**;
  - ~~na importação do `orc`, usar `lerPlanilhasSegura` com o `indiceAba`~~ **feito pela frente A (#311)**;
  - injetar `provedorSemaforo` de `@/modules/cad` no `deps.semaforo` de produção (#295);
  - ~~R10: a carga do plano de contas muda as premissas sem subir a versão~~ **tratado pela frente A (#309)**;
  - ~~`retries` e o reporter `github` no `playwright.config.ts`~~ **feito pela frente A (#314)**;
  - `adm/servidor.ts` e `orc/servidor.ts` para a seed: um `server-only` num `application/` do `adm` ou do `orc` quebraria o bundle da seed (#299);
  - `guarda.ts` ainda grava o TP na auditoria de negação de cadastro global (revisão do #276).
- [x] Frente B, #221 (exportação XLSX real): na `main` em 03/11, à noite (`2bc237a`). Não foi preciso recriar a branch: com os falsos positivos marcados pelo PO, bastou um merge da `main` (árvore conferida contra a testada) e o *squash*. A #233 (texto que vira fórmula) já está coberta no XLSX pelo M2 do #221; fica aberta só pelo CSV do `rel` e é o **próximo item da frente B (04/11)**, sem dependência de ninguém.
- [ ] Rolagem do plano de contas (`e2e/cad/rolagem-plano.spec.ts`) continua em `fixme`: a tela não tem `expandir=todos`, o plano oficial tem 174 contas e o spec do `cad` roda antes do do `orc` no mesmo banco. Recomendação para o PO: medir em hml pelo plano B do próprio spec (Chrome DevTools › Performance, 5 s rolando o plano de 5.000 linhas expandido; FPS médio ≥ 55 e nenhuma tarefa longa acima de 50 ms).
- [ ] Pendências baixas registradas nos PRs de 03/11: dois CONSULTA de `cad.salarios` por abertura da tela do cargo (#274); a tela do cargo sem seletor de ano (#274); sem jsdom, o foco da `AcaoConfirmada` e o efeito do aria do Formulario não têm teste de interação (#278, #284); nenhum passo da imagem faz login com senha (#297).
- [ ] US-119 (runbook, #141) depende das Tarefas 6 e 7 (deploy real e backup), bloqueadas pelo GAP-INF-001. ~~US-122 (#145): falta repetir o teste dos hooks numa sessão nova~~ **feito em 04/11:** as travas de produção, da `main` e de banco bloquearam (comentário na #145).
- [x] Comunicação entre as frentes (PO, 03/11): quando for necessário, cada frente fala direto com a outra, sem o PO de mensageiro. Usa `SendMessage` se a sessão da outra aparecer no `ListAgents`; senão, comenta na issue ou no PR do assunto. Para esses comentários de coordenação, não é mais preciso pedir autorização ao PO, como dizia a regra do canal entre as frentes acima. Fechar ou criar issue, mudar label e decisões do PO continuam com o PO.
- [x] D12 (nota): nas primeiras rodadas de 03/11, a frente B rodou integração com `npx vitest` direto, fora do `flock`; depois passou a usar `npm run test:int`, que respeita o lock.

**Frente B (04/11)**
- [ ] **PO:**
  - ~~**carga de desempenho:** dar o ok para a primeira rodada do `ops/carga/rodar.sh` no dev local (D-P7-1; 20 usuários, cerca de 3 min, `--memory 256m`). A frente B não roda sem o ok, porque a VPS é a mesma da produção~~ **ok do PO em 04/11; rodada feita (#324)**;
  - **decisões D-P7-1 a 8** do plano do P7 (#307): sem objeção, valem as recomendações. A D-P7-6 diz que, sem o GAP-CC-001, o orçamento segue pelo plano B e o go-live espera; a §6.1a e a R16 proíbem a minuta em prod;
  - ~~**`X-Powered-By: Next.js`:** é um achado baixo da US-116 (#318). A correção é `poweredByHeader: false` no `next.config.ts`, num PR compartilhado, e a frente B abre com o ok do PO~~ **corrigido com o ok do PO em 10/11 (#337, teste ligado no #340)**;
  - **`alerta-memoria.sh`:** reinstalar na VPS depois do #308 (`install -m 0755 ops/vps/alerta-memoria.sh /usr/local/sbin/sgo-alerta-memoria`), para a URL do webhook sair do `ps`;
  - **homologação:** criar a label `homologacao` antes da issue da R1 (D-P7-4).
- [ ] **Para a frente A:**
  - ~~**conferência da carga:** o contrato `contarUsuariosPorPerfil(tx)` no `adm/servidor.ts` para a seção de usuários. A proposta está na #137~~ **feito pela frente A (#335)**, usado no #344;
  - ~~**`e2e/aut/semear.ts`:** acrescentar a `seedRel`, porque sem ela a tela do `rel` fica fora da matriz de autorização (#322). Pedido na #137~~ **feito pela frente A (#335)**;
  - ~~**`main-unico.test.ts`:** tirar a exceção `${SISTEMA}/cad` do `FORA`, porque as páginas do `cad` já não abrem `<main>` (#320)~~ **feito pela frente A (#335)**;
  - **CSP completa e HSTS:** no `proxy.ts` ou no Traefik (PO). O teste está em `test.fixme` no `e2e/seguranca/cabecalhos.spec.ts` (#318).
- [ ] **Frente B, próximos passos do P7:**
  - ~~Task 2 parte 2: a seção de usuários, depois do contrato do `adm`~~ **feito em 10/11 (#344)**;
  - ~~Task 3: a primeira rodada da carga (com o ok do PO) e as metas de servidor por teste de integração com tempo (escrita simples, recálculo e exportação de 5.000 linhas)~~ **feito em 10/11 (#324, #338); o recálculo foi pedido à frente A (bloco de 10/11)**;
  - Task 4: o ZAP (ativo no dev local, *baseline* em hml);
  - Tasks 5 a 7: dependem da Tarefa 6 do P3 (GAP-INF-001).
- [x] **Lições de 04/11:**
  - **`server-only` no `servidor.ts`:** o `servidor.ts` de um módulo nunca pode alcançar um arquivo com `server-only`, porque o worker e a seed caem fora do Next. Quem mexer em `servidor.ts` roda o `worker/bundle.test.ts` (o #317 caiu nisso na primeira versão);
  - **GitHub instável:** com o incidente, o push por SSH falhava. O contorno foi `git -c credential.helper='!gh auth git-credential' push https://github.com/fabianojp06/sgov2.git <branch>`, e o merge pela API REST (`PUT pulls/N/merge` com `sha`) quando o GraphQL falhou;
  - **revisores em subagente:** o prompt diz explicitamente "não rode `git checkout`/`git switch` em `/root/sistemas/sgo-b`". Um revisor fez isso uma vez e voltou; a cópia principal foi conferida.

**Frente B (10/11)**
- [x] **CI:** o GitHub Actions ficou parado por cobrança de 04/11 a 10/11. O PO regularizou, e o CI voltou em 10/11 (o #324 rodou de novo).
- [ ] **PO:**
  - **coluna "Selos" na exportação dos CCs (#346):** as colunas "De gestão" e "Provisório" da parte 2 viraram a "Selos" da tela. Se a GFIN preferir as duas colunas, a frente B as devolve só na exportação;
  - **perfis com `exportar`** no plano de contas e nos CCs (#343): GFIN, Orçamentista e Auditor; a DIREX e os demais só consultam (§11.3). Ajustar se a GFIN pedir;
  - continuam do bloco de 04/11: reinstalar o `alerta-memoria.sh` e criar a label `homologacao`;
- [ ] **Para a frente A** (pedidos na #138):
  - **exportação assíncrona no Histórico** (o "de acordo" no `fila.ts` veio em 10/11, e o #354 entrou): quando servir ao Histórico (`adm/historico/exportar`), dá para trocar a recusa acima de 5.000 linhas pelo `agendarExportacao` e um `GeradorExportacao` do `ger/servidor.ts`;
  - a meta do recálculo do exercício (≤ 2 s para 1.000 linhas analíticas), num `*.int.test.ts` do `orc`, no formato do `cad/application/metas-desempenho.int.test.ts`;
  - para a base de referência da D-P7-3: confirmar se a importação do `orc` aceita os exercícios de 2028 a 2031, o limite de linhas e as validações que um gerador da planilha-modelo precisa conhecer;
  - quando a tela do Histórico mostrar `antes`/`depois`: usar o `mascararHistoricoCad` (#339) e registrar o `CONSULTA` de `cad.salarios` quando `contemSalario` vier `true` (R24). O aviso está no #330.
- [ ] **Frente B, próximos passos:**
  - **P7, Task 3:** o gerador dos 5 exercícios (depois da resposta da frente A) e a medição da Tree Grid sobre o plano de 5.000 linhas (`ops/carga/gerar-plano.ts`, #341). Atenção: a seed com `CARGA_DADOS_REFERENCIA=1` inativa o ramo `9` (README da carga);
  - **P7, Task 4:** o ZAP (ativo no dev local, com o ok do PO, porque pesa na VPS; *baseline* em hml, depois da Tarefa 6 do P3);
  - **US-024 (#46) concluída (11/11):** o PDF (ISO 32000-1, `pdf-lib`) entrou no #383, nas telas e em segundo plano. Antes já tinham entrado os testes pendentes do #354 (#367) e o aviso por e-mail (#371). Decisões provisórias do #383: teto do PDF de 20.000 linhas (acima disso, só XLSX ou CSV), A4 paisagem com Helvetica (o texto fora do WinAnsi é trocado) e PDF de 5.000 linhas em 2,3 s no dev;
    - decisões provisórias do #371: o aviso vai também na falha; o pendente que a limpeza marca como "sem resposta" não avisa; pessoa inativa fica sem aviso; destinatário inválido só vai para o log (`[EXPORTACAO_AVISO_NAO_ENVIADO]`);
    - decisões provisórias do #354: teto de 100.000 linhas, 7 dias de disponibilidade, pendente há mais de 2 h vira falha, no máximo 3 pedidos em geração por pessoa, limpeza no worker a cada 15 min e a tela `/rel/exportacoes` com `consultar` para todos os perfis;
  - **Infraestrutura de IA concluída (11/11):**
    - **US-018 (#40):** porta `ProvedorIA` com os adaptadores Anthropic e falso (#385).
    - **US-019 (#41):**
      - governança (#386);
      - tela de cadastro `/int/ia` (#388) e sua seed (#389);
      - `servicoIA.disponivel` e o `padrao` de cada caso (#390).
    - **Contrato para os módulos (avisado na #138):** só pelo `servicoIA` de `@/shared/ia`. O `criarProvedorIA` não é exportado. Cada caso de uso é uma `DefinicaoCasoUsoIA` no código do módulo, com funcionalidade própria e ação `executar`, e é instalado pela seed com `instalarCasosUsoIA`. Tudo nasce desligado.
    - **Decisões provisórias da frente B:**
      - modelo `claude-opus-5-5` com o fallback do servidor ("default");
      - tabelas `ia_*` no `int.prisma` e a tela no módulo `int`, menu Cadastros, log Simples;
      - custo estimado em inteiros de 1e-8 dólar pelo preço de lista; modelo fora da tabela paga o do mais caro;
      - reserva (`ia_reserva`) sob trava do banco: o limite por minuto e o teto contam as chamadas em curso. Sem o uso real, o registro leva a estimativa da reserva, que erra para cima;
      - teto conferido antes da chamada; zero vale como teto não definido, e a IA fica desligada;
      - instrução e schema de saída no código, versionados; no banco, a versão e a configuração;
      - `SISTEMA_IA` só no worker e nos trabalhadores de fila. O revisor da frente A (IA-03) roda como a pessoa que pediu;
  - **A partir de 30/11:** a frente A vai pedir um acréscimo no contrato do cadastro de C&S para a parte restante da US-056 (cargo escolhido do cadastro, salário pela Fonte Ativa);
  - Tasks 5 a 7 do P7: dependem da Tarefa 6 do P3 (GAP-INF-001).
- [x] **Lição de 11/11 (frente B):** a frente A ficou esperando uma resposta na #138, e o PO precisou cobrar. Regra: a comunicação entre as frentes é proativa e não depende do PO. Ler as issues de coordenação no começo de cada tarefa e depois de cada merge, responder na hora, avisar de cada merge que afeta a outra frente e nunca deixar nada parado à espera dela.
- [x] **Lições de 10/11:**
  - **Prettier:** o projeto não tem configuração do Prettier. Rodar `npx prettier --write` reformata o arquivo inteiro com aspas duplas (aconteceu no #342, corrigido no #343). Não usar; se precisar, `--single-quote --print-width 160 --trailing-comma all --object-wrap collapse` reproduz o estilo;
  - **matar processo por nome:** o classificador barrou um `kill` pelo nome `next-server`, porque poderia derrubar o dev da frente A. Parar só pelo PID do processo que a própria sessão subiu;
  - **Playwright no host:** o Chromium não roda direto no host (faltam bibliotecas); usar a imagem oficial, como o E2E e o `ops/carga/rodar.sh`;
  - **`gh pr checks`** nesta versão não aceita `--json`; usar `gh run list --commit <sha>` ou `gh pr view N --json statusCheckRollup`. O `gh pr edit` falha com o aviso dos Projects (classic); editar o corpo pelo `gh api -X PATCH repos/.../pulls/N -F body=@arquivo`.

**Com SMEs**
- [ ] Wellington: ISS, GAP-CAD-004/005 e GAP-CAR-005 (contas de obrigações e riscos trabalhistas).
- [ ] Adriana: GAP-APR-001.
- [ ] DIREX: aprovação do plano de centros de custo (GAP-CC-001 a 006).

**Frente B (13/11, madrugada; autonomia do PO até 06:00)**
- [x] Na `main`:
  - #447: US-048 parte 2, vínculo do cargo e "pendente de alocação";
  - #448: US-052, impostos e alíquotas com vigência, #74 fechada. O C2 ganhou `impostosVigentes(tx, 'AAAA-MM', { tipo })` e o tipo `AnoMes`. A proposta congela o percentual na US-079 e bloqueia a oficialização com `percentual: null`, combinado com a frente A;
  - #449: US-047, agrupadores de contas, #69 fechada. Exigem duas analíticas ativas, garantido por constraint trigger diferido; a exclusão leva as vinculações, e a referência futura vai com FK RESTRICT (RN_PLA_010). A leitura `agrupadoresDeContas` é para o `rel`;
  - #450 e #453: US-022, #44 fechada. A falha da ação no `Formulario` vira mensagem, e entrou a prop `aoSucesso`. O E2E derruba a rede e foi ligado depois do #452 da frente A (menu com rolagem própria e `seedInt` no E2E);
  - #451: US-023, #45 fechada. A `AcaoConfirmada` ganhou `impacto` e a lista de impeditivos (`impeditivos()` e `CAMPO_IMPEDITIVO` do `ger`).
- [ ] #454: o teste de vazamento do `importar-cargos` com falso positivo, porque o envelope, um uuid ou um timestamp podiam conter "7500". Merge depois do CI.
- [ ] **PO:**
  - **US-054 (#76):** sem regra fechada. O refinamento recomendado está no #76: um agrupador ou sintética, mais um imposto vigente, como total especial do `rel`, depois dos relatórios;
  - **US-118:** a proposta é o manual por perfil gerado do catálogo (as ajudas e as ações), dentro do sistema. Toca o menu e o layout (frente A);
  - continuam as pendências do PO da frente B de 12/11.

**Frente B (13/11, manhã)**
- [x] #456: US-118, o manual por perfil e o roteiro de treinamento em `/rel/manual`, gerados do catálogo e das permissões; #140 fechada. O link "Manual" na barra de status entrou pela frente A no #457.
- [x] #454 na `main`.
- [x] **US-054 (#76):** o PO aprovou a recomendação. O escopo mínimo é um agrupador ou sintética, mais um imposto vigente, como total especial do `rel`. Começa depois dos relatórios US-096 a 098 e dos exemplos reais da GFIN.
- [x] **US-119 parte 2, ensaios possíveis sem prod e sem storage:** o rollback do app no hml (de #457 para #456 e de volta, cerca de 10 s cada, saúde `ok`) e a restauração do dump cifrado com o banco de dev (tabelas, linhas e privilégios iguais aos da origem). As correções ao texto estão no runbook. O rollback de prod e a restauração pelo storage continuam pendentes do PO.
- [x] #460: conferência da VPS (US-122 e US-016). Faltam o teste de pico de memória (o classificador da sessão bloqueou e ele precisa da autorização do PO) e o SSH só por chave (o `authorized_keys` está vazio e o PO entra por senha: primeiro ele cadastra a chave).
- [x] #462: US-108, a ajuda "como faço..." em `/rel/manual`. A IA responde só com o manual do perfil, e a tela mostra os trechos citados com o texto do catálogo; #130 fechada. **GAP-IA-002:** o manual de um perfil cabe na mensagem, então a ajuda funciona sem embeddings. O caso `rel.ia_ajuda_manual` nasce desligado (o Administrador liga em `/int/ia`), e a seed já rodou no hml. A revisão 12.12 achou um DoS por CPU no `semMarcas` (laço quadrático sem limite de tamanho), corrigido no `rel` e avisado à frente A na #138, porque o `orc/domain/texto.ts` tem o mesmo padrão.
- [x] #464: o roteiro da carga inicial aponta para a tela `/cad/instituicao` (#437). O ensaio da US-115 no hml depende do PO: o banco recriado vazio (regra 3), o SMTP e os arquivos reais.

**Frente B (13/11 noite e 14/11 madrugada; o PO autorizou seguir sem parar até 14/11, 13h)**
- [x] #469: o C2 expõe o `vinculoFuncional` do cargo (`CargoExercicio`), a pedido da frente A para a RN_EMP_008.
- [x] #473: o C1 expõe a natureza OPEX/CAPEX (`NoConta.natureza`, `contaAnaliticaCapex` no índice e `CONTAS_CAPEX_EXEMPLO`), a pedido da frente A para a US-072. A migration nova dá `SELECT` em `conta_parametro_local` ao `sgo_sync`.
- [x] #476, #484 e #488: **US-107** (#129), a análise do quadro de pessoal com IA em `/rel/quadro-pessoal`, só com agregados.
  - **Parte 1:** as propostas, pelo `listarEmpregados` da frente A, com o `maximo` do #480.
  - **Parte 2:** a Adm. Central por diretoria, pelo `listarPosicoes`.
  - **Regras de privacidade** (duas revisões independentes, dois achados críticos corrigidos): sem custo por cargo; custo de grupo só com 3 ou mais postos, todos calculados (sem aviso e maior que zero) e com custos diferentes por pessoa-mês; na Adm. Central, custo só no exercício escolhido.
  - **Decisões D-107-1 a 6 no #476:**
    - peso dos encargos fora (o `orc` não separa);
    - vagas A CONTRATAR sem data viram só A CONTRATAR;
    - o anonimato (3 postos, custos diferentes) é escolha técnica, com risco residual entre execuções registrado;
    - postos no ano com o pico;
    - teto de leitura (DoS).
  - O caso nasce desligado e com teto zero, e está no hml.
- [x] #482: conserto da `main`. O #476 e um PR da frente A passaram no CI cada um sozinho, mas juntos quebraram o typecheck (campo novo e obrigatório no `EmpregadoTela`). **Combinado com a frente A:** campo novo em tipo de porta pública entra opcional (`?:`), e antes de mesclar confere-se o typecheck contra a `main` atual.
- [ ] **US-099 (#121):** continua bloqueada por falta de fonte do realizado físico. O RN0437 exige integração, o documento de integração V4 não cobre isso, e a meta não tem carta, data nem quantidade. Há três perguntas ao PO na #121.

## 8. Diário de sessões

| Data | Frente | Resumo |
| --- | --- | --- |
| 13/11 (noite) a 14/11/2026 (madrugada) | B | Frente A acordada e destravada pela #138. #469 (vínculo funcional no C2) e #473 (natureza CAPEX no C1), pedidos da frente A; US-107 inteira (#476, #484 e #488), com duas revisões independentes; #482 (`main` sem typecheck depois de PRs paralelos, com a regra do campo opcional combinada com a frente A). US-099 bloqueada por falta de fonte (#121) |
| 13/11/2026 (manhã) | B | #456 (US-118, manual por perfil; #140 fechada) e #454 na `main`; US-054 decidida pelo PO (#76). US-119 parte 2: rollback do app ensaiado no hml e restauração do dump ensaiada com o banco de dev, com correções no runbook. O PO autorizou as sessões das duas frentes a não pararem para confirmar ou relatar (seção 2). Depois: #460 (conferência da VPS), #462 (US-108, ajuda do manual por IA, sem embeddings; DoS do `semMarcas` corrigido e avisado à frente A) e #464 (roteiro da carga) |
| 13/11/2026 (madrugada) | B | Com autonomia do PO: #447 (US-048 parte 2), #448 (US-052, impostos, `impostosVigentes` e `AnoMes` no C2 a pedido da frente A), #449 (US-047, agrupadores), #450, #451 e #453 (US-022 e US-023 no C3), #454 (teste frágil). Revisão 12.12 independente nas US com migration, com os achados corrigidos (seed de impostos, conta inativa no agrupador). Achado do menu do Administrador acima de 720px em produção levado à frente A, que corrigiu no #452. US-054 em refinamento (#76) |
| 13/11/2026 (noite) | A | Com a autonomia do PO: plano P20 (#466) e US-070, pessoal da proposta (#467, #92 fechada). O agente revisor voltou a funcionar e achou dois defeitos, corrigidos antes do merge: o cache de benefícios era só por cargo, e a duplicação copiava pessoal incoerente com a capa nova. Um terceiro acerto veio do CI: o índice único foi declarado no schema, para não dar drift |
| 14/11/2026 (madrugada) | A | Janela autônoma pedida pelo PO até as 13h. Saíram o plano P21 (#470) e a US-071 (#471), com o teto informado por decisão do PO, e o plano P22 (#472) e a US-072 (#475). O revisor de código não achou defeito bloqueante na US-071; o achado menor, a conta de transporte gravada com custo zero, foi corrigido. Pedido para a frente B: a natureza CAPEX da conta no C1 (#138) |
| 14/11/2026 (madrugada, 2) | A | Saíram o filtro CAPEX (#480), a US-074 (#479), a US-073 (#485), a US-075 (#489) e a US-078 (#487), com os planos P23 a P27. O revisor de código achou e corrigimos antes do merge: a base do rateio vazando para quem não vê o pessoal, um mês negativo no cronograma, o filtro de período em UTC na Central e o Valor Global sem aviso de pessoal. O E2E das propostas passou a ter usuários próprios por causa do limite de login |
| 14/11/2026 (madrugada, 3) | A | Saíram as US-079 (#492), US-080 (#500) e US-081 (#501): os três fluxos de aprovação das propostas, todos no cronograma. Também a US-068 (#503) e a parte determinística da US-084, com os planos P28 a P30. A frente B lembrou o congelamento das alíquotas (RN_TAX_03), que entrou antes do merge da US-079. A US-082 ficou parada pelo C3 e pela vigência na capa |
| 13/11/2026 (tarde) | A | Com a autonomia do PO: plano P19 (#459) e US-067, metas da proposta (#461, #89 fechada). A revisão 12.12 foi feita pela própria sessão, porque o agente revisor parou por erro de autenticação da API; ela corrigiu a trava da capa nas recusas. Também o `semMarcas` linear (#463), achado da frente B na #138 |
| 13/11/2026 | A | P18 (#443) e US-066 (#445, #88 fechada): duplicar e nova versão da proposta, implementada por agente, com revisão 12.12 independente; o médio (exclusão de V1 Em Elaboração por meio de uma V2) corrigido antes do merge |
| 12/11/2026 (noite) | A | PO decide o GAP-CC-004 (CC próprio por TP); spec 1.7 (#435); pedido da frente B atendido com a Adm. Central só na raiz 4 (#439); plano P17 (#436) e US-065 (#440, #87 fechada), implementada por agentes (modelo e tela) com revisão 12.12 independente e as correções aplicadas; E2E sobre a seed de TPs da frente B (#438); quadro de atividades da sessão como mod do Claude Code, pedido do PO |
| 12/11/2026 | A | P16: plano (#419) e tela de correspondência do cargo em texto com o cadastro de C&S (#420, #410 fechada), com revisão 12.12 por agente independente e os quatro ajustes aplicados; exigência do cargo adiada para depois de 30/11 pela C34; benefícios dos cargos em lote (#424, sobre o #421 da frente B); pendências menores do núcleo conferidas item a item e o restante feito (#425); travas dos hooks das #154 a #161 (#426, com o de acordo da frente B e a revisão 12.12 aplicada); comunicação ativa na #138 (P16 sem conflito, de acordo no #422 e no #423) |
| 11–12/11/2026 | B | Noite de 11/11: avaliação de qualidade dos casos de IA (#406, fila `ia.avaliar`), rota pública que recusa reexportação (#407, compartilhado) e C&S no C2 (#408); seed com cargos utilizáveis pela posição para o E2E do P15 (#412, com o `afterAll` do `orc` ajustado pelo de acordo da frente A); CI destravado com um commit vazio depois do incidente do Actions. 12/11: **hml no ar** (GAP-INF-001), com HTTPS, banco, papéis, migrations, seeds e worker; deploy automático pelos webhooks do `homologacao`; DNS, snapshot e firewall do hPanel (porta 3000 fechada) pelo MCP da Hostinger, com o PO; monitor externo validado, #39 (US-017) fechada; exceção da D12 para o `sgo-hml` autorizada pelo PO; operação documentada (#416). Tarde de 12/11, com autonomia do PO para commit e merge: deploy automático do hml provado (merge → hml no mesmo digest em 25 s, #35) e `HML_WEBHOOK_OBRIGATORIO=1`; URLs de banco versionadas só de dev no CI (#417); US-015 parte 1, backup com PITR (pgBackRest, `archive_timeout` 60 s), dump cifrado (age + rclone) e teste de restauração mensal, com prova real no CI (#418, revisão independente com 6 importantes corrigidos); `beneficiosDosCargos` em lote para a frente A (#421); hook de D12 também veda `sgo-restauro-*` (#422, compartilhado, merge do PO); US-119 parte 1, runbook (#423), com a regra de migration destrutiva em dois passos combinada com a frente A; de acordo no #426 da frente A. Pendências do PO: storage do backup, endereço de prod, SMTP, chave da IA do hml, 2FA do Easypanel, checks obrigatórios da `main` e o passo 5 da US-013. US-045 adiada: a C7 (faixas globais) e a C27 (parametrização local por conta) divergem, decisão do PO. Revisão 12.12 nos PRs |
| 11–12/11/2026 | A | Tarde e noite: contrato do `orc` para a frente B (#398), `/int/saude` pública (#401), issue da avaliação em hml (#403) e da tela de correspondência (#410), com o ok do PO; plano P15 (#409); avaliador da IA-01 na avaliação genérica (#411); US-056, cargo do C&S na posição (#413); US-064 R4/R5, #86 fechada (#414); revisão 12.12 por agente independente em cada PR e também no #412 da frente B; CI parado por execuções órfãs depois do incidente do Actions, destravado com push novo (o PO precisou fazer a ponte; regra de bloqueio comum proposta na #138) |
| 11/11/2026 | A | P14 (IA onda 1): plano revisado (#387); GAP-IA-001 liberado pelo PO; US-063 (#393), US-062 (#394) e US-064 (#395), cada uma com revisão 12.12 por agente independente e ressalvas corrigidas antes do merge; coordenação proativa com a frente B na #138 (interface da US-019, `servicoIA.disponivel` no #390, aviso do worker e da chave da IA) |
| 10/11/2026 | A | CI de volta (cobrança regularizada pelo PO); P8 inteiro na `main` (#325 a #335), com os empilhados por *squash* na branch-pai e os conflitos resolvidos como na integração local; memória de 04/11 (#336); PO valida as decisões do P8 pelas recomendações (D-P8-2, 5, 6, 8 e 9, limite da recuperação, #64, textos provisórios, CSP no `proxy.ts` e HSTS no Traefik; #345); CSP completa com *nonce* (#347); P9 planejado e revisado (#349) e implementado com dois agentes em paralelo: US-011 (#350), US-035 (#351), US-036 e US-033 (#352), cada um com revisão 12.12 e ressalvas corrigidas; memória (#353); P10 planejado e revisado (#356) e implementado em paralelo: US-039 (#357) e US-041 parte 1 (#358), com revisão 12.12 e ressalvas corrigidas; memória (#359); "de acordo" no #354 da frente B (fila `exportacao.gerar`); P11 planejado e revisado (#361) e US-057 (#362), com revisão 12.12 e ressalvas corrigidas; memória (#363); à noite, PO segue as recomendações para a US-056 e autoriza merge e commit; P12 planejado e revisado (#364) e US-056 (#365), com revisão 12.12 e ressalvas corrigidas (inclusive no formulário de pacotes); memória (#366); P13 planejado e revisado (#368) e US-037 (#369), com revisão 12.12 e ressalvas corrigidas; aviso à frente B na #137 sobre a contagem de usuários por perfil; memória (#370); pedido do modelo de e-mail do bloqueio na #49; pedidos da frente B na #138: resposta sobre a importação, #372 (exportação assíncrona do Histórico) e #373 (meta do recálculo), com revisão 12.12; memória (#374); depois das respostas da frente B (#376, #377 e #137): #380 (US-027 completa), #381 e #382, com revisão 12.12 |
| 04/11/2026 | A | Manhã: R10, semáforo real, leitor seguro, AcaoConfirmada do ger, Playwright no CI, credenciais e trava do Histórico (#309 a #312, #314 a #316); GitHub instável e, desde 10:22, CI parado por cobrança; P8 (base de R0/R1) planejado (#325, duas rodadas de revisão) e implementado: US-028 (#326), US-042 (#327, #328), US-040 (#329, #330), US-007 (#331), US-029 (#332 a #334) e pedidos da frente B (#335), cada um com revisão 12.12 e ressalvas corrigidas; revisão de bloco; integração local verde; merges esperando o CI |
| 11/11/2026 | B | US-024 completa com o PDF (#383). US-018: porta `ProvedorIA` com os adaptadores Anthropic e falso (#385). US-019: governança da IA (#386, com reservas contra chamadas simultâneas, custo exato e fronteira), tela `/int/ia` (#388), seed no orquestrador (#389, compartilhado) e `servicoIA.disponivel` com o `padrao` dos casos (#390, pedido da frente A). Revisão 12.12 por agente independente nos PRs grandes, com os importantes corrigidos antes do merge. Contrato e respostas à frente A na #138. Merges com a autorização do PO, PR por PR |
| 10/11/2026 | B | Noite, pedidos da frente A: #137 respondido (a contagem por perfil passa a `codigo: string` com todos os perfis; o `rel` não muda); modelo de e-mail `usuario.alerta_tentativas` para a US-027 (#376, pedido na #49); dono do pedido no `GeradorExportacao` e bundle do worker com o gerador do Histórico (#377, pedidos do #372 na #138); PR `compartilhado` das dependências do PDF e da IA (#378). O PO autorizou a frente B a seguir de forma autônoma pelas próprias recomendações |
| 10/11/2026 | B | Noite: testes pendentes da revisão do #354 (#367: log da fila, teto de 100.000 e tempo de 5 min, com teste de mutação); aviso por e-mail da exportação em segundo plano (#371): modelo `exportacao.concluida`, validação dos dados por modelo no contrato C4 e `emailFalso` com os modelos de acesso por padrão (os testes da frente A seguem sem mudança); revisão 12.12 independente (aprovar com ajustes, aplicados) e CI verde nos dois |
| 10/11/2026 | B | Tarde: US-024 parte 4, a exportação assíncrona acima de 5.000 linhas (#354): pedido e outbox na transação da tela, trabalhador `exportacao.gerar` no worker com os geradores do cad, tela Minhas exportações no `rel`, limpeza periódica e limite por pessoa; revisão 12.12 (aprovar com ajustes, aplicados) e CI verde; com o "de acordo" da frente A no `fila.ts` (pedido no próprio #354, respondido às 15:23Z; lembrete deles: o job leva só o id do pedido), o PO autorizou e o #354 entrou (`3642238`) |
| 10/11/2026 | B | CI de volta depois da cobrança; P7: carga com login no contêiner e primeira rodada no dev (p95 de 149 ms, #324), metas de servidor (escrita p95 ≤ 43 ms, exportação de 5.000 linhas em 0,9 s, #338) e plano de contas sintético de 5.000 linhas (#341); conferência da carga completa com a seção de usuários (#344, contrato do adm no #335); US-024 em 3 partes: cabeçalho de filtros e marca do operador e do rastreio no C3 (#342), exportação do plano de contas e dos CCs pelas telas (#343) e com os filtros da tela (#346); contrato de máscara dos salários no Histórico para a frente A (#339); `X-Powered-By` desligado (#337, #340); de acordo da frente B no #333; revisão 12.12 por agente independente em cada PR |
| 04/11/2026 | B | P7 planejado e iniciado: plano (#307, D-P7-1 a 8); roteiro de homologação (#313, Task 1); relatório de conferência da carga, o primeiro do `rel` (#317, Task 2) e a seed no orquestrador (#319); testes de segurança de cabeçalhos e cookie (#318) e a matriz de autorização pelo catálogo (#322, Task 4); ferramentas de carga com o k6, sem rodar (#321, Task 3); CSV seguro no `ger` (#306, fecha a #233); pendências da VPS (#308, fecha a #153); páginas do `cad` sem `<main>` (#320); teste dos hooks numa sessão nova (#145); GitHub com incidente na manhã (push por HTTPS, merge pela API REST); revisão 12.12 por agente independente em cada PR |
| 03/11/2026 | B | P4 completo na `main`: #249, #254, cargos 12a a 12c (#261, #267, #270), benefícios do cargo (#272) e custo do cargo (#274); correções do `cad` pedidas pela frente A (#276) e log das cargas sem valores (#288); C3 para a frente A (#278, #279, #284, #287) e C2 (#295); E2E no CI (#292), Argon2 na imagem (#297) e seed no deploy (#299); #221 atualizado com a `main`; revisão 12.12 por agente independente em cada PR, com os bloqueantes corrigidos antes do merge; merges com a autorização do PO para seguir as recomendações; à noite, benefícios do cargo no exercício novo (#302, decisão do PO) e #221 na `main` depois da #223 |
| 03/11/2026 | A | P6 completo na `main`: seed do orc (#251), US-121 (#252, #253, #258), US-055 parte 2 (#255), US-060 (#256), US-058 (#259), US-059 (#260), US-061 (#262) e E2E (#265, Task 9 por subagente, revisada); encerramento do P5 (#257, `flock` nos testes pesados e spec 1.6); ressalvas 1, 2, 3 e 5 do P5 (#263, #266); CC de escopo pelo C1 (#264); melhorias menores do Histórico (#268) e mensagens do Zod em pt-BR (#269); revisão de bloco do P6 com 3 lentes e correções (#273, #275); à tarde, dívida técnica: issue #280 e ressalva 4 do P5 com medição (#293), fronteiras de erro da raiz (#290), diálogos e `<main>` único (#281, #291), auditoria (#282, #294), config e prisma (#283, #286), kernel (#285), testes das filas (#289); revisão 12.12 por agente independente em cada PR; merges com a autorização do PO para seguir as recomendações; noite: aprovação do PO na #223 publicada, regra do aviso direto entre frentes (#303) e #223 fechada |
| 26/10–02/11/2026 | A | P5 concluído na `main`: US-031 (#206), E2E de acesso (#235), US-038 em duas partes (#236, com o `adm/servidor.ts`, e #237); revisão de bloco do P5; verificação manual com o Mailpit; plano do P6 (#238) e Tasks 0 a 8 do P6 em branches locais; revisões de consumidor do C1, do C2 e do leitor; issues #228 a #234 para a frente B; merges aprovados pelo PO um a um |
| 02/11/2026 | B | Noite: merges do PO (#240, #241, #242, #244, #245, #246 e #248); Task 8 (#248, telas de CC e trava da DIREX, revisão com security-review) e Task 9b (#249, parâmetros e SMN; a revisão achou brechas na auditoria da origem blindada, corrigidas com a conferência no pedido bruto); build: rodar `prisma generate` na cópia principal antes do `npm run build` |
| 02/11/2026 | B | Tarde: merges do PO da pilha do P4 e do #222 (M5 pela recomendação, com uma 3.ª rodada de revisão só do commit da M5); #240 (ambiente único), #241/#242 (Node 24 no CI, o `pr.yml` separado por ser compartilhado), #244 (tela de importação do plano, duas rodadas de revisão) e #245 (consulta em árvore); D12: duas rodadas de teste coincidiram com a integração da frente A, depois disso toda rodada pesada espera o `vitest` da outra frente |
| 02/11/2026 | B | P4 em modo autônomo: CI do #208 voltou (cobrança do Actions regularizada); contratos C1 (#209) e C2 (#210); US-043 partes 1 a 3 e a Task 4d (#212 leitor seguro de .xlsx, #214 staging e merge no worker, #215 seeds, #217 compartilhado); US-053 parte 1 (#216); US-046 parte 1 (#220); US-021 partes 1 a 3 (#219, #221, #222) e a documentação do C3 (#224); US-050 parte 1 (#225); US-051 parte 1 (#226, motor real do C2, valores conferidos à mão); merges do PO na mesma tarde (todos menos #221 e #222); issues #211, #213, #218 e #223 para a frente A; revisão 12.12 em todos, com mutantes |
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
