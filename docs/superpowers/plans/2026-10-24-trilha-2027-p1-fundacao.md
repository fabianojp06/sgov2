# Trilha 2027 · P1 Fundação (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a fundação técnica de que todos os blocos da trilha 2027 dependem: repositório com fronteiras de módulo, travas de segurança das sessões, ambiente de dev, banco com papéis, núcleo de dinheiro, auditoria, autorização, totalizador e filas.

**Architecture:** Monólito modular Next.js 16 (App Router) na raiz do repositório. `src/modules/<mod>` com `domain/application/infrastructure/ui/index.ts`; `src/shared/*` para o núcleo transversal; `worker/` como processo separado. As fronteiras são impostas por ESLint e por testes de arquitetura. PostgreSQL 16 via Prisma 7 (schema multi-arquivo), com a aplicação conectando por um papel sem `BYPASSRLS`.

**Tech Stack:** Node 22.23 · Next.js 16.4.3 · React 19.3.1 · TypeScript 6.0.3 (não 7.x: o typescript-eslint suporta `<6.1`) · Prisma 7.10.1 + `@prisma/adapter-pg` 7.10.1 (não o 8.0 RC) · decimal.js 10.6.0 · Zod 4.6.7 · pg-boss 12.38.0 · Vitest 5.0.5 · @testcontainers/postgresql 12.2.1 · fast-check 4.10.2 · ESLint 10.13 + typescript-eslint 8.72 + eslint-plugin-boundaries 7.3 · picomatch · yaml · tsx.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (v1.1) — §3.3, §4.1, §4.3 (D12), §5, §10, §11.1, §11.5, §12. **Plano-mestre:** `docs/superpowers/plans/2026-10-24-trilha-2027-plano-mestre.md`.

## Global Constraints

- Dinheiro: `NUMERIC(15,2)`, arredondamento **Half-Even** em 2 casas; percentuais e índices `NUMERIC(9,4)`; `number` do JS é proibido para dinheiro (spec §5, D5).
- O nome "CTCEA" não pode aparecer em `src/`, `prisma/`, `worker/` nem nas seeds, sem diferenciar maiúsculas (spec §6.7).
- A aplicação conecta com `sgo_app` (sem `BYPASSRLS`, sem DDL); as migrations rodam com `sgo_migrator`; `shadowDatabaseUrl` só aponta para banco efêmero local (spec §11.5).
- Migrations em ambiente compartilhado só com `prisma migrate deploy`; `migrate reset`, `db push` e `migrate diff` só contra o banco de dev local (spec §11.5).
- Dev na VPS de produção (D12): portas de dev só em `127.0.0.1`; todo contêiner de dev com `mem_limit` e `oom_score_adj` ≥ 500; `NODE_OPTIONS=--max-old-space-size=1536`; nenhum comando toca `sgo-prod`/`sgo-hml`.
- Portas de dev da frente A: banco 55432, app 3100, Mailpit 8125; frente B: 56432, 3200, 8225 (spec §12.4).
- Next.js 16 renomeou `middleware.ts` para **`proxy.ts`**: onde a spec §12.3 diz `src/middleware.ts`, vale `src/proxy.ts`.
- Mês no formato `Mmm/AA` (RN0302): `Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez`.
- Tipos de operação do histórico (RN0103): `INSERCAO, ALTERACAO, EXCLUSAO, CONSULTA, IMPRESSAO, EXPORTACAO, LOGIN, LOGOFF, SISTEMA`.
- Cada tarefa = uma história = branch `us-NNN-slug` + PR com `Closes #n` e label `frente:A`; commits com `Frente: A` e os trailers de coautoria (spec §12.5).
- Respostas e textos de interface em português do Brasil.

## Review Focus

1. **Porta de dev exposta na internet** (a VPS é a de produção): um `ports: "5432:5432"` publica o banco de dev para o mundo. Esperado: toda porta do compose de dev começa com `127.0.0.1:` — teste em `tests/arquitetura/compose-dev.test.ts` (Tarefa 3).
2. **Valor monetário chegando como `number`** (ex.: `0.1 + 0.2` vindo de um parse de planilha): esperado `TypeError` em `Dinheiro.de(0.3)`, nunca arredondamento silencioso — teste `rejeita number` (Tarefa 5).
3. **Percentual com denominador zero** (orçado 0,00 com realizado): esperado `null` ("Sem orçamento", RN_OXR_012), nunca `Infinity` nem exceção — testes em `percentual.test.ts` (Tarefa 5) e `totalizar.test.ts` (Tarefa 8).
4. **Comando perigoso disfarçado** no hook: `cd app && npx prisma db push`, `DATABASE_URL=postgres://...@sgo-prod-db/x npx prisma migrate reset --force`, `docker exec -it sgo-prod_db.1 psql`. Esperado: bloqueio em todos — casos na tabela de `regras.test.mjs` (Tarefa 2).
5. **Auditoria de registro com `Decimal`, `Date` ou `BigInt`**: `JSON.stringify` falha com BigInt e perde precisão com Decimal, e a operação inteira seria desfeita. Esperado: serialização para string (`"1234.50"`, ISO 8601, `"42"`) — teste `serializa Decimal, Date e BigInt` (Tarefa 6).

---

### Task 1: Repositório, estrutura de módulos e fronteiras (US-001, #23)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `.nvmrc`, `.env.example`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/login/page.tsx`
- Create: `src/modules/{ger,aut,adm,cad,orc,rel,apr,int}/index.ts`, `src/shared/{kernel,audit,authz,totalizer,config,db,filas}/index.ts` (cada um `export {};`)
- Create: `.github/frentes.yml`, `scripts/frentes/verificar.ts`, `.github/workflows/ci.yml`
- Modify: `.gitignore` (acrescentar `node_modules/`, `.next/`, `src/generated/`, `.env`, `.env*.local`, `coverage/`)
- Test: `tests/arquitetura/fronteiras.test.ts`, `scripts/frentes/verificar.test.ts`

**Interfaces:**
- Produces: alias `@/*` → `src/*`; scripts npm `dev`, `build`, `start`, `lint`, `typecheck`, `test` (projeto `unidade`), `test:int` (projeto `integracao`), `test:arq` (projeto `arquitetura`); `verificarFrentes(entrada: { arquivos: string[]; labels: string[]; frente: 'A' | 'B'; mapa: MapaFrentes }): Violacao[]` com `Violacao = { tipo: 'outra-frente' | 'compartilhado' | 'compartilhado-misturado' | 'migration-multipla'; arquivo?: string }` e `lerMapaFrentes(caminho = '.github/frentes.yml'): MapaFrentes`.

- [ ] **Step 1: Criar o esqueleto e instalar as versões do Tech Stack** com `npm install` exato (`--save-exact`). `package.json` com `"type": "module"`, `"engines": { "node": ">=22.12" }`. `tsconfig` com `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. `next.config.ts` com `output: 'standalone'`. `src/app/page.tsx` faz `redirect('/login')` (C32); `src/app/login/page.tsx` mostra só o título "SGO 2.0 – Sistema de Gestão Orçamentária".

- [ ] **Step 2: Escrever o teste de fronteiras (falha)** em `tests/arquitetura/fronteiras.test.ts`, usando `new ESLint()` e `lintText(codigo, { filePath })`:

```ts
it.each([
  ['src/modules/orc/domain/a.ts', "import { x } from '@/modules/cad/infrastructure/repo';", true],
  ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/domain/conta';", true],
  ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad';", false],
  ['src/modules/orc/domain/a.ts', "import { Dinheiro } from '@/shared/kernel';", false],
  ['src/modules/orc/domain/a.ts', "import { prisma } from '@/shared/db';", true],
  ['src/app/x/page.tsx', "import { prisma } from '@/shared/db';", true],
  ['src/app/x/page.tsx', "import { PrismaClient } from '@/generated/prisma/client';", true],
])('%s importando (%s) → erro=%s', async (arquivo, codigo, deveFalhar) => {
  const [r] = await eslint.lintText(codigo, { filePath: arquivo });
  expect(r.errorCount > 0).toBe(deveFalhar);
});
```

- [ ] **Step 3: Rodar e ver falhar** — `npx vitest run --project arquitetura tests/arquitetura/fronteiras.test.ts` → FAIL (regras ainda não configuradas).

- [ ] **Step 4: Configurar `eslint.config.mjs`** (flat config) com typescript-eslint e eslint-plugin-boundaries. Elementos: `app` (`src/app/**`), `mod-domain`, `mod-application`, `mod-infrastructure`, `mod-ui`, `mod-index` (`src/modules/*/index.ts`, capturando o nome do módulo), `kernel` (`src/shared/kernel/**`), `shared` (demais `src/shared/**`), `generated` (`src/generated/**`). Regras: `domain` só importa o próprio módulo e `kernel`; entre módulos, só via `mod-index`; `app` não importa `generated` nem `src/shared/db`. Ignorar `src/generated/**` e `.next/**`.

- [ ] **Step 5: Rodar e ver passar** — o mesmo comando → PASS (7 casos).

- [ ] **Step 6: Escrever os testes de `verificarFrentes` (falham)** em `scripts/frentes/verificar.test.ts`, com um mapa de teste igual ao `.github/frentes.yml`:
  - frente B, arquivos `['src/modules/orc/x.ts']`, sem labels → `[{ tipo: 'outra-frente', arquivo: 'src/modules/orc/x.ts' }]`;
  - o mesmo com label `toca-outra-frente` → `[]`;
  - frente A, `['package.json']`, sem labels → `[{ tipo: 'compartilhado', arquivo: 'package.json' }]`;
  - frente A, `['package.json', 'src/modules/orc/a.ts']`, label `compartilhado` → `[{ tipo: 'compartilhado-misturado', arquivo: 'src/modules/orc/a.ts' }]`;
  - frente A, `['prisma/migrations/202611010000_orc_a/migration.sql', 'prisma/migrations/202611010001_orc_b/migration.sql']` → contém `{ tipo: 'migration-multipla' }`;
  - frente B, `['docs/memoria/memoria-do-projeto.md']` → `[]` (memória é livre, spec §12.3).

- [ ] **Step 7: Rodar e ver falhar** — `npx vitest run scripts/frentes/verificar.test.ts` → FAIL.

- [ ] **Step 8: Criar `.github/frentes.yml` e implementar `verificar.ts`.** O YAML transcreve a tabela da spec §12.3 com `frentes: { A: [globs], B: [globs] }`, `compartilhados: [globs]` e `livres: ['docs/memoria/**', 'docs/backlog/**']` (trocando `src/middleware.ts` por `src/proxy.ts`). Casamento de globs com `picomatch`. Arquivo fora de todos os globs conta como compartilhado. Migration = caminho `prisma/migrations/*/migration.sql`. Exportar também uma CLI (`tsx scripts/frentes/verificar.ts --frente A --labels a,b < lista-de-arquivos`) que imprime as violações e sai com código 1 se houver alguma; ela será ligada ao CI pela frente B na US-013.

- [ ] **Step 9: Rodar e ver passar** — `npx vitest run scripts/frentes/verificar.test.ts` → PASS.

- [ ] **Step 10: CI mínimo** em `.github/workflows/ci.yml`: em `pull_request` e `push` na `main`, Node 22, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:arq`, `npm run build`. (A frente B amplia na US-013.)

- [ ] **Step 11: Verificar tudo** — `npm run lint && npm run typecheck && npm test && npm run test:arq && npm run build` → tudo verde; `npm run build` gera `.next/standalone`.

- [ ] **Step 12: Commit, PR e merge** — branch `us-001-repositorio`, PR "[US-001] Repositório e fronteiras de módulo", `Closes #23`, label `frente:A`. Este PR também leva a label `compartilhado` (cria arquivos compartilhados no período de fundação).

### Task 2: CLAUDE.md, travas das sessões e marca neutra (US-002 #24, US-012 #34)

**Files:**
- Create: `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/regras.mjs`, `.claude/hooks/guarda-bash.mjs`, `.claude/hooks/alerta-marca.mjs`
- Create: `src/shared/config/marca.ts`
- Test: `.claude/hooks/regras.test.mjs`, `tests/arquitetura/marca-neutra.test.ts`

**Interfaces:**
- Produces: `avaliarComando(comando: string, env: Record<string, string | undefined>): { bloquear: boolean; motivo?: string }` (em `regras.mjs`); `encontrarMarcaVedada(texto: string): string[]` (em `src/shared/config/marca.ts`, retorna as ocorrências).

- [ ] **Step 1: Escrever os testes das regras (falham)** em `.claude/hooks/regras.test.mjs` (incluir `.claude/hooks/**/*.test.mjs` no projeto `arquitetura` do Vitest). Tabela `[comando, env, bloquear]`:

| Comando | env `DATABASE_URL` | Bloquear |
| --- | --- | --- |
| `npx prisma migrate reset --force` | `postgresql://sgo_migrator:x@127.0.0.1:55432/sgo_dev` | false |
| `npx prisma migrate reset --force` | `postgresql://u:x@sgo-prod_db:5432/sgo` | true |
| `DATABASE_URL=postgresql://u:x@sgo-prod_db:5432/sgo npx prisma migrate reset --force` | (dev local) | true |
| `cd app && npx prisma db push` | (vazio) | true |
| `npx prisma db push` | `postgresql://u:x@127.0.0.1:56432/sgo_dev` | false |
| `npx prisma migrate diff --from-url postgresql://u:x@10.0.1.5:5432/sgo --to-schema prisma/schema` | (dev local) | true |
| `npx prisma migrate deploy` | (dev local) | false |
| `docker exec -it sgo-prod_db.1.abc psql -U postgres` | — | true |
| `docker compose -p sgo-hml down -v` | — | true |
| `docker cp sgo-prod_app.1:/app/.env .` | — | true |
| `cat /etc/easypanel/projects/sgo-prod/env` | — | true |
| `docker compose up -d db` | — | false |
| `psql -h 127.0.0.1 -p 55432 -U sgo_app sgo_dev` | — | false |
| `psql -h sgo-prod_db -U postgres` | — | true |
| `git push origin HEAD:main` | — | true |
| `git push -u origin us-001-repositorio` | — | false |

Também: o `motivo` de todo bloqueio cita a spec ("spec §11.5" ou "D12").

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run --project arquitetura .claude/hooks/regras.test.mjs` → FAIL.

- [ ] **Step 3: Implementar `avaliarComando` em `.claude/hooks/regras.mjs`.** Avaliar a string inteira (comandos encadeados com `&&`, `;`, `|` e variáveis inline `VAR=valor cmd`). Banco "dev local" = host `127.0.0.1`/`localhost` **e** porta `55432` ou `56432`. Prisma `migrate reset`, `db push`, `migrate diff`: bloqueia se qualquer URL na linha de comando ou no `DATABASE_URL`/`SHADOW_DATABASE_URL` efetivo não for dev local (URL ausente em `db push`/`reset` = bloqueia). Docker `exec|cp|compose|run|rm|stop|kill|volume`, `psql` e leitura de caminhos: bloqueia se aparecer `sgo-prod`, `sgo-hml`, `/etc/easypanel` ou `/var/lib/docker/volumes/sgo-`. `psql` com host diferente de dev local bloqueia. `git push` com destino `main` bloqueia.

- [ ] **Step 4: Rodar e ver passar** — o mesmo comando → PASS (16 casos).

- [ ] **Step 5: Ligar os hooks** em `.claude/settings.json`: `PreToolUse` com matcher `Bash` → `node .claude/hooks/guarda-bash.mjs` (lê o JSON do stdin, chama `avaliarComando(tool_input.command, process.env)` e, se `bloquear`, escreve o motivo no stderr e sai com código **2**); `PostToolUse` com matcher `Write|Edit` → `node .claude/hooks/alerta-marca.mjs` (se `tool_input.file_path` estiver em `src/`, `prisma/` ou `worker/` e o arquivo contiver a marca vedada, sai com código 2 e a mensagem "Marca neutra: remova 'CTCEA' (spec §6.7)"). Incluir também uma `permissions.allow` com os comandos de leitura e de teste usados no dia a dia (`npm run *`, `npx vitest *`, `git status`, `git diff *`, `git log *`, `gh issue view *`, `gh pr view *`).

- [ ] **Step 6: Escrever o teste de marca neutra (falha)** em `tests/arquitetura/marca-neutra.test.ts`: (a) `encontrarMarcaVedada('Provisão p/plano CTCEA e ctcea')` retorna 2 ocorrências; `encontrarMarcaVedada('Provisão da instituição')` retorna `[]`; (b) varre `src/`, `prisma/` e `worker/` (se existirem) e espera zero ocorrências, listando os arquivos no erro.

- [ ] **Step 7: Implementar `encontrarMarcaVedada`** e rodar — `npm run test:arq` → PASS. A regex não pode ter a sigla literal, senão `marca.ts` reprova a própria varredura: montar com `new RegExp(['c', 't', 'c', 'e', 'a'].join(''), 'gi')`. Pela mesma razão, os testes ficam em `tests/` e em `.claude/`, fora das pastas varridas.

- [ ] **Step 8: Escrever o `CLAUDE.md`** (curto e estável): o que é o projeto; ler `docs/memoria/memoria-do-projeto.md` no início e atualizá-lo no fim; comandos (`npm run dev|lint|typecheck|test|test:int|test:arq|build`, `docker compose up -d`); as 9 regras invioláveis da memória (seção 2); frentes e propriedade (resumo da spec §12.3 com o link); "IA sugere, não grava"; responder em português do Brasil.

- [ ] **Step 9: Verificar o hook de verdade** — numa sessão do Claude Code neste repositório, pedir para rodar `npx prisma db push` sem `DATABASE_URL` → a ferramenta é bloqueada com o motivo do Step 3.

- [ ] **Step 10: Commit e PR** — branch `us-002-claude-md-hooks`, PR "[US-002][US-012] CLAUDE.md, travas das sessões e marca neutra", `Closes #24`, `Closes #34`, labels `frente:A` e `compartilhado`.

### Task 3: Docker Compose de dev com os limites de D12 (US-003, #25)

**Files:**
- Create: `docker-compose.yml`, `docker/postgres/init/01-papeis.sql` (vazio nesta tarefa, preenchido na Tarefa 4)
- Modify: `.env.example`
- Test: `tests/arquitetura/compose-dev.test.ts`

**Interfaces:**
- Produces: serviços `db`, `mailpit`, `app`, `worker`; variáveis `COMPOSE_PROJECT_NAME`, `DB_PORT`, `APP_PORT`, `MAILPIT_PORT` (padrões da frente A: `sgo-a`, 55432, 3100, 8125).

- [ ] **Step 1: Escrever o teste (falha)** — `tests/arquitetura/compose-dev.test.ts` lê `docker-compose.yml` com `yaml` e verifica, para **cada** serviço: `mem_limit` definido; `oom_score_adj >= 500`; toda entrada de `ports` começa com `127.0.0.1:`; nenhum nome de serviço, volume ou rede contém `prod` ou `hml`; a imagem do `db` é `pgvector/pgvector:pg16`; `app` e `worker` têm `NODE_OPTIONS` com `--max-old-space-size=1536`.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run --project arquitetura tests/arquitetura/compose-dev.test.ts` → FAIL (arquivo não existe).

- [ ] **Step 3: Escrever `docker-compose.yml`.** Limites: `db` 768m, `app` 1536m, `worker` 512m, `mailpit` 64m; `oom_score_adj: 500` em todos. `db` com healthcheck `pg_isready`, volume nomeado e `./docker/postgres/init` montado em `/docker-entrypoint-initdb.d`. `app` e `worker` com `node:22-alpine`, repositório montado em `/app`, comandos `npm run dev` e `npm run worker:dev`. Portas `127.0.0.1:${DB_PORT:-55432}:5432`, `127.0.0.1:${APP_PORT:-3100}:3000`, `127.0.0.1:${MAILPIT_PORT:-8125}:8025`. `.env.example` com os padrões da frente A e um comentário com os valores da frente B.

- [ ] **Step 4: Rodar e ver passar** — o mesmo teste → PASS.

- [ ] **Step 5: Subir de verdade e medir** — `free -m` (anotar), `docker compose up -d db mailpit`, `docker compose ps` (db `healthy`), `ss -ltnp | grep -E '55432|8125'` (só `127.0.0.1`), `free -m` (aumento ≤ 800 MB). Registrar os números no PR.

- [ ] **Step 6: Commit e PR** — branch `us-003-compose-dev`, `Closes #25`, labels `frente:A` e `compartilhado`.

### Task 4: Prisma 7, papéis de banco e trava do shadow (US-004, #26)

**Files:**
- Create: `prisma.config.ts`, `prisma/schema/_base.prisma`, `prisma/migrations/202610260000_nucleo_privilegios/migration.sql`, `prisma/seed.ts`
- Modify: `docker/postgres/init/01-papeis.sql`, `.env.example`, `package.json` (scripts `db:migrate`, `db:deploy`, `db:seed`)
- Create: `src/shared/config/env.ts`, `src/shared/db/prisma.ts`, `src/shared/db/index.ts`, `tests/integracao/banco.ts`
- Test: `src/shared/config/env.test.ts`, `tests/integracao/papeis.int.test.ts`, `tests/integracao/seed.int.test.ts`

**Interfaces:**
- Produces: `lerEnv(fonte?: NodeJS.ProcessEnv): Env` (`Env = { NODE_ENV; DATABASE_URL; MIGRATE_DATABASE_URL?; SHADOW_DATABASE_URL? }`); `validarShadow(databaseUrl: string, shadowUrl: string | undefined): void` (lança `Error`); `criarPrisma(url: string): PrismaClient`; `prisma` (singleton preguiçoso, `DATABASE_URL` com `sgo_app`); `type TxCliente = Prisma.TransactionClient`; `executarSeeds(cliente: PrismaClient, seeds: readonly Seed[]): Promise<void>` com `Seed = { nome: string; executar(tx: TxCliente): Promise<void> }`; `iniciarBancoTeste(): Promise<{ urlApp: string; urlMigrator: string; parar(): Promise<void> }>`.

- [ ] **Step 1: Escrever os testes de `env` (falham)** em `src/shared/config/env.test.ts`:
  - `validarShadow(a, a)` lança "shadow igual ao banco principal";
  - `validarShadow('postgresql://u:x@127.0.0.1:55432/sgo_dev', 'postgresql://u:x@sgo-prod_db:5432/sgo_shadow')` lança "shadow fora do dev local";
  - `validarShadow(dev, 'postgresql://u:x@127.0.0.1:55432/sgo_dev')` lança "o banco shadow deve terminar em _shadow";
  - `validarShadow(dev, 'postgresql://u:x@127.0.0.1:55432/sgo_shadow')` não lança;
  - `validarShadow(dev, undefined)` não lança;
  - `lerEnv({})` lança citando `DATABASE_URL`.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/shared/config/env.test.ts` → FAIL.

- [ ] **Step 3: Implementar `env.ts`** com Zod (URLs `postgresql://`; dev local = host `127.0.0.1`/`localhost` e porta 55432/56432).

- [ ] **Step 4: Rodar e ver passar** — o mesmo comando → PASS.

- [ ] **Step 5: Configurar o Prisma 7.** `prisma.config.ts` com `schema: 'prisma/schema'`, `migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' }`, datasource com `MIGRATE_DATABASE_URL` e `shadowDatabaseUrl` passando por `validarShadow`. `_base.prisma` com `generator client { provider = "prisma-client"; output = "../../src/generated/prisma" }` e `datasource db { provider = "postgresql" }`. `criarPrisma` usa `@prisma/adapter-pg`. Conferir a sintaxe exata do Prisma 7 na documentação oficial antes de escrever (mudou em relação ao 6).

- [ ] **Step 6: Papéis em `01-papeis.sql`** (só dev e teste; hml/prod ficam com a frente B na US-014): bancos `sgo_dev`, `sgo_shadow`, `sgo_teste`; papéis `sgo_migrator` (dono do schema `public`), `sgo_app` e `sgo_sync` com `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, senhas de dev fixas e documentadas no `.env.example`. A migration `202610260000_nucleo_privilegios` faz `REVOKE CREATE ON SCHEMA public FROM PUBLIC` e `ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sgo_app, sgo_sync` (mais `USAGE, SELECT ON SEQUENCES`).

- [ ] **Step 7: Helper de teste `tests/integracao/banco.ts`** — `iniciarBancoTeste()` sobe `pgvector/pgvector:pg16` com `@testcontainers/postgresql`, **memória limitada a 512 MB** (D12), aplica `01-papeis.sql` e roda `prisma migrate deploy` com a URL do migrator.

- [ ] **Step 8: Escrever os testes de papéis (falham)** em `tests/integracao/papeis.int.test.ts`:
  - conectado como `sgo_app`, `CREATE TABLE x (id int)` → erro `permission denied for schema public`;
  - `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'sgo_app'` → `false`;
  - o migrator cria `CREATE TABLE t_priv (id int)`, e `sgo_app` consegue `INSERT INTO t_priv VALUES (1)`.

- [ ] **Step 9: Rodar e ver passar** — `npm run test:int -- papeis` → PASS.

- [ ] **Step 10: Seed idempotente** — `prisma/seed.ts` chama `executarSeeds(cliente, seeds)`, cada seed numa transação própria; a lista começa vazia e recebe as seeds dos módulos (P5). Teste `tests/integracao/seed.int.test.ts`: com uma seed de teste que faz *upsert* de uma linha, rodar duas vezes deixa 1 linha e não lança.

- [ ] **Step 11: Verificar no dev** — `docker compose up -d db`, `npm run db:deploy`, `npm run db:seed` duas vezes sem erro.

- [ ] **Step 12: Commit e PR** — branch `us-004-prisma-papeis`, `Closes #26`, labels `frente:A`, `compartilhado` e `migration`.

### Task 5: Núcleo de dinheiro, percentual e competência (US-005, #27)

**Files:**
- Create: `src/shared/kernel/{dinheiro.ts, percentual.ts, competencia.ts, distribuir.ts, resultado.ts, erros.ts, index.ts}`
- Modify: `eslint.config.mjs` (restrição de sintaxe em `domain/` e `kernel/`)
- Test: `src/shared/kernel/{dinheiro,percentual,competencia,distribuir}.test.ts`, `tests/arquitetura/fronteiras.test.ts` (novo caso)

**Interfaces:**
- Produces:
  - `class Dinheiro` — `static de(v: string | Decimal): Dinheiro` (Half-Even em 2 casas; lança `TypeError` para `number`; lança `ErroDominio('VALOR_FORA_DO_LIMITE')` acima de 9.999.999.999.999,99 em módulo); `static zero()`; `static somarTodos(xs: readonly Dinheiro[])`; `somar`, `subtrair`, `multiplicar(f: string | Decimal)`, `dividir(d: string | Decimal)` (resultado arredondado Half-Even); `negar()`; `comparar(o): -1 | 0 | 1`; `ehZero()`, `ehNegativo()`; `paraString(): string` (`"1234.50"`); `formatar(): string` (`"R$ 1.234,50"`, negativo `"-R$ 37.109,70"`); `paraDecimal(): Decimal`.
  - `class Percentual` — `static dePontos(v: string | Decimal)` (pontos percentuais, 4 casas: `"51"` = 51%); `static razao(num: Dinheiro, den: Dinheiro): Percentual | null` (pontos com 2 casas Half-Even; `null` se `den` for zero); `comoFracao(): Decimal`; `paraString(): string` (`"80.79"`); `formatar(): string` (`"80,79%"`).
  - `class Competencia` — `static de(ano: number, mes: number)`; `static parse(s: string)` (`"Jun/22"`, aceita minúsculas); `formatar()` (`"Jun/22"`); `comparar`; `proxima()`; `ano`, `mes`.
  - `distribuirEm12(anual: Dinheiro): readonly Dinheiro[]`.
  - `type Resultado<T, E = readonly ErroCampo[]> = { ok: true; valor: T } | { ok: false; erros: E }`, `ok(v)`, `falha(erros)`; `type ErroCampo = { campo: string; mensagem: string }`; `class ErroDominio extends Error { constructor(codigo: string, mensagem: string, detalhes?: Record<string, unknown>) }`.

- [ ] **Step 1: Escrever os testes (falham):**

```ts
it.each([['0.125','0.12'],['0.135','0.14'],['2.675','2.68'],['-0.125','-0.12'],['1.005','1.00'],['7500','7500.00']])
  ('Half-Even %s → %s', (e, s) => expect(Dinheiro.de(e).paraString()).toBe(s));
it('rejeita number', () => expect(() => Dinheiro.de(0.3 as never)).toThrow(TypeError));
it('limite NUMERIC(15,2)', () => expect(() => Dinheiro.de('10000000000000.00')).toThrow(ErroDominio));
it('formata', () => { expect(Dinheiro.de('1234.5').formatar()).toBe('R$ 1.234,50'); expect(Dinheiro.de('-37109.7').formatar()).toBe('-R$ 37.109,70'); });
it('soma exata do AC01 do OxR', () => expect(Dinheiro.somarTodos(['301922.05','50148.86','101916.93','80813.67','7083.48','4310.03'].map(Dinheiro.de)).paraString()).toBe('546195.02'));
// percentual.test.ts
it.each([['569413.56','704831.00','80.79'],['713183.14','540656.00','131.91'],['1282596.70','1245487.00','102.98']])
  ('RN_OXR_010 %s/%s = %s%%', (n, d, p) => expect(Percentual.razao(Dinheiro.de(n), Dinheiro.de(d))?.paraString()).toBe(p));
it('RN_OXR_012 orçado zero → null', () => expect(Percentual.razao(Dinheiro.de('10'), Dinheiro.zero())).toBeNull());
it('encargo 51% como fração', () => expect(Percentual.dePontos('51').comoFracao().toString()).toBe('0.51'));
// competencia.test.ts
it('RN0302', () => { expect(Competencia.parse('Jun/22').formatar()).toBe('Jun/22'); expect(Competencia.de(2026, 12).proxima().formatar()).toBe('Jan/27'); expect(() => Competencia.parse('Jun/2022')).toThrow(ErroDominio); });
// distribuir.test.ts
it('100,00 em 12', () => { const p = distribuirEm12(Dinheiro.de('100')); expect(p.slice(0, 11).every(x => x.paraString() === '8.33')).toBe(true); expect(p[11]!.paraString()).toBe('8.37'); });
it('igual à planilha-modelo', () => { const p = distribuirEm12(Dinheiro.de('4368.87')); expect(p[0]!.paraString()).toBe('364.07'); expect(p[11]!.paraString()).toBe('364.10'); });
it('propriedade: soma = anual', () => fc.assert(fc.property(fc.bigInt({ min: -10n ** 12n, max: 10n ** 12n }), c => {
  const anual = Dinheiro.de(new Decimal(c.toString()).div(100)); expect(Dinheiro.somarTodos(distribuirEm12(anual)).paraString()).toBe(anual.paraString()); })));
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/shared/kernel` → FAIL.

- [ ] **Step 3: Implementar** com um construtor de `decimal.js` isolado (`Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 })`); `formatar` com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` sobre a string (nunca sobre `number` derivado de cálculo), normalizando o espaço inseparável para espaço comum. `distribuirEm12`: 11 parcelas = `dividir('12')`, dezembro = anual − soma das 11.

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/shared/kernel` → PASS.

- [ ] **Step 5: Barrar `number` para dinheiro no lint** — `no-restricted-syntax` / `no-restricted-properties` em `src/modules/*/domain/**` e `src/shared/kernel/**` para `parseFloat`, `Number.parseFloat`, `Math.round`, `.toFixed`, com a mensagem "Use Dinheiro/Percentual (spec §5)". Novo caso em `fronteiras.test.ts`: `const x = Math.round(1.5);` em `src/modules/orc/domain/a.ts` → erro. Rodar `npm run test:arq` → PASS.

- [ ] **Step 6: Commit e PR** — branch `us-005-dinheiro`, `Closes #27`, label `frente:A`.

### Task 6: Histórico de Operações append-only (US-006, #28)

**Files:**
- Create: `prisma/schema/nucleo.prisma`, `prisma/migrations/<timestamp>_nucleo_historico/migration.sql`
- Create: `src/shared/audit/{auditar.ts, descricao.ts, delta.ts, serializar.ts, tipos.ts, index.ts}`
- Test: `src/shared/audit/{descricao,delta,serializar}.test.ts`, `tests/integracao/auditoria.int.test.ts`

**Interfaces:**
- Consumes: `TxCliente`, `prisma` (Tarefa 4); `ErroDominio` (Tarefa 5).
- Produces: `type TipoOperacao = 'INSERCAO' | 'ALTERACAO' | 'EXCLUSAO' | 'CONSULTA' | 'IMPRESSAO' | 'EXPORTACAO' | 'LOGIN' | 'LOGOFF' | 'SISTEMA'`; `type OrigemOperacao = 'USUARIO' | 'SISTEMA' | 'SUGESTAO_IA'`; `type ContextoAuditoria = { usuarioId: string | null; usuarioRotulo: string; sessaoUid: string | null; ip: string | null; unidadeId?: string | null }`; `type EventoAuditoria = { contexto: ContextoAuditoria; funcionalidade: string; tipo: TipoOperacao; registroId?: string; descricao?: string; antes?: unknown; depois?: unknown; origem?: OrigemOperacao }`; `auditar(tx: TxCliente, evento: EventoAuditoria): Promise<void>`; `descrever(tipo: TipoOperacao, funcionalidade: string, registroId?: string): string`; `calcularDelta(antes: unknown, depois: unknown): Record<string, { de: unknown; para: unknown }>`; `serializarParaAuditoria(v: unknown): unknown`.

- [ ] **Step 1: Escrever os testes unitários (falham):**
  - `descrever('INSERCAO', 'Usuários', '42')` = `"Inseriu o registro 42 referente à Usuários"` (RN0089); `ALTERACAO` → `"Alterou o registro 42 referente à Usuários"` (RN0090); `EXCLUSAO` → `"Excluiu o registro 42 referente à Usuários"` (RN0091); `CONSULTA` → `"Acessou a funcionalidade Usuários"` (RN0092); `IMPRESSAO` → `"Imprimiu a listagem referente à Usuários"` (RN0093); `EXPORTACAO` → `"Exportou a listagem referente à Usuários"` (RN0094); `LOGIN` → `"Entrou no sistema"`; `LOGOFF` → `"Saiu do sistema"`; `SISTEMA` → `"Ação automática do sistema referente à Usuários"`.
  - `calcularDelta({ a: 1, b: 'x' }, { a: 2, b: 'x', c: true })` = `{ a: { de: 1, para: 2 }, c: { de: undefined, para: true } }`; `calcularDelta(null, { a: 1 })` = `{ a: { de: undefined, para: 1 } }`.
  - **serializa Decimal, Date e BigInt:** `serializarParaAuditoria({ v: new Decimal('1234.5'), d: new Date('2026-10-26T12:00:00Z'), n: 42n, m: Dinheiro.de('10') })` = `{ v: '1234.5', d: '2026-10-26T12:00:00.000Z', n: '42', m: '10.00' }`.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/shared/audit` → FAIL.

- [ ] **Step 3: Implementar `descricao.ts`, `delta.ts` e `serializar.ts`.** Rodar → PASS.

- [ ] **Step 4: Modelo e migration.** `nucleo.prisma`: model `HistoricoOperacao` (`@@map("historico_operacao")`) com `id BigInt @id @default(autoincrement())`, `ocorridoEm DateTime @default(now()) @db.Timestamptz(6)`, `unidadeId String? @db.Uuid`, `usuarioId String? @db.Uuid`, `usuarioRotulo String`, `sessaoUid String?`, `ip String? @db.Inet`, `funcionalidade String`, `tipoOperacao TipoOperacao`, `registroId String?`, `descricao String`, `antes Json?`, `depois Json?`, `delta Json?`, `origem OrigemOperacao @default(USUARIO)`, índices `(funcionalidade, ocorridoEm)` e `(usuarioId, ocorridoEm)`. Migration SQL acrescenta a função `historico_somente_insercao()` que faz `RAISE EXCEPTION 'historico_operacao é somente inserção'`, os triggers `BEFORE UPDATE OR DELETE` (por linha) e `BEFORE TRUNCATE` (por comando), e `REVOKE UPDATE, DELETE, TRUNCATE ON historico_operacao FROM sgo_app, sgo_sync`.

- [ ] **Step 5: Implementar `auditar`** — valida o evento com Zod (`funcionalidade` não vazia, `usuarioRotulo` não vazio), preenche `descricao` com `descrever` quando ausente, serializa `antes`/`depois`, calcula o `delta` e insere com o `tx` recebido. Erro de validação lança `ErroDominio('AUDITORIA_INVALIDA')`.

- [ ] **Step 6: Escrever os testes de integração (falham)** em `tests/integracao/auditoria.int.test.ts` (tabela auxiliar `t_operacao` criada pelo migrator no `beforeAll`):
  - `auditar` dentro de `$transaction` grava 1 linha com a `descricao` de RN0089;
  - como `sgo_app`, `UPDATE historico_operacao SET descricao = 'x'` → erro contendo `permission denied`; como migrator → erro contendo `somente inserção`;
  - **falha na auditoria desfaz a operação:** `$transaction(async tx => { await tx.$executeRaw\`INSERT INTO t_operacao VALUES (1)\`; await auditar(tx, { ...evento, funcionalidade: '' }); })` rejeita, e `SELECT count(*) FROM t_operacao` = 0.

- [ ] **Step 7: Rodar e ver passar** — `npm run test:int -- auditoria` → PASS.

- [ ] **Step 8: Commit e PR** — branch `us-006-auditoria`, `Closes #28`, labels `frente:A` e `migration`.

### Task 7: Guarda de autorização obrigatória (US-008, #30)

**Files:**
- Create: `src/shared/authz/{tipos.ts, contexto.ts, exigir.ts, definir-acao.ts, definir-rota.ts, index.ts}`
- Test: `src/shared/authz/{exigir,definir-acao}.test.ts`, `tests/arquitetura/guarda-acoes.test.ts`

**Interfaces:**
- Consumes: `Resultado`, `ErroCampo`, `ErroDominio` (Tarefa 5); `auditar`, `ContextoAuditoria` (Tarefa 6); `prisma` (Tarefa 4).
- Produces: `type Acao = 'consultar' | 'incluir' | 'alterar' | 'excluir' | 'exportar' | 'imprimir' | 'aprovar' | 'executar'`; `type ContextoRequisicao = ContextoAuditoria & { permissoes: ReadonlySet<string> }` (chave `"<funcionalidade>:<acao>"`); `interface ProvedorContexto { obter(): Promise<ContextoRequisicao | null> }`; `configurarProvedorContexto(p: ProvedorContexto): void` (o módulo `aut` registra o real no P5); `class ErroPermissao extends ErroDominio`; `exigir(ctx: ContextoRequisicao, funcionalidade: string, acao: Acao): void`; `type RespostaAcao<O> = Resultado<O> | { ok: false; status: 401 | 403; erros: readonly ErroCampo[] }`; `definirAcao<I, O>(cfg: { funcionalidade: string; acao: Acao; entrada: z.ZodType<I> }, executar: (entrada: I, ctx: ContextoRequisicao) => Promise<Resultado<O>>): (entradaBruta: unknown) => Promise<RespostaAcao<O>>`; `definirRota(cfg: { funcionalidade: string; acao: Acao }, executar: (req: Request, ctx: ContextoRequisicao) => Promise<Response>): (req: Request) => Promise<Response>`.

- [ ] **Step 1: Escrever os testes unitários (falham)** — com provedor de contexto falso e auditor de negação injetado (`configurarAuditorNegacao(fn)`, para não depender do banco):
  - sem contexto → `{ ok: false, status: 401, erros: [{ campo: '_', mensagem: 'Sessão expirada. Entre novamente.' }] }`, e `executar` não é chamado;
  - sem a permissão `usuarios:incluir` → `status: 403`, mensagem `'Você não tem permissão para esta ação.'`, e o auditor recebe um evento `SISTEMA` com descrição `'Acesso negado à funcionalidade usuarios (incluir)'`;
  - entrada inválida para o schema Zod → `{ ok: false, erros: [{ campo: 'nome', mensagem: ... }] }` (TRAVA O ERRO, sem lançar);
  - `executar` lança `ErroDominio('X', 'Mensagem clara')` → `{ ok: false, erros: [{ campo: '_', mensagem: 'Mensagem clara' }] }`;
  - `executar` lança `Error` qualquer → `{ ok: false, erros: [{ campo: '_', mensagem: 'Erro inesperado. Tente novamente.' }] }`, e o erro vai para o log;
  - caminho feliz → o `Resultado` de `executar`;
  - `definirRota` sem permissão → `Response` com status 403.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/shared/authz` → FAIL.

- [ ] **Step 3: Implementar** os arquivos de `shared/authz`. O auditor de negação padrão grava com `auditar` numa transação própria do `prisma`.

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/shared/authz` → PASS.

- [ ] **Step 5: Teste de arquitetura (falha → passa)** em `tests/arquitetura/guarda-acoes.test.ts`: (a) para todo arquivo em `src/` cuja primeira instrução é `'use server'`, nenhum `export async function` e todo `export const` inicializado com `definirAcao(`; (b) todo `src/app/**/route.ts` exporta handlers criados com `definirRota(`. Incluir fixtures em `tests/arquitetura/fixtures/` (uma ação sem guarda e uma com guarda) e testar a função de verificação contra elas, além da varredura real de `src/`.

- [ ] **Step 6: Commit e PR** — branch `us-008-guarda-rbac`, `Closes #30`, label `frente:A`.

### Task 8: TotalizerService (US-009, #31)

**Files:**
- Create: `src/shared/totalizer/{arvore.ts, totalizar.ts, index.ts}`
- Test: `src/shared/totalizer/totalizar.test.ts`

**Interfaces:**
- Consumes: `Dinheiro`, `Percentual`, `ErroDominio` (Tarefa 5).
- Produces: `type NoArvore = { id: string; paiId: string | null; tipo: 'SINTETICA' | 'ANALITICA' }`; `type ResultadoTotalizacao = { valor(id: string): Dinheiro; total: Dinheiro; percentualDoPai(id: string): Percentual | null; percentualDoTotal(id: string): Percentual | null }`; `totalizar(nos: readonly NoArvore[], valores: ReadonlyMap<string, Dinheiro>): ResultadoTotalizacao`; `totalizarSerie(nos: readonly NoArvore[], valores: ReadonlyMap<string, readonly Dinheiro[]>, meses?: number): { valor(id: string): readonly Dinheiro[]; total: readonly Dinheiro[] }`. O total é a soma das raízes (RN_OXR_009).

- [ ] **Step 1: Escrever os testes (falham):**
  - **AC01:** árvore 4 → 4.1 → 4.1.1 → 4.1.1.1 com as 24 analíticas de pessoal, das quais 6 com valor (301.922,05; 50.148,86; 101.916,93; 80.813,67; 7.083,48; 4.310,03) e 18 ausentes do mapa → `valor('4.1.1.1')` = `546195.02`, e `total` também;
  - **AC02–AC04 com série:** analítica única sob 4.1.1.1 com orçado `[704831.00, 540656.00]` e realizado `[569413.56, 713183.14]` → somas do período `1245487.00` e `1282596.70`; saldo `-37109.70`; `Percentual.razao` do período `102.98`;
  - valor numa sintética → `ErroDominio` com código `VALOR_EM_SINTETICA`; pai inexistente → `PAI_INEXISTENTE`; ciclo → `CICLO`;
  - `percentualDoPai` de um filho de pai com valor zero → `null`;
  - desempenho (spec §10.3): 1.000 analíticas sob 50 sintéticas, `totalizar` em menos de 2.000 ms.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/shared/totalizer` → FAIL.

- [ ] **Step 3: Implementar** — indexar filhos por pai, validar (pai existe, sem ciclo, valor só em analítica) e somar em pós-ordem. Função pura: sem I/O e sem persistir sintéticas.

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/shared/totalizer` → PASS.

- [ ] **Step 5: Commit e PR** — branch `us-009-totalizer`, `Closes #31`, label `frente:A`.

### Task 9: Worker, filas e *outbox* (US-010, #32)

**Files:**
- Create: `worker/index.ts`, `src/shared/filas/{fila.ts, pgboss.ts, outbox.ts, index.ts}`
- Modify: `prisma/schema/nucleo.prisma` (model `OutboxMensagem`), nova migration `<timestamp>_nucleo_outbox`, `docker/postgres/init/01-papeis.sql` (papel `sgo_fila`, dono do schema `pgboss`), `.env.example` (`FILA_DATABASE_URL`), `package.json` (scripts `worker:dev` = `tsx watch worker/index.ts`, `worker:start`)
- Test: `tests/integracao/filas.int.test.ts`

**Interfaces:**
- Consumes: `TxCliente`, `prisma` (Tarefa 4).
- Produces: `type NomeFila = 'teste.eco' | 'email.enviar' | 'outbox.publicar'` (novos nomes entram nessa união); `interface Fila { enviar<T extends object>(nome: NomeFila, dados: T, opcoes?: { chaveUnica?: string; tentativas?: number }): Promise<string> }`; `criarFila(urlBanco: string): Promise<Fila & { parar(): Promise<void>; registrarTrabalhador<T>(nome: NomeFila, tratar: (dados: T) => Promise<void>): Promise<void> }>`; `registrarNoOutbox(tx: TxCliente, tipo: NomeFila, dados: object): Promise<void>`; `publicarOutbox(fila: Fila, cliente: PrismaClient, lote?: number): Promise<number>`. Padrão de novas tentativas: 5, com espera de 30 s e *backoff*.

- [ ] **Step 1: Escrever os testes de integração (falham)** em `tests/integracao/filas.int.test.ts` (pg-boss sobre o banco do Testcontainers, como `sgo_fila`):
  - `enviar('teste.eco', { x: 1 })` → o trabalhador registrado recebe `{ x: 1 }` em até 5 s;
  - trabalhador que lança, com `tentativas: 1` → o job fica `failed` e continua consultável (job com falha visível e reprocessável);
  - *outbox*: `registrarNoOutbox` numa transação que commita → `publicarOutbox` publica 1 e marca `publicadoEm`; numa transação desfeita → `publicarOutbox` publica 0;
  - `publicarOutbox` rodando duas vezes ao mesmo tempo não publica a mesma linha duas vezes (`FOR UPDATE SKIP LOCKED`).

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- filas` → FAIL.

- [ ] **Step 3: Implementar** — `OutboxMensagem` (`id uuid`, `tipo`, `dados Json`, `criadoEm`, `publicadoEm DateTime?`, índice parcial em `publicadoEm IS NULL`). `worker/index.ts`: lê o env, cria a fila, registra `outbox.publicar` agendado a cada 10 s e trata `SIGTERM` com encerramento limpo.

- [ ] **Step 4: Rodar e ver passar** — `npm run test:int -- filas` → PASS.

- [ ] **Step 5: Verificar no dev** — `docker compose up -d` (db, mailpit, app, worker); `docker compose logs worker` mostra "worker pronto"; `docker stats --no-stream` com cada contêiner abaixo do `mem_limit`.

- [ ] **Step 6: Commit e PR** — branch `us-010-worker-filas`, `Closes #32`, labels `frente:A` e `migration`. Após o merge, `worker/` passa a ser da frente B (spec §12.3).

---

## Encerramento do P1

- [ ] `npm run lint && npm run typecheck && npm test && npm run test:arq && npm run test:int && npm run build` verde na `main`.
- [ ] Atualizar `docs/memoria/memoria-do-projeto.md` (estado, pendências, diário) e avisar o PO de que a frente B pode criar a worktree (spec §12.11).
- [ ] Detalhar o P5 (Acesso) com o writing-plans, a partir das interfaces reais do P1.
