# SGO 2.0 — Memória do projeto

> **Leia este arquivo no início de toda sessão** (frente A, frente B ou qualquer outra conta) e **atualize-o ao fim** da sessão, com a data, em PR. É o contexto compartilhado entre as contas do Claude Code: nenhuma sessão vê a conversa ou a memória local das outras.
>
> Hierarquia: a **spec** (`docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md`) é a norma. O **backlog** (`docs/backlog/`) é o que construir e em que ordem. Este arquivo é **estado, decisões recentes e pendências**. Em caso de conflito, vale a spec.

Última atualização: 03/11/2026 (frente B, P4 completo na `main`, acréscimos ao C2 e ao C3 pedidos pela frente A, E2E no CI e seed no deploy); 03/11/2026 (frente A, P6 completo na `main`, ressalvas do P5 e melhorias menores); 02/11/2026 (frente A, P5 Acesso na `main`, plano do P6 e P6 implementado em branches locais); 02/11/2026 (frente B, P4: pilha mergeada; à tarde, #222 com a M5, ambiente único, Node 24 no CI e as telas do plano de contas); 25/10/2026 (frente A, US-003 a US-010 e fim do P1; frente B, abertura, plano do P3 e Tarefas 1 a 5 do P3).

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
- **P4 da frente B (02/11): pilha mergeada na `main` pelo PO**, todos com a revisão 12.12 aprovada: #208 (US-025 parte 2), #209 (C1), #210 (C2), #212 (US-043 parte 1, leitor seguro de .xlsx), #214 (US-043 parte 2, plano de contas, staging e merge no worker como `sgo_sync`), #215 (US-043 parte 3, seeds), #217 (Task 4d, seeds no `prisma/seed.ts`), #216 (US-053 parte 1, parâmetros por exercício), #220 (US-046 parte 1, centros de custo), #225 (US-050 parte 1, Tabela Mestre), #226 (US-051 parte 1, motor real do C2), #219 (US-021 parte 1, Tree Grid) e #224 (documentação do C3). Na mesma tarde, também o #222 (US-021 parte 3, filtros, com a M5 decidida pelo PO: quem casa pela busca leva a subárvore).
  - **Mergeados em 02/11 à noite:** #240 (ambiente único), #241/#242 (Node 24 no CI), #244 (US-043 parte 4, tela de importação do plano), #245 (US-044, consulta em árvore) e #248 (US-046 parte 2, telas de CC com a trava da DIREX). **Aberto, com a revisão 12.12 (2 rodadas) e o CI verde:** #249 (US-053 parte 2, telas dos parâmetros e do SMN; o worker passa a ler o nome de exibição do `parametro_sistema`).
  - **#221** (US-021 parte 2, exportação real): head antigo sobre o #212, precisa de rebase e espera o "de acordo" da frente A na #223.
  - **Lições das telas (Task 7a):** o `tests/arquitetura/guarda-acoes.test.ts` exige `definirAcao` explícito em cada export de arquivo `'use server'`, então não há fábrica de ações (`criarAcaoConsultarCarga` do plano virou `consultarCargaDoGrupo`). Os avisos de saneamento só vêm na resposta do envio, e os da R5 só no lote. O `Formulario` do C3 não devolve o resultado da ação. As Tasks 8 e 12b reusam `acao-carga.ts`, `domain/arquivo-carga.ts` e `ui/importar-estrutura.tsx`.

  Pilha de PRs: depois de cada merge *squash*, rebasear o PR de cima com `git rebase --onto <nova main> <commit antigo da base>`. **Antes do merge, trocar a base dos PRs dependentes para `main`** (`gh api -X PATCH repos/fabianojp06/sgov2/pulls/N -f base=main`); senão o GitHub fecha o dependente quando apaga a branch de base (aconteceu com o #214 e o #221).
  - **Conflitos esperados no rebase sobre o #208:** `src/modules/ger/servidor.ts` (manter as duas exportações), `worker/index.ts` (manter os trabalhadores do ger e o processador de cargas) e `worker/build.mjs` (manter o metafile e o plugin `semArgon2`; o `worker/build.test.ts` reprova se o plugin sumir).
  - **Migrations novas do cad:** `202611021000_cad_plano_contas`, `202611021100_cad_parametros`, `202611021200_cad_centros_custo` e `202611021300_cad_beneficios`. O dev da frente B (56432) já está com as quatro, e o `migrate diff` dá zero.
  - **Desempenho:** a carga de 10.000 linhas leva de 15 a 26 s, contra o limite de 30 s (RNF_DES_003); a margem é curta com a VPS carregada. A auditoria em lote dependeria do `@/shared/audit`, da frente A.
  - **C3 mudou de lugar:** o `exportarXlsx` real sai só pelo `@/modules/ger/servidor`, porque o `index.ts` do ger vai para o navegador (Review Focus 10). Para usá-lo, chamar de `application/` (caso de uso ou `'use server'`), nunca de `app/`. O plano-mestre e o P3 já foram atualizados (#224); falta o "de acordo" da frente A (#223).
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

**Frente B (03/11)**
- [ ] PO:
  - incluir o check **E2E** nos obrigatórios da `main` depois de algumas rodadas verdes (#292);
  - criar o serviço `migracao` (argumento `implantar`) em hml e prod na Tarefa 6. Até o webhook dele existir, o *redeploy* do `migracao` é manual antes do `app`, e o log é conferido à mão (`[IMPLANTAR_CONCLUIDO]` × `[ADMIN_INICIAL_*]`);
  - ~~decidir se os benefícios do cargo passam para o exercício novo~~ **decidido pelo PO em 03/11 (recomendação seguida):** o `criarParametrosDoAno` copia do ano-base o ativo/inativo, o valor manual e a origem (`MANUAL` continua `MANUAL`, para o GRH revisar), inclusive de cargo inativo, com um Histórico do exercício e a linha do ano-base presa durante a cópia (#302). Quando houver tela do Histórico, o `valorManual` de `cad.cargos` deve sair mascarado sem `cad.salarios:consultar` (R24);
  - marcar como falso positivo, no GitGuardian, os incidentes 39444187 e 39442400 do #221 (testes do `adm` já na `main`, vistos pelo commit de merge).
- [ ] **Para a frente A:**
  - trocar as cópias da `AcaoConfirmada` do `adm` e do `orc` pela do `ger` (corpo do #284);
  - na importação do `orc`, usar `lerPlanilhasSegura` com o `indiceAba` para a mensagem da R6 e `celulas: ['E1']` na aba `Instruções` (#279, #287);
  - injetar `provedorSemaforo` de `@/modules/cad` no `deps.semaforo` de produção (#295);
  - R10: a carga do plano de contas pode inativar uma conta e mudar as premissas do ano sem subir a versão (#295);
  - `retries: process.env.CI ? 1 : 0` e o reporter `github` no `playwright.config.ts` antes de o E2E virar obrigatório (#292);
  - `adm/servidor.ts` e `orc/servidor.ts` para a seed: um `server-only` num `application/` do `adm` ou do `orc` quebraria o bundle da seed (#299);
  - `guarda.ts` ainda grava o TP na auditoria de negação de cadastro global (revisão do #276).
- [ ] Frente B, #221 (exportação XLSX real): atualizado com a `main` por merge, porque o force push do rebase foi negado pelo classificador. Depois do "de acordo" na #223, a frente B recria a branch a partir da `main` com um commit só. A #233 (texto que vira fórmula) já está coberta no XLSX pelo M2 do #221; fica aberta só pelo CSV do `rel`.
- [ ] Rolagem do plano de contas (`e2e/cad/rolagem-plano.spec.ts`) continua em `fixme`: a tela não tem `expandir=todos`, o plano oficial tem 174 contas e o spec do `cad` roda antes do do `orc` no mesmo banco. Recomendação para o PO: medir em hml pelo plano B do próprio spec (Chrome DevTools › Performance, 5 s rolando o plano de 5.000 linhas expandido; FPS médio ≥ 55 e nenhuma tarefa longa acima de 50 ms).
- [ ] Pendências baixas registradas nos PRs de 03/11: dois CONSULTA de `cad.salarios` por abertura da tela do cargo (#274); a tela do cargo sem seletor de ano (#274); sem jsdom, o foco da `AcaoConfirmada` e o efeito do aria do Formulario não têm teste de interação (#278, #284); nenhum passo da imagem faz login com senha (#297).
- [ ] US-119 (runbook, #141) depende das Tarefas 6 e 7 (deploy real e backup), bloqueadas pelo GAP-INF-001. US-122 (#145): falta a frente B repetir o teste dos hooks numa sessão nova (o hook não recarrega na sessão em que foi alterado).
- [x] D12 (nota): nas primeiras rodadas de 03/11, a frente B rodou integração com `npx vitest` direto, fora do `flock`; depois passou a usar `npm run test:int`, que respeita o lock.

**Com SMEs**
- [ ] Wellington: ISS, GAP-CAD-004/005 e GAP-CAR-005 (contas de obrigações e riscos trabalhistas).
- [ ] Adriana: GAP-APR-001.
- [ ] DIREX: aprovação do plano de centros de custo (GAP-CC-001 a 006).

## 8. Diário de sessões

| Data | Frente | Resumo |
| --- | --- | --- |
| 03/11/2026 | B | P4 completo na `main`: #249, #254, cargos 12a a 12c (#261, #267, #270), benefícios do cargo (#272) e custo do cargo (#274); correções do `cad` pedidas pela frente A (#276) e log das cargas sem valores (#288); C3 para a frente A (#278, #279, #284, #287) e C2 (#295); E2E no CI (#292), Argon2 na imagem (#297) e seed no deploy (#299); #221 atualizado com a `main`; revisão 12.12 por agente independente em cada PR, com os bloqueantes corrigidos antes do merge; merges com a autorização do PO para seguir as recomendações |
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
