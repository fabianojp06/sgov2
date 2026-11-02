# SGO 2.0 — Memória do projeto

> **Leia este arquivo no início de toda sessão** (frente A, frente B ou qualquer outra conta) e **atualize-o ao fim** da sessão, com a data, em PR. É o contexto compartilhado entre as contas do Claude Code: nenhuma sessão vê a conversa ou a memória local das outras.
>
> Hierarquia: a **spec** (`docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md`) é a norma. O **backlog** (`docs/backlog/`) é o que construir e em que ordem. Este arquivo é **estado, decisões recentes e pendências**. Em caso de conflito, vale a spec.

Última atualização: 02/11/2026 (frente A, P5 Acesso na `main`, plano do P6 e P6 implementado em branches locais); 02/11/2026 (frente B, P4: contratos C1/C2 e US-043, US-053, US-046 e US-021 em PRs empilhados); 25/10/2026 (frente A, US-003 a US-010 e fim do P1; frente B, abertura, plano do P3 e Tarefas 1 a 5 do P3).

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
- **P4 da frente B (02/11): pilha mergeada na `main` pelo PO**, todos com a revisão 12.12 aprovada: #208 (US-025 parte 2), #209 (C1), #210 (C2), #212 (US-043 parte 1, leitor seguro de .xlsx), #214 (US-043 parte 2, plano de contas, staging e merge no worker como `sgo_sync`), #215 (US-043 parte 3, seeds), #217 (Task 4d, seeds no `prisma/seed.ts`), #216 (US-053 parte 1, parâmetros por exercício), #220 (US-046 parte 1, centros de custo), #225 (US-050 parte 1, Tabela Mestre), #226 (US-051 parte 1, motor real do C2), #219 (US-021 parte 1, Tree Grid) e #224 (documentação do C3).
  - **Ainda abertos:** #222 (US-021 parte 3, filtros; base `main`, espera a decisão da M5 e um rebase) e #221 (US-021 parte 2, exportação real; head antigo sobre o #212, precisa de rebase e espera o "de acordo" da frente A na #223).

  Pilha de PRs: depois de cada merge *squash*, rebasear o PR de cima com `git rebase --onto <nova main> <commit antigo da base>`. **Antes do merge, trocar a base dos PRs dependentes para `main`** (`gh api -X PATCH repos/fabianojp06/sgov2/pulls/N -f base=main`); senão o GitHub fecha o dependente quando apaga a branch de base (aconteceu com o #214 e o #221).
  - **Conflitos esperados no rebase sobre o #208:** `src/modules/ger/servidor.ts` (manter as duas exportações), `worker/index.ts` (manter os trabalhadores do ger e o processador de cargas) e `worker/build.mjs` (manter o metafile e o plugin `semArgon2`; o `worker/build.test.ts` reprova se o plugin sumir).
  - **Migrations novas do cad:** `202611021000_cad_plano_contas`, `202611021100_cad_parametros`, `202611021200_cad_centros_custo` e `202611021300_cad_beneficios`. O dev da frente B (56432) já está com as quatro, e o `migrate diff` dá zero.
  - **Desempenho:** a carga de 10.000 linhas leva de 15 a 26 s, contra o limite de 30 s (RNF_DES_003); a margem é curta com a VPS carregada. A auditoria em lote dependeria do `@/shared/audit`, da frente A.
  - **C3 mudou de lugar:** o `exportarXlsx` real sai só pelo `@/modules/ger/servidor`, porque o `index.ts` do ger vai para o navegador (Review Focus 10). Para usá-lo, chamar de `application/` (caso de uso ou `'use server'`), nunca de `app/`. O plano-mestre e o P3 já foram atualizados (#224); falta o "de acordo" da frente A (#223).
  - **Stub do argon2 no bundle do worker:** a seed do cad usa o `index.ts` do adm, que alcança o `@node-rs/argon2`. O conserto limpo é o `adm/servidor.ts` (#213).
  - **Revisão 12.12:** o plano permite no máximo 2 rodadas, depois disso o PO decide. A US-043 parte 1 (#212) teve 3 rodadas, e o PR registra isso.

**P5 Acesso (frente A, plano `2026-10-25-trilha-2027-p5-acesso.md`): concluído na `main` em 02/11**
- PRs: compartilhado do P5 (#189), US-034 com o **contrato C6** (#193), seed no orquestrador (#194), US-026 login (#196, #200), US-032 logoff (#201), US-030 troca de senha (#203), US-031 tela principal, menu, seletor de TP e ajuda (#206), E2E de acesso (#235), US-038 parte 1, casos de uso de usuário (#236), e US-038 parte 2, telas (#237, fecha a #60). Todos com a revisão 12.12.
- **`src/modules/adm/servidor.ts`** (#236): entrada só de servidor do adm, com `instalarFuncionalidades` e `DeclaracaoFuncionalidade`. A seed do cad importa dele, e o stub do argon2 saiu do `worker/build.mjs`. Agora o `worker/build.test.ts` reprova qualquer argon2 no bundle. Isso resolve a #213.
- O #237 entrou com o GitGuardian vermelho, com a aprovação do PO: dois falsos positivos (`'adm.usuarios:incluir'` e `resetarSenha: acao`) em commits antigos do PR. O commit final já não tem os padrões. Os incidentes 39442399 e 39442400 continuam abertos no painel.
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

**P6 Orçamento da Adm. Central (frente A, 02/11)**
- **Plano na `main` (#238):** `docs/superpowers/plans/2026-11-02-trilha-2027-p6-orcamento.md`.
  - Decisões D-P6-1 a D-P6-7 pendentes do PO; vale a recomendação quando houver dúvida.
  - O schema da Task 1 tem o CHECK do `enviado_por` em Em Aprovação.
- **Tasks 0 a 8 implementadas**, cada uma com a revisão 12.12 e as correções, numa pilha de branches locais:
  - `c6-exibir-no-menu` (`Closes #211`);
  - `us-055-orcamento-schema`;
  - `us-121-calculo-linhas`;
  - `us-121-validacao-planilha`;
  - `us-055-exercicios` (`Closes #77`);
  - `us-060-receitas` (`Closes #82`);
  - `us-121-importacao` (`Closes #143`);
  - `us-058-visao-cc` (`Closes #80`);
  - `us-059-teto` (`Refs #81`);
  - `us-061-aprovacao` (`Closes #83`);
  - mais `compartilhado-seed-orc`.
- A pilha leva por merge versões antigas do C1, do C2 e do leitor. Esses PRs já estão na `main` (#209, #210, #212 e o C2 real no #226), então falta rebasear tudo antes do primeiro PR.
- Suítes da pilha: unidade 814, arquitetura 293, integração do `orc` 107, build com as 8 páginas `/orc`.
- **Bloqueios:**
  - **Task 9 (E2E do P6):** espera as seeds do `cad` com dados reais.
  - **Semáforo do teto:** entra por injeção (`ProvedorSemaforo`) até a Task 9a do P4 (#234). Por isso a US-059 vai com `Refs #81`.
  - **CC de escopo no cadastro de usuário:** a conferência pelo C1 entra agora que a US-038 e o C1 estão na `main`.
- Revisões de consumidor postadas no #209, no #210 e no #212. Issues abertas para a frente B: #228 a #234.

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
- [ ] PO: merge do #222 (depois da M5) e do #221 (depois da #223); o resto da pilha do P4 já entrou em 02/11.
- [ ] PO: decidir a M5 do #222 (sintético que casa com a busca mostra ou não os filhos). O #212 teve 3 rodadas de revisão, contra as 2 do plano, e já foi mergeado pelo PO.
- [ ] PO, no `worker` de hml e prod: `SYNC_DATABASE_URL` com o `sgo_sync`, e o `app` **sem** ela; `AMBIENTE` no `app`, no `worker` e no serviço de migração (`docs/operacao/ambientes.md`). As variáveis da seed no deploy ficaram na #195.
- [ ] Frente A: ~~`adm/servidor.ts` com `instalarFuncionalidades` (#213)~~ feito no #236; usuário GFIN no `global-setup` do e2e (#218); `exibirNoMenu` no C6 (#211); "de acordo" com o `exportarXlsx` só pelo `servidor.ts` (#223); C2 real (`calcularCustoPosicao`, `obterPremissasExercicio`, `garantir`, `congelar`) já na `main` (#226), pronto para a US-121.
- [ ] Frente B: trocar o `ambienteDoCad` (`cad/infrastructure/ambiente.ts`) pelo `lerAmbiente` do ger (o #208 já entrou); tirar o stub do argon2 quando a #213 entrar; filtrar o `meta` do Prisma no log dos lotes de cargos (Task 12a).
- [ ] Frente B, Tasks seguintes do P4: 7a/7b (telas do plano de contas), 8 (telas de CC), 9b (telas dos parâmetros), US-050 parte 2 (inclusão pela tela e seletor de ano), 12a a 12c, 13 e 14. As telas dependem da estrutura de páginas da frente A (layout de `(sistema)`, US-031 no #206).
- [x] Frente A: detalhar o plano do P5 (Acesso) com writing-plans.

**Frente A (P5/P6, 02/11)**
- [ ] PO: validar as decisões D-P6-1 a D-P6-7 e os textos [PROVISÓRIOS] da US-038.
- [ ] PO: marcar como falso positivo, no painel do GitGuardian, os incidentes 39442399 e 39442400 (#237).
- [ ] Fechar a #213, que o #236 resolveu.
- [ ] P6: rebasear a pilha na `main` e abrir os PRs na ordem da pilha, um por vez, cada um com a confirmação do PO.
- [ ] PR compartilhado do encerramento do P5:
  - `test-results/`, `playwright-report/` e `blob-report/` no `.gitignore`;
  - trava de "um processo pesado por vez" (`flock`) no `test:int` e no `test:e2e`;
  - spec v1.6 §11.2a, a combinar com a frente B (que registra os `Refs #n` na v1.5).
- [ ] Revisão de bloco do P5 (02/11, aprovado com ressalvas, sem bloqueante). Viram issues da frente A:
  1. o Histórico das ações que não são por TP sai com o `unidadeId` do TP selecionado; o `orc` já nasce com `unidadeId` nulo;
  2. gerar nova senha para usuário bloqueado e ativo manda o e-mail, mas o login continua bloqueado;
  3. a troca de senha do usuário incrementa a `versao` e derruba o formulário aberto do Administrador;
  4. o provedor de contexto roda até três vezes por página;
  5. o `error.tsx` de `(sistema)` mostra o texto do UC01.03 E1 para qualquer erro.

**Com SMEs**
- [ ] Wellington: ISS, GAP-CAD-004/005 e GAP-CAR-005 (contas de obrigações e riscos trabalhistas).
- [ ] Adriana: GAP-APR-001.
- [ ] DIREX: aprovação do plano de centros de custo (GAP-CC-001 a 006).

## 8. Diário de sessões

| Data | Frente | Resumo |
| --- | --- | --- |
| 26/10–02/11/2026 | A | P5 concluído na `main`: US-031 (#206), E2E de acesso (#235), US-038 em duas partes (#236, com o `adm/servidor.ts`, e #237); revisão de bloco do P5; verificação manual com o Mailpit; plano do P6 (#238) e Tasks 0 a 8 do P6 em branches locais; revisões de consumidor do C1, do C2 e do leitor; issues #228 a #234 para a frente B; merges aprovados pelo PO um a um |
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
