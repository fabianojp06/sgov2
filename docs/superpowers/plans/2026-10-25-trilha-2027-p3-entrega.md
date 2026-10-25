# Trilha 2027 · P3 Entrega (frente B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. As Tarefas 6 a 8 têm passos executados pelo PO no Easypanel, no GitHub e no host: nesses passos, a sessão prepara os arquivos e o roteiro, e o PO executa e confirma.

**Goal:** Levar o código da `main` até hml e prod de forma automática e reproduzível, com o banco de produção protegido por backup restaurável, e entregar à frente A os contratos C3 (componentes de tela) e C4 (e-mail) antes de 11/11.

**Architecture:**
- **Verificações e imagem.** O GitHub Actions faz as verificações de PR (spec §10.4 e §12.8) e, na `main`, constrói **uma** imagem Docker (app + worker, entrypoints distintos). A imagem vai para o GHCR, e um *webhook* do Easypanel faz o deploy em hml.
- **Migration antes do app.** O contêiner roda `prisma migrate deploy` antes de subir o app. Se falhar, o contêiner sai com erro antes de abrir a porta, e o Easypanel, com atualização *start-first*, mantém a versão anterior.
- **Prod por tag.** O prod recebe, por tag `vX.Y.Z` e com aprovação do PO num *environment* protegido, a mesma imagem já publicada para aquele commit, nunca uma imagem reconstruída.
- **Backup.** pgBackRest (WAL contínuo) e dump diário, criptografados, para um storage S3 fora da VPS.
- **Contratos.** PRs pequenos em `src/modules/ger/` com tipos, assinaturas e adaptador falso, todos exportados pelo `index.ts`.

**Tech Stack:** GitHub Actions (actions fixadas por SHA de commit, *environments* com *secrets* próprios) · Docker BuildKit · GHCR · Easypanel (Docker Swarm) + Traefik/Let's Encrypt · PostgreSQL 16 (`pgvector/pgvector:pg16` por digest) · Prisma 7.10.1 (`migrate deploy`, `migrate resolve`, `migrate diff`) · pgBackRest · bats-core e shellcheck (já usados no P2) · Node 22.23 · React 19.3.1 · Vitest 5.0.5.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (v1.3) — §4.2, §4.3, §10.4, §11.1 item 2a, §11.5, §12.3, §12.6, §12.7, §12.8, §12.12. **Plano-mestre:** `docs/superpowers/plans/2026-10-24-trilha-2027-plano-mestre.md`. **Abertura da frente B:** `docs/backlog/abertura-frente-b.md`.

## Global Constraints

- **D12 / spec §11.5 item 6:** nenhuma sessão toca contêineres, redes, volumes ou variáveis de `sgo-prod`/`sgo-hml`. O que é feito no Easypanel, no GitHub (*secrets*, *environments*, *rulesets*) ou no host com credencial de produção, **o PO executa**. A sessão entrega o arquivo, o comando e a verificação esperada.
- **Credenciais de hml e prod** existem só em três lugares, nunca no repositório, em `.env` de dev ou em log do CI:
  - nas variáveis do Easypanel;
  - nos *secrets* de *environment* do GitHub, `homologacao` (só a `main`) e `producao` (só tags `v*`, com aprovação do PO);
  - para o teste de restauração, num arquivo do host legível só por root.
  Nenhum *secret* fica no nível do repositório. Assim, um workflow alterado numa branch não consegue lê-los.
- **Imagem de prod fora do alcance do `GITHUB_TOKEN`:** um workflow alterado numa branch pode pedir `packages: write` e sobrescrever tags no GHCR. Por isso, o prod puxa de um pacote separado, `ghcr.io/fabianojp06/sgov2-prod`, em que o repositório tem só leitura (*Manage Actions access*). A escrita nesse pacote usa um token guardado só no *environment* `producao` (`GHCR_PROD_TOKEN`). O pacote `sgov2` (hml e `sha-*`) continua gravável pelo `GITHUB_TOKEN`; esse risco fica aceito para hml.
- **Banco:** `migrate diff` só contra o banco efêmero do CI ou o dev local (`127.0.0.1`/`localhost`, portas 55432/56432), nunca contra hml ou prod (spec §12.7 item 4). Em hml e prod, só `prisma migrate deploy` pelo entrypoint do contêiner, e `migrate resolve` pelo PO, seguindo o runbook.
- **Processo pesado (D12):** build de imagem e `test:int` rodam no GitHub Actions. Na VPS, só com a frente A sem build ou `test:int` rodando, com `nice -n 10`, um por vez. Todo contêiner que a frente B sobe na VPS fora do Easypanel (restauração, testes) tem `mem_limit`, `oom_score_adj` ≥ 500 e porta só em `127.0.0.1`.
- **Propriedade (spec §12.3, `.github/frentes.yml`):** este bloco só cria arquivos em `.github/workflows/`, `docker/`, `deploy/`, `ops/`, `docs/operacao/` e `src/modules/ger/`. O Dockerfile fica em `docker/app.Dockerfile`, com o `docker/app.Dockerfile.dockerignore` ao lado (o BuildKit lê o *ignore* específico do Dockerfile). Assim nenhum arquivo cai como compartilhado por estar fora do mapa (um `.dockerignore` na raiz cairia). Dependência nova (ExcelJS, TanStack, compilador do worker) e mudança no `vitest.config.ts` ou em `.claude/` só em PR `compartilhado`.
- **`worker/`:** nenhum arquivo antes do merge da US-010 (P1 Tarefa 9, frente A). Até lá, a imagem tem só o entrypoint do app, e o do worker entra no Step 10 da Tarefa 4. A P1 Tarefa 9 altera o `docker/postgres/init/01-papeis.sql` (papel `sgo_fila`), que é da frente B: a frente A usa a label `toca-outra-frente`, e a frente B revisa.
- **Commits e PRs:**
  - branch `us-NNN-slug` e título `[US-NNN] …`;
  - `Closes #n` só no PR que prova o último critério de aceite; os anteriores usam `Refs #n`;
  - label `frente:B`, commits com `Frente: B` e os trailers de coautoria;
  - push, PR, tag e merge só com confirmação do PO;
  - comentário "Revisão de código (12.12)" antes de chamar o PO.
- **Marca neutra:** nada de "CTCEA" em `docker/`, `deploy/`, `ops/`, modelos de e-mail nem nomes de imagem. O nome exibido vem de `instituicao.nome_exibicao`.
- Textos de interface, logs e mensagens de CI em português do Brasil.

## Decisões pedidas ao PO neste plano

1. **`Refs #n` aceito pela verificação de vínculo.** A §12.8 fala só em `Closes #n`. O plano aceita também `Refs #n`, para PRs parciais e de contrato. Se aprovar, registrar na spec (v1.4).
2. **Aprovação manual do deploy em prod** (*environment* `producao` com o PO como revisor). Recomendado: sempre, porque é nesse momento que o PO confirma o snapshot da Hostinger exigido pela §4.3 quando há migration.
3. **Local do teste do SQL de papéis** (Tarefa 5). Recomendado: um PR `compartilhado` que acrescenta `deploy/**/*.int.test.ts` ao projeto `integracao` do `vitest.config.ts`.
4. **Trava de prod no hook das sessões** (PR `compartilhado` em `.claude/hooks/`). Como o PO e as sessões usam o mesmo usuário do GitHub, a aprovação do *environment* não barra uma sessão. A trava bloquearia:
   - `git tag v*`, `git push --tags`, `git push origin v*` e `gh release create`, porque a tag dispara o prod;
   - `gh api …/pending_deployments`, que aprovaria o *environment*;
   - `gh workflow run` com `rollback`.
   Junto, o PO cria um *ruleset* de tag no GitHub restringindo `v*`.

## Review Focus

1. **Segredo no log, na imagem ou ao alcance de uma branch.** Riscos: o URL do webhook ou o token do GHCR no log do Actions, um `.env*` dentro da imagem, ou um workflow alterado numa branch lendo o *secret*.
   Esperado:
   - *secrets* só de *environment*, lidos via `env:` do passo e nunca interpolados em `run:`;
   - `curl` sem `-v`;
   - o *ignore* exclui `.env*`, `.git`, `node_modules`, `docs/`, `especificacao/` e as notas da raiz.
   Teste: o job `Imagem` lista `/app` dentro da imagem e reprova se aparecer `.env` ou `.git` (Tarefa 4).
2. **Migration com falha derrubando ou travando a versão no ar.** Em `stop-first`, o contêiner antigo para antes do novo falhar. E uma migration que falha fica marcada em `_prisma_migrations`, travando todo deploy seguinte (P3009).
   Esperado:
   - o entrypoint sai com código ≠ 0 antes de abrir a porta;
   - o serviço fica em *start-first*;
   - o runbook tem o procedimento "migration presa" (`entrypoint.sh resolver <migration>`, executado pelo PO).
   Teste no CI: migration quebrada → código ≠ 0 e nenhuma resposta HTTP. Prova em hml na Tarefa 6, com uma tag de teste própria, sem tocar a tag `hml`.
3. **Prod com imagem que não passou por hml, ou disparado sem o PO.** Riscos: uma tag reconstruindo a imagem, uma tag num commit fora da `main`, ou uma sessão criando a tag.
   Esperado:
   - o job de prod só copia `sgov2:sha-<commit>` já existente para `sgov2-prod` (`docker buildx imagetools create`), sem reconstruir;
   - reprova se a imagem não existir ou se o commit não for ancestral de `origin/main`;
   - roda no *environment* `producao` com aprovação do PO, depois de um job sem *environment* que mostra as checagens (Tarefa 4);
   - o pacote `sgov2-prod` não é gravável pelo `GITHUB_TOKEN`;
   - a tag `v*` é protegida por *ruleset*, e a aprovação e a tag pela trava do hook (Decisão 4).
4. **Verificação de fronteira burlável.** Riscos: renomear um arquivo da frente A para fora do mapa, apagar um arquivo da outra frente, trocar a label depois do CI verde, ou abrir o PR sem `frente:X`.
   Esperado: lista de arquivos com `git diff --name-only --no-renames` (renomeação vira remoção + criação); workflow próprio, que reage a `labeled`/`unlabeled`/`edited`; falta ou duplicidade de `frente:X` reprova (Tarefa 1).
5. **`migrate diff` apontando para fora do CI.** Risco: uma variável do runner ou um *secret* com URL de hml.
   Esperado: o job usa só o *service container* em `localhost:56432`, aceito pela trava do `prisma.config.ts`, sem nenhum *secret*. O passo imprime host e porta da `MIGRATE_DATABASE_URL`, sem a senha, e falha se não forem `localhost:56432` (Tarefa 1).
6. **Senha temporária persistida em texto puro no *outbox*.** Risco: a senha inicial da US-038 ficaria na tabela do *outbox* e no job do pg-boss.
   Esperado: o contrato C4 marca os modelos sensíveis (`MODELOS_SENSIVEIS`), e a US-025 apaga esses dados do *outbox* e do job depois do envio (Tarefa 3).
7. **Contrato de tela que não atravessa a fronteira de Server Components.** Risco: funções e instâncias de `Dinheiro` passadas a um componente `'use client'` quebram em toda página da frente A.
   Esperado: *props* serializáveis (colunas declarativas, valores como string), navegação por `href` e ação por Server Action. O ExcelJS carregado com `await import()` dentro de `exportarXlsx`, fora do *bundle* do navegador (Tarefa 2).
8. **Backup que não restaura e chaves do storage expostas.**
   Esperado:
   - teste de restauração com resultado registrado;
   - chave de **escrita** só na variável do serviço `db` no Easypanel, que é onde o `archive_command` roda;
   - chave **só de escrita**, restrita ao prefixo `dumps/`, para o dump diário, em `/etc/sgo/backup-dump.env` (root, modo 600);
   - chave **só de leitura** e senha do cofre do pgBackRest, para o teste de restauração, em `/etc/sgo/backup-leitura.env` (root, modo 600);
   - repositório do pgBackRest e dumps **criptografados** antes de sair da VPS;
   - cópia da senha do cofre e da chave privada do `age` guardada pelo PO **fora** da VPS: se a VPS se perder, o backup continua legível;
   - bucket com versionamento e retenção por regra de *lifecycle* (Tarefa 7).

---

### Task 1: Verificações de PR no CI (US-013 parte 1/2, #35)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/pr.yml`, `ops/ci/vinculo-pr.sh`, `ops/ci/frente-do-pr.sh`
- Test: `ops/ci/testes/vinculo-pr.bats`, `ops/ci/testes/frente-do-pr.bats`

**Interfaces:**
- Consumes: `scripts/frentes/verificar.ts` (CLI `--frente A|B --labels a,b`, arquivos no stdin, saída 1 com violação), `docker/postgres/init/01-papeis.sql`, `npm run db:deploy`.
- Produces:
  - `frente-do-pr.sh "<labels separadas por vírgula>"`: imprime `A` ou `B` e sai com 0 quando há exatamente uma label `frente:A` ou `frente:B`; sem nenhuma ou com as duas, sai com 1 e explica no stderr;
  - `vinculo-pr.sh`: lê o corpo do PR no stdin; sai com 0 se houver `Closes #<n>` (também `Fixes`/`Resolves`, sem diferenciar maiúsculas) ou `Refs #<n>`; senão, sai com 1;
  - nomes de job estáveis, para a proteção da `main`: no `ci.yml`, `Lint, tipos, testes e build` (já existe), `Testes de integração`, `Migrations` e `Scripts de operação`; no `pr.yml`, `Fronteira de frente`.

- [ ] **Step 1: Escrever os testes bats (falham)**:
  - `frente-do-pr.sh "frente:B,migration"` → imprime `B`, código 0; `"migration"` → código 1; `"frente:A,frente:B"` → código 1;
  - `vinculo-pr.sh` com corpo `"…\n\nCloses #35"` → 0; `"closes #35"` → 0; `"Refs #35"` → 0; `"Relacionado à 35"` → 1; corpo vazio → 1; `"Closes #"` → 1.

- [ ] **Step 2: Rodar e ver falhar** — `bats ops/ci/testes` → FAIL.

- [ ] **Step 3: Implementar** os dois scripts em bash (`set -euo pipefail`, aprovados no `shellcheck`, sem dependência além de `grep`/`tr`).

- [ ] **Step 4: Rodar e ver passar** — `bats ops/ci/testes && git ls-files '*.sh' | xargs shellcheck` → PASS.

- [ ] **Step 5: Job `Scripts de operação`** (no `ci.yml`):
  - instala `bats` e `shellcheck` pelo apt do runner;
  - roda o `bats` em todas as pastas `testes/` com `.bats` versionadas (`git ls-files '*.bats' | xargs -n1 dirname | sort -u | xargs bats`), o que inclui `ops/vps`, `ops/ci` e, depois, `docker/testes` e `ops/backup/testes`;
  - roda `git ls-files '*.sh' | xargs shellcheck`.

- [ ] **Step 6: Workflow `pr.yml` com o job `Fronteira de frente`**:
  - gatilho `on: pull_request: types: [opened, synchronize, reopened, labeled, unlabeled, edited]`. Fica num arquivo próprio para que label e edição de corpo não rodem de novo o build do `ci.yml`;
  - `checkout` com `fetch-depth: 0`;
  - variáveis por `env:`: `LABELS: ${{ join(github.event.pull_request.labels.*.name, ',') }}`, `CORPO: ${{ github.event.pull_request.body }}` e `BASE: ${{ github.base_ref }}`. Os passos usam só `"$LABELS"`, `"$CORPO"` e `"$BASE"`;
  - frente: `FRENTE=$(ops/ci/frente-do-pr.sh "$LABELS")`;
  - vínculo: `printf '%s' "$CORPO" | ops/ci/vinculo-pr.sh`;
  - fronteira, PR compartilhado puro e migration única: `git diff --name-only --no-renames "origin/$BASE...HEAD" | npx tsx scripts/frentes/verificar.ts --frente "$FRENTE" --labels "$LABELS"`.

- [ ] **Step 7: Job `Migrations`** (no `ci.yml`; spec §12.7 item 4):
  - *service* `postgres` com `pgvector/pgvector:pg16` fixada por digest, `ports: ['56432:5432']`, senha descartável fixa no próprio workflow (`POSTGRES_PASSWORD: ci-descartavel`, banco efêmero sem dado) e `options: --health-cmd pg_isready --health-interval 5s --health-retries 10`;
  - aplica o `01-papeis.sql` com `psql postgresql://postgres:ci-descartavel@localhost:56432/postgres -f docker/postgres/init/01-papeis.sql`;
  - exporta `MIGRATE_DATABASE_URL=postgresql://sgo_migrator:sgo_migrator@localhost:56432/sgo_teste`;
  - confere host e porta (Review Focus 5);
  - roda `npm run db:deploy`;
  - roda `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code`. Conferir os nomes das opções no Prisma 7.10.1 com `npx prisma migrate diff --help` antes de escrever.
  Diferença entre o banco migrado e o schema → código 2 → job vermelho.

- [ ] **Step 8: Job `Testes de integração`** (no `ci.yml`) — `npm ci` e `npm run test:int` (Testcontainers sobre o Docker do runner; o `vitest.config.ts` já desliga o Ryuk), `timeout-minutes: 20`.

- [ ] **Step 9: Fixar as actions por SHA** — `actions/checkout` e `actions/setup-node` com o SHA do commit da versão atual e a versão em comentário (`uses: actions/checkout@<sha> # v4.x.y`). O SHA vem de `gh api repos/actions/checkout/commits/<tag> --jq .sha`, que resolve também tags anotadas. `permissions: contents: read` no topo dos dois workflows; nenhum job desta tarefa recebe permissão de escrita.

- [ ] **Step 10: Provar que reprova** — com o PO autorizando o push da branch, abrir o PR em rascunho e conferir, um caso por vez, em commits depois removidos:
  - PR sem `frente:B` → `Fronteira de frente` vermelho;
  - corpo sem `Closes`/`Refs` → vermelho;
  - arquivo `src/modules/orc/x.ts` → vermelho com "arquivo da outra frente";
  - label `compartilhado` com `package.json` e `src/modules/ger/x.ts` → vermelho com "compartilhado também altera código";
  - duas pastas novas em `prisma/migrations/` → vermelho com "mais de uma migration";
  - `prisma/schema/cad.prisma` com um `model` sem migration → `Migrations` vermelho;
  - tirar e repor a label `frente:B` → o `pr.yml` roda de novo.
  Registrar os links dos runs no PR.

- [ ] **Step 11: PR** — "[US-013] Verificações de PR no CI (parte 1/3)", `Refs #35`, label `frente:B`. Depois do merge, o PO inclui os cinco jobs como obrigatórios na proteção da `main` (*strict*). Isso fecha a pendência técnica da memória.

> Fora deste plano, registrado como sugestão em issue: reprovar a **edição** de migration já mergeada (spec §12.7 item 3) e uma varredura de segredos no CI.

### Task 2: Contrato C3 — componentes de tela (`ger`)

**Files:**
- Create: `src/modules/ger/ui/grade-arvore.tsx`, `src/modules/ger/ui/formulario.tsx`, `src/modules/ger/infrastructure/exportar-xlsx.ts`, `src/modules/ger/falsos.ts`
- Modify: `src/modules/ger/index.ts`
- Test: `src/modules/ger/contrato-c3.test.ts`

**Interfaces:**
- Consumes: `Resultado`, `ErroCampo` de `@/shared/kernel`.
- Produces (tudo exportado por `@/modules/ger`, inclusive os falsos, porque o lint só permite importar outro módulo pelo `index.ts`):

```ts
// Valores que atravessam a fronteira servidor → cliente (Server Components não serializam classes nem funções).
// Dinheiro e Percentual vêm como string decimal (Dinheiro.paraString(): "1234.50"), Competencia como "Mmm/AA",
// data como ISO 8601. O componente formata com o kernel no cliente.
export type TipoColuna = 'texto' | 'dinheiro' | 'percentual' | 'competencia' | 'data';
export type ValorCelula = string | null;
export type LinhaGrade = Readonly<Record<string, ValorCelula>>;

export type ColunaGrade = {
  campo: string; // chave em LinhaGrade
  titulo: string;
  tipo: TipoColuna;
  largura?: number; // px
};

export type NoGrade = {
  id: string;
  linha: LinhaGrade;
  href?: string; // navegação ao clicar na linha
  filhos?: readonly NoGrade[];
};

export type PropsGradeArvore = {
  idGrade: string; // chave da expansão (e, na US-021, dos filtros) retida na sessão (RNF0005)
  nos: readonly NoGrade[];
  colunas: readonly ColunaGrade[];
  expandidos?: 'todos' | 'nenhum' | readonly string[];
  acaoSelecionar?: (id: string) => Promise<void>; // Server Action, opcional
  textoVazio?: string;
  // A US-021 acrescenta props opcionais (filtros, virtualização); acrescentar prop opcional não quebra consumidores.
};
export function GradeArvore(props: PropsGradeArvore): React.JSX.Element; // 'use client'

export type PropsFormulario<T> = {
  acao: (dados: FormData) => Promise<Resultado<T>>; // Server Action do módulo dono
  children: React.ReactNode; // campos com name = ErroCampo.campo
  textoEnviar?: string;
  mensagemSucesso?: string;
  redirecionarPara?: string; // após ok: true
};
export function Formulario<T>(props: PropsFormulario<T>): React.JSX.Element; // 'use client'; embrulha a acao em (estado, FormData) para o useActionState

export type PlanilhaExportacao = {
  nome: string; // nome da aba, 1 a 31 caracteres
  colunas: readonly { titulo: string; tipo: TipoColuna; largura?: number }[];
  linhas: readonly (readonly ValorCelula[])[];
};
export const LIMITE_EXPORTACAO_SINCRONA = 5000; // RF_IMP_003, total de linhas somando as abas
export function exportarXlsx(planilhas: readonly PlanilhaExportacao[]): Promise<Resultado<Uint8Array>>;

export function exportarXlsxFalso(): {
  exportar: typeof exportarXlsx;
  chamadas: (readonly PlanilhaExportacao[])[];
};
```

- [ ] **Step 1: Escrever o teste do contrato (falha)** em `contrato-c3.test.ts`:
  - `exportarXlsx` com duas abas de 2.501 linhas cada → `{ ok: false, erros: [{ campo: 'linhas', … }] }`;
  - aba com nome de 32 caracteres → `{ ok: false, erros: [{ campo: 'nome', … }] }`;
  - uma aba com 1 linha → `ok: true` e um `Uint8Array`;
  - `exportarXlsxFalso().exportar(p)` registra `p` em `chamadas`;
  - `@/modules/ger` exporta `GradeArvore`, `Formulario`, `exportarXlsx`, `exportarXlsxFalso` e `LIMITE_EXPORTACAO_SINCRONA`;
  - `// @ts-expect-error` numa `ColunaGrade` sem `tipo`, verificado pelo `npm run typecheck`.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run --project unidade src/modules/ger` → FAIL.

- [ ] **Step 3: Implementar o mínimo do contrato:**
  - `GradeArvore`: `<table>` simples, sem virtualização (a real é a US-021, no P4), com `role="treegrid"`, `aria-level` e `aria-expanded`; formata cada célula pelo `tipo` com `Dinheiro.de(v).formatar()` e equivalentes do kernel, nunca com `number`;
  - `Formulario`: `useActionState` com a `acao` embrulhada; erros ao lado do campo de mesmo `name` e os sem campo no topo;
  - `exportarXlsx`: valida o limite e o nome das abas e, por enquanto, devolve um `Uint8Array` vazio. O ExcelJS entra com a implementação real (P4), via `await import('exceljs')` dentro da função (Review Focus 7).

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run --project unidade src/modules/ger && npm run lint && npm run typecheck && npm run build` → PASS. No teste, `renderToString(createElement(GradeArvore, JSON.parse(JSON.stringify(props))))` prova que as *props* sobrevivem à serialização. Usar `createElement`, porque o `include` só pega `.test.ts`, sem JSX, e nenhuma página de teste em `src/app`, que iria para produção.

- [ ] **Step 5: PR de contrato** — "[C3] Contrato dos componentes de tela (`ger`)", labels `frente:B` e `contrato`, `Refs #43` (US-021, que implementa) e `Refs #53` (US-031, que consome). Pela §12.12, a frente A revisa e registra no PR que o contrato atende o P5. Na fila de merge, o PR entra antes dos demais não compartilhados (spec §12.9).

### Task 3: Contrato C4 — e-mail por *outbox* (`ger`)

**Files:**
- Create: `src/modules/ger/application/email.ts`, `src/modules/ger/domain/modelos-email.ts`
- Modify: `src/modules/ger/index.ts`, `src/modules/ger/falsos.ts`
- Test: `src/modules/ger/contrato-c4.test.ts`

**Interfaces:**
- Consumes: `TxCliente` de `@/shared/db`, `ErroDominio` de `@/shared/kernel`. Na implementação real (US-025, P4), usa `registrarNoOutbox(tx, 'email.enviar', dados)` de `@/shared/filas` (US-010).
- Produces (exportado por `@/modules/ger`, inclusive o falso):

```ts
export type DadosModeloEmail = {
  'usuario.senha_inicial': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
  'usuario.senha_redefinida': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
}; // novo modelo = nova chave; acrescentar chave não quebra consumidores
export type ModeloEmail = keyof DadosModeloEmail;
export const MODELOS_SENSIVEIS: ReadonlySet<ModeloEmail>; // os dois acima: dados apagados após o envio
export type Destinatario = { email: string; nome?: string };

// Registra o envio na transação do caso de uso: commit → o worker envia; rollback → nada é enviado.
// Valida o destinatário antes de qualquer outra coisa: ErroDominio('email.destinatario_invalido').
export function enviarEmail<M extends ModeloEmail>(
  tx: TxCliente,
  modelo: M,
  destinatario: Destinatario,
  dados: DadosModeloEmail[M],
): Promise<void>;

// Falso: mesma validação de destinatário, guarda em memória.
export function emailFalso(): {
  enviarEmail: typeof enviarEmail;
  enviados: { modelo: ModeloEmail; destinatario: Destinatario; dados: unknown }[];
};
```

- [ ] **Step 1: Escrever o teste do contrato (falha)**:
  - `emailFalso().enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org' }, dados)` registra 1 item em `enviados`;
  - destinatário `'sem-arroba'`, no falso e no real → `ErroDominio` com código `email.destinatario_invalido`;
  - o real com destinatário válido, antes da US-010 → `ErroDominio('email.indisponivel')`;
  - `MODELOS_SENSIVEIS` contém `usuario.senha_inicial` e `usuario.senha_redefinida`;
  - `// @ts-expect-error` em dados de `senha_inicial` sem `senhaTemporaria`, verificado pelo `npm run typecheck`.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run --project unidade src/modules/ger` → FAIL.

- [ ] **Step 3: Implementar o contrato** — a validação do destinatário fica em `domain/` (função pura) e roda primeiro. Até a US-010 estar na `main`, o `enviarEmail` real lança `email.indisponivel`. No JSDoc do contrato ficam as regras que a US-025 cumpre:
  - envio pelo worker com até 5 tentativas;
  - modelos versionados, sem nome de instituição fixo (o nome vem de `instituicao.nome_exibicao`);
  - dados de `MODELOS_SENSIVEIS` apagados do *outbox* e do job depois do envio (Review Focus 6).

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run --project unidade src/modules/ger && npm run lint && npm run typecheck` → PASS.

- [ ] **Step 5: PR de contrato** — "[C4] Contrato de e-mail por *outbox* (`ger`)", labels `frente:B` e `contrato`, `Refs #47` (US-025) e `Refs #60` (US-038). A frente A revisa e registra no PR que o contrato atende a US-038.

### Task 4: Imagem, GHCR e deploy por *webhook* (US-013 parte 2/3, #35)

**Files:**
- Create: `docker/app.Dockerfile`, `docker/app.Dockerfile.dockerignore`, `docker/entrypoint.sh`, `docker/migrador/package.json`, `docker/migrador/package-lock.json`, `docker/testes/migration-quebrada/` (migration de teste com um só comando que falha, fora de `prisma/migrations/`)
- Create: `.github/workflows/imagem.yml`
- Modify: `.github/workflows/ci.yml` (job `Imagem`)
- Test: `docker/testes/entrypoint.bats` e o job `Imagem`

**Interfaces:**
- Consumes: `next.config.ts` com `output: 'standalone'`; `prisma.config.ts`; *secrets* `EASYPANEL_WEBHOOK` nos *environments* `homologacao` e `producao` (o PO cadastra, Tarefa 6).
- Produces:
  - imagem `ghcr.io/fabianojp06/sgov2`, com as tags:
    - `sha-<commit>` em todo push na `main`;
    - `hml`, sempre o último da `main`;
    - `teste-<nome>`, só por `workflow_dispatch`, para provas em hml;
  - imagem `ghcr.io/fabianojp06/sgov2-prod`, com as tags `vX.Y.Z` e `prod`, gravada só com o `GHCR_PROD_TOKEN` do *environment* `producao`;
  - `docker/entrypoint.sh`, com quatro subcomandos:
    - `app`: roda `migrar` e depois `exec node server.js`;
    - `migrar`: roda `prisma migrate deploy` a partir de `/opt/migrador` e sai com o código dele;
    - `resolver <migration>`: roda `prisma migrate resolve --rolled-back <migration>`, para o PO destravar uma migration falha;
    - `worker`: roda o worker (Step 10);
  - variáveis lidas: `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `FILA_DATABASE_URL` (US-010), as do SMTP (nomes definidos na US-025), `PORT` (padrão 3000) e `HOSTNAME=0.0.0.0`.

- [ ] **Step 1: Escrever os testes bats do entrypoint (falham)**, com `prisma` e `node` simulados por `PATH` (scripts falsos que registram a chamada):
  - `entrypoint.sh app` com `prisma` falso saindo 1 → código ≠ 0 e o `node` falso **nunca** chamado;
  - com `prisma` saindo 0 → `node server.js` chamado uma vez;
  - `resolver 202611010000_x` → `prisma migrate resolve --rolled-back 202611010000_x`; `resolver` sem nome → código 64;
  - argumento desconhecido → código 64 e mensagem de uso;
  - `MIGRATE_DATABASE_URL` vazio em `app` → código ≠ 0, sem chamar `prisma`.

- [ ] **Step 2: Rodar e ver falhar** — `bats docker/testes` → FAIL.

- [ ] **Step 3: Implementar `entrypoint.sh`** (`set -euo pipefail`, `shellcheck`). Nada de `set -x`, para não imprimir as URLs com senha.

- [ ] **Step 4: Rodar e ver passar** — `bats docker/testes` → PASS.

- [ ] **Step 5: `docker/app.Dockerfile`** em estágios, com base `node:22.23-bookworm-slim` fixada por digest:
  - `deps`: `npm ci`, com o `postinstall` gerando o cliente Prisma;
  - `build`: `npm run build`;
  - `migrador`: diretório autossuficiente `/opt/migrador` com `docker/migrador/package.json` e `docker/migrador/package-lock.json` versionados (`prisma@7.10.1` e `zod@4.6.7`, com as transitivas travadas) e `npm ci`, sem `--ignore-scripts` (o Prisma 7 pode precisar baixar o *schema engine* no install; conferir). Para lá vão `prisma/`, `prisma.config.ts` e `src/shared/config/env.ts`, para que os imports do `prisma.config.ts` resolvam a partir de `/opt/migrador/node_modules`. Contorna a issue #165: o `postinstall` quebra o `npm ci --omit=dev`;
  - `final`: usuário não root (`node`); copia `.next/standalone`, `.next/static`, `public/` (se existir), `/opt/migrador` e `docker/entrypoint.sh`. Tem `HEALTHCHECK --start-period=120s --interval=10s` com `node -e` fazendo GET em `http://127.0.0.1:3000/login` e esperando 200, `ENTRYPOINT ["/app/docker/entrypoint.sh"]` e `CMD ["app"]`.
  O `app.Dockerfile.dockerignore` exclui `.env*`, `.git`, `node_modules`, `.next`, `docs`, `especificacao`, `areas`, `people`, `projects`, `topics`, `profile.md`, `preferences.md`, `.claude` e `coverage`.

- [ ] **Step 6: Job `Imagem` no `ci.yml`** (em todo PR, sem publicar):
  1. `docker build -f docker/app.Dockerfile -t sgo:teste .`;
  2. `docker run --rm --entrypoint sh sgo:teste -c "find / -xdev \( -name '.env*' -o -name .git \) -not -path '/proc/*'"` não acha nada em `/app` nem em `/opt/migrador` (Review Focus 1);
  3. numa rede Docker `--internal` (sem internet), com um Postgres com os papéis aplicados, `docker run --network <rede> -e MIGRATE_DATABASE_URL=… sgo:teste migrar` → código 0. Isso prova que o migrador não depende de rede nem de `devDependencies`;
  4. o mesmo com `docker/testes/migration-quebrada/` montada por cima de `/opt/migrador/prisma/migrations`, num banco novo → código ≠ 0;
  5. `docker run -d … sgo:teste app` com a migration quebrada → o contêiner sai com código ≠ 0, e `curl` na porta não recebe resposta (Review Focus 2);
  6. com as migrations boas → `/login` responde 200 em até 60 s.

- [ ] **Step 7: Workflow `imagem.yml`** — um único bloco `on:` com `push: { branches: [main], tags: ['v[0-9]+.[0-9]+.[0-9]+'] }` e `workflow_dispatch` (entrada `nome`, para imagens `teste-<nome>`). Checkout com `fetch-depth: 0`. A permissão `packages: write` fica só nos jobs que publicam.
  - **Job `hml`** (`if: github.ref == 'refs/heads/main'`, `environment: homologacao`):
    1. build com cache do GHCR;
    2. `push` de `sha-<commit>` e `hml`;
    3. `curl --fail-with-body -sS -X POST "$WEBHOOK"`, com `env: WEBHOOK: ${{ secrets.EASYPANEL_WEBHOOK }}`.
    Com o *secret* vazio (antes da Tarefa 6), o passo emite `::warning::Deploy de hml pendente: webhook não cadastrado` e o job fica verde, porque a imagem foi publicada.
  - **Job `verificar-prod`** (`if: startsWith(github.ref, 'refs/tags/v')`, **sem** *environment*, só leitura). A aprovação de um *environment* acontece antes de qualquer passo do job; por isso, as checagens ficam num job anterior, e o PO as vê antes de aprovar:
    1. confere `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`;
    2. confere que `sgov2:sha-<commit>` existe (`docker buildx imagetools inspect`);
    3. compara com a tag `v*` anterior (`git describe --tags --abbrev=0 --match 'v*' "$GITHUB_SHA^"`). Se `git diff --name-only <anterior> "$GITHUB_SHA" -- prisma/migrations` não for vazio, ou se esta for a primeira tag, escreve no resumo do run: "há migration: tire e confirme o snapshot da Hostinger antes de aprovar".
  - **Job `prod`** (`needs: verificar-prod`, `environment: producao`, com aprovação do PO):
    1. `docker login` no GHCR com `GHCR_PROD_TOKEN`;
    2. copia `sgov2:sha-<commit>` para `sgov2-prod:vX.Y.Z` e `sgov2-prod:prod` **sem reconstruir**;
    3. chama o webhook.
    Na tag, *secret* vazio **reprova** (Review Focus 3).
  - **Job `teste`** (`workflow_dispatch`, sem *environment*, porque não usa *secret*): build da branch escolhida e `push` só de `sgov2:teste-<nome>`. **Nunca** mexe em `hml` nem no pacote `sgov2-prod` e não chama webhook.
  - **Job `rollback`** (`workflow_dispatch` com entrada `acao=rollback`, `environment: producao`). O PO o dispara com `ref` igual à tag de destino (`--ref vX.Y.Z` no GitHub ou na interface), o que satisfaz a política do *environment*, que só aceita tags `v*`. O job copia `sgov2-prod:vX.Y.Z` para `sgov2-prod:prod` e chama o webhook. É o procedimento do runbook, sem token de escrita na mão de ninguém.

- [ ] **Step 8: Fixar as actions por SHA** (como na Tarefa 1), incluindo `docker/login-action`, `docker/setup-buildx-action` e `docker/build-push-action`.

- [ ] **Step 9: PR** — "[US-013] Imagem, GHCR e deploy por *webhook* (parte 2/3)", `Refs #35`, label `frente:B`. A issue fecha na Tarefa 6, quando os critérios forem provados. Depois do merge, o PO inclui `Imagem` nos checks obrigatórios.

- [ ] **Step 10: Entrypoint do worker** (só depois do merge da US-010) — usar o script `worker:start` que a US-010 criar. Se ele exigir `tsx` ou um compilador na imagem, a dependência ou o script de build do worker entram por PR `compartilhado`. Depois, o `entrypoint.sh worker` passa a funcionar, e o teste bats ganha o caso `worker`. PR próprio, `Refs #35`.

### Task 5: Papéis de banco de hml e prod (preparação da US-014, #36; issue #165)

**Files:**
- Create: `deploy/postgres/01-papeis-ambiente.sql`, `deploy/postgres/papeis-ambiente.int.test.ts`
- Create: `docs/operacao/ambientes.md` (esqueleto, completado na Tarefa 6)

> O teste fica em `deploy/`, fora do `include` atual do projeto `integracao`. Antes desta tarefa, um PR `compartilhado` acrescenta `deploy/**/*.int.test.ts` ao `vitest.config.ts` (Decisão 3).

**Interfaces:**
- Consumes: o mesmo padrão de contêiner de `tests/integracao/banco.ts` (512 MB, porta só em `127.0.0.1`, `oom_score_adj` 500, sem Ryuk), mas num contêiner **sem** o `01-papeis.sql` de dev e com `.withUsername('postgres')` (o padrão do `PostgreSqlContainer` é `test`), para provar a criação do zero. Se a classe `PostgresLocal` não for exportada, pedir à frente A que a exporte (issue para a frente A, ou `toca-outra-frente`).
- Produces: `01-papeis-ambiente.sql`, executado pelo PO como superusuário, uma vez por ambiente, com `psql -f`. As senhas vêm de variáveis de ambiente lidas por `\getenv` (`SGO_SENHA_MIGRATOR`, `SGO_SENHA_APP`, `SGO_SENHA_SYNC`, `SGO_SENHA_FILA`, `SGO_SENHA_LEITURA`), nunca no arquivo nem na linha de comando. O script:
  - cria o papel administrativo `sgo_admin`, dono do banco `sgo`;
  - faz o `sgo_migrator` dono só do schema `public`;
  - cria `sgo_app` e `sgo_sync` sem `BYPASSRLS`;
  - cria `sgo_fila`, dono do schema `pgboss` (P1 Tarefa 9);
  - cria `sgo_leitura`, só `SELECT`, **sem** `BYPASSRLS`, para os comandos *ad hoc* (spec §11.5 item 5). O dump diário não usa este papel: com RLS, o `pg_dump` aborta sem `BYPASSRLS`. Ele roda como `postgres` pelo socket local do contêiner `db` (Tarefa 7);
  - executa `REVOKE CONNECT, TEMP ON DATABASE sgo FROM PUBLIC` e `ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`.
  A idempotência vem de `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L …', …) WHERE NOT EXISTS (…) \gexec` (as variáveis do psql não se expandem dentro de `DO $$…$$`). O mesmo vale para o `CREATE DATABASE`.

- [ ] **Step 1: Escrever o teste de integração (falha)** — aplica o script com `docker exec <idContainer> psql -U postgres -f /…/01-papeis-ambiente.sql`, com as senhas em `-e`, e verifica:
  - um papel novo `intruso`, sem *grant*, não conecta no `sgo`;
  - `sgo_app` e `sgo_sync` conectam, não criam tabela e têm `rolbypassrls = false` (`pg_roles`);
  - `sgo_migrator` cria tabela no `public`, mas não executa `ALTER DATABASE sgo`;
  - `sgo_fila` é dono de `pgboss`; `sgo_leitura` lê uma tabela criada pelo migrator, não insere nela e tem `rolbypassrls = false`;
  - numa tabela com RLS habilitado e uma política, `pg_dump` como `postgres` pelo socket local termina com código 0 (o caminho do dump diário);
  - função criada pelo `sgo_migrator` não é executável por `intruso`;
  - rodar o script duas vezes não dá erro nem muda `pg_roles`.

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:int -- papeis-ambiente` → FAIL.

- [ ] **Step 3: Implementar o SQL.**

- [ ] **Step 4: Rodar e ver passar** — `npm run test:int -- papeis-ambiente` → PASS.

- [ ] **Step 5: PR** — "[US-014] Papéis de banco de hml e prod (parte 1/2)", `Refs #36` e `Refs #165`, label `frente:B`.

### Task 6: Ambientes `sgo-hml` e `sgo-prod` no Easypanel (US-014, #36; fecha a US-013, #35) — **bloqueada por GAP-INF-001 (domínio)**

**Files:**
- Modify: `docs/operacao/ambientes.md`

**Interfaces:**
- Consumes: imagens `ghcr.io/fabianojp06/sgov2:hml` e `ghcr.io/fabianojp06/sgov2-prod:prod` (Tarefa 4), `01-papeis-ambiente.sql` (Tarefa 5).
- Produces: roteiro em `docs/operacao/ambientes.md`, executado pelo PO, com uma tabela por ambiente:
  - serviço `app`: imagem, `CMD app`, porta 3000, domínio, HTTPS, `mem_limit`/reserva;
  - serviço `worker`: mesma imagem, `CMD worker`;
  - serviço `db`: Postgres 16 (`pgvector`) sem porta publicada, `shared_buffers` 512 MB no prod;
  - variáveis por **nome**, sem valor (`DATABASE_URL`, `MIGRATE_DATABASE_URL`, `FILA_DATABASE_URL`, SMTP);
  - atualização *start-first* (zero downtime) e reinício limitado. Conferir se o Easypanel expõe essas opções; se não expuser, registrar a alternativa e reavaliar o Review Focus 2;
  - `oom_score_adj` −500 no prod e −200 no hml, pelo `ajustar-oom.sh` do P2;
  - credencial **só de leitura** do GHCR para cada ambiente (prod lê `sgov2-prod`);
  - no GitHub, os *environments* `homologacao` (só `main`) e `producao` (só tags `v*`, revisor PO), cada um com o próprio `EASYPANEL_WEBHOOK`, e o *ruleset* de tag `v*` (Decisão 4).

- [ ] **Step 1: PO decide o domínio** (GAP-INF-001, até ~05/11), e a sessão completa os nomes no roteiro.
- [ ] **Step 2: PO cria os projetos `sgo-hml` e `sgo-prod`** seguindo o roteiro, aplica o `01-papeis-ambiente.sql` em cada `db` e configura os *environments*, os *secrets* e o *ruleset* no GitHub. A sessão não vê nenhum desses valores.
- [ ] **Step 3: Verificar de fora** (PO, do próprio computador):
  - `curl -sI http://<hml>` → 301/308 para HTTPS;
  - `curl -sI https://<hml>/login` → 200 com certificado válido;
  - `nc -zv <ip>` nas portas 5432, 3000, 3100 e 3200 → recusado ou *timeout*;
  - nas variáveis do Easypanel, as credenciais de prod existem; no repositório, um script em `ops/ci/` extrai toda URL `postgres(ql)://` versionada e confere que o host é `127.0.0.1`, `localhost` ou `db` (compose de dev) e que a porta é 55432, 56432 ou 5432 interna.
  Registrar o resultado em `ambientes.md`. Isso cobre "Variáveis de prod só no Easypanel" (#36).
- [ ] **Step 4: Provar o deploy de hml** — um PR trivial mergeado na `main` → o `imagem.yml` publica e chama o webhook → em até 5 min o hml serve o novo commit (conferir a digest de `hml` no GHCR e a do serviço no Easypanel). Marca o critério "Push na `main` publica imagem e faz deploy em hml" da #35.
- [ ] **Step 5: Provar que migration com falha não derruba hml** (PO):
  1. anota a digest atual de `hml`;
  2. dispara o job `teste` do `imagem.yml` numa branch descartável com `docker/testes/migration-quebrada/` copiada para `prisma/migrations/`, que gera `teste-migration-quebrada`;
  3. troca a imagem do `app` de hml para essa tag no Easypanel → a tarefa nova falha, e `https://<hml>/login` continua respondendo com a versão anterior;
  4. **limpeza:** volta o `app` de hml para a digest anotada e roda `entrypoint.sh resolver <nome-da-migration-quebrada>` pelo console do serviço;
  5. o próximo deploy normal de hml sobe sem P3009.
  Marca o critério "Migration com falha impede a subida da versão nova" da #35.
- [ ] **Step 6: Provar o deploy de prod** — o PO cria a tag `v0.1.0`, lê o resumo do `verificar-prod`, tira o snapshot e aprova o *environment* → `sgov2-prod:prod` aponta para a mesma digest de `sgov2:hml` (`docker buildx imagetools inspect` nas duas) → `https://<prod>/login` responde 200. O PO confere também que um workflow de branch não consegue gravar em `sgov2-prod` (o *Manage Actions access* do pacote mostra o repositório só com leitura). Marca o critério "Tag de release faz deploy em prod" da #35.
- [ ] **Step 7: PR** — "[US-014] Ambientes hml e prod no Easypanel (parte 2/2)", `Closes #36` e `Closes #35` (parte 3/3 da US-013), label `frente:B`.

### Task 7: Backup com PITR, dump diário e teste de restauração (US-015, #37) — **bloqueada por GAP-INF-001 (storage)**

**Files:**
- Create: `docker/postgres-ambiente.Dockerfile`, `ops/backup/pgbackrest.conf.modelo`, `ops/backup/backup-pgbackrest.sh`, `ops/backup/dump-diario.sh`, `ops/backup/testar-restauracao.sh`, units `ops/backup/sgo-backup-{full,diff,dump,restauracao}.{service,timer}`
- Modify: `.github/workflows/imagem.yml` (build e push da imagem `sgov2-postgres`)
- Create: `docs/operacao/backup.md`, `docs/operacao/restauracoes.md`
- Test: `ops/backup/testes/*.bats`, prova real em hml

**Interfaces:**
- **Imagem do banco:** `docker/postgres-ambiente.Dockerfile`, com base `pgvector/pgvector:pg16` fixada pelo mesmo digest do CI e pgBackRest instalado. Publicada pelo `imagem.yml` como `ghcr.io/fabianojp06/sgov2-postgres:sha-<commit>` e usada pelo `db` de hml e prod.
- **PITR:**
  - `archive_mode=on` e `archive_command='pgbackrest --stanza=sgo archive-push %p'`;
  - repositório S3 com `repo1-cipher-type=aes-256-cbc`, `repo1-retention-full-type=time` e `repo1-retention-full=30`;
  - chave de escrita e senha do cofre nas variáveis do serviço `db` no Easypanel.
- **Agendamento no host** (timers instalados pelo PO; o host não é sessão de dev):
  - `backup-pgbackrest.sh full|diff` executa o `pgbackrest backup --type=…` dentro do contêiner `db` do ambiente: full aos domingos às 03:00 e diferencial nos outros dias às 03:00;
  - `dump-diario.sh` (02:30) executa o `pg_dump -Fc` como `postgres` pelo socket local, dentro do `db`. Cifra a saída no host com `age`, usando a chave pública versionada em `ops/backup/`; a privada fica **fora** da VPS, com o PO. Envia para `dumps/AAAA-MM-DD.dump.age` com a chave só de escrita de `/etc/sgo/backup-dump.env`;
  - a retenção de 90 dias dos dumps é uma regra de *lifecycle* do bucket, não do script.
- **`testar-restauracao.sh`** (dia 1, 04:00):
  1. com a chave **só de leitura** e a senha do cofre de `/etc/sgo/backup-leitura.env`, restaura o último backup num contêiner `sgo-restauro-<data>` (fora dos nomes vedados de D12), com `mem_limit 768m`, `oom_score_adj 500`, `nice -n 10` e sem porta publicada;
  2. confere a contagem de tabelas do `public` e o `max(criado_em)` do Histórico;
  3. grava a linha (data, origem, tempo, resultado) em `/var/lib/sgo/restauracoes.log` e manda o mesmo texto ao `ALERTA_WEBHOOK_URL` do P2;
  4. remove o contêiner.
  O PO transcreve a linha para `docs/operacao/restauracoes.md` num PR, porque o host não tem a worktree.
- Qualquer falha → código ≠ 0, `logger -t sgo-backup` e alerta.

- [ ] **Step 1: PO decide o storage** (B2 ou R2, GAP-INF-001) e cria o bucket com versionamento e a regra de *lifecycle* de 90 dias em `dumps/`. Cria também três chaves:
  - escrita do pgBackRest, para o `db` no Easypanel;
  - só escrita em `dumps/`, para o host;
  - só leitura, para o teste de restauração no host.
  Guarda fora da VPS a senha do cofre do pgBackRest e a chave privada do `age`.
- [ ] **Step 2: Escrever os testes bats (falham)**, com `docker`, `age` e cliente S3 falsos:
  - `pg_dump` falhando → código ≠ 0 e nenhum envio;
  - `age` falhando → código ≠ 0 e nenhum envio (nunca envia dump em claro);
  - `backup-pgbackrest.sh semanal` → código 64;
  - restauração com o contêiner falhando → linha "FALHOU" no log, alerta enviado e código ≠ 0;
  - o `docker run` da restauração recebe `--memory 768m` e `--oom-score-adj 500`.
- [ ] **Step 3: Rodar e ver falhar** — `bats ops/backup/testes` → FAIL.
- [ ] **Step 4: Implementar** os scripts, as units e o `postgres-ambiente.Dockerfile`, com `shellcheck` limpo.
- [ ] **Step 5: Rodar e ver passar** — `bats ops/backup/testes && git ls-files '*.sh' | xargs shellcheck` → PASS.
- [ ] **Step 6: Ativar em hml primeiro** (PO):
  1. troca a imagem do `db` de hml pela `sgov2-postgres` (conferir antes, num serviço descartável, se o Easypanel aceita trocar a imagem do Postgres mantendo o volume);
  2. cria a *stanza* e faz o primeiro full;
  3. confere `pgbackrest info`;
  4. instala os timers.
  Só depois repete em prod.
- [ ] **Step 7: Primeira restauração registrada** (PO):
  - roda `testar-restauracao.sh` contra o backup de hml e depois contra o de prod, e as duas linhas vão para `restauracoes.md` com resultado OK;
  - um PITR para um horário anterior a um registro de teste inserido em hml mostra o banco sem esse registro;
  - um dump decifrado com a chave privada restaura com `pg_restore --list` sem erro.
- [ ] **Step 8: PR** — "[US-015] Backup com PITR, dump diário e teste de restauração", `Closes #37`, label `frente:B`.

### Task 8: Runbook de operação (US-119, #141)

**Files:**
- Create: `docs/operacao/runbook.md`
- Modify: `docs/operacao/ambientes.md`, `docs/operacao/backup.md` (links)

**Interfaces:**
- Produces: `runbook.md` com uma seção por procedimento, cada uma com quando usar, pré-condições, comandos, verificação e como desfazer:
  1. **Deploy:** hml automático e prod por tag com aprovação, com o snapshot da Hostinger antes de aprovar tag com migration (spec §4.3);
  2. **Rollback do app:** job `rollback` do `imagem.yml` com a `vX.Y.Z` anterior. Só vale quando a migration nova é compatível com a versão anterior. Regra para as duas frentes: migration destrutiva só em dois passos (expandir e depois contrair);
  3. **Migration presa** (P3009): voltar o serviço para a digest anterior, rodar `entrypoint.sh resolver <migration>`, corrigir a migration num PR novo (a mergeada nunca é editada, §12.7) e fazer o deploy de novo;
  4. **Rollback com dado:** restauração PITR para o horário anterior ao incidente;
  5. **Restauração completa** a partir do backup, inclusive pelo dump cifrado;
  6. **Incidentes:** falta de memória (gatilho de D12), disco cheio, certificado vencendo, webhook falhando, backup falhando;
  7. **Contatos e decisões:** quem aciona o quê.

- [ ] **Step 1: Escrever o runbook** a partir do que as Tarefas 4, 6 e 7 deixaram funcionando.
- [ ] **Step 2: Testar o rollback em hml** (PO, guiado pelo runbook) — publicar `v0.1.1`, voltar para `v0.1.0` só com o que o runbook diz, medir o tempo e registrar.
- [ ] **Step 3: Testar uma restauração pelo runbook** — usar a da Tarefa 7, seguindo só o texto, e corrigir o que faltar.
- [ ] **Step 4: PR** — "[US-119] Runbook de operação", `Closes #141`, label `frente:B`.

---

## Ordem e datas

| Ordem | Tarefa | Depende de | Previsão |
| --- | --- | --- | --- |
| 1 | Tarefa 1 — verificações de PR (US-013 1/3) | — | 28/10 – 29/10 |
| 2 | Tarefa 2 — contrato C3 | — | 29/10 – 30/10 |
| 3 | Tarefa 3 — contrato C4 | — | 30/10 |
| 4 | Tarefa 4 — imagem e deploy (US-013 2/3) | Tarefa 1 | 31/10 – 03/11 |
| 5 | Tarefa 5 — papéis de hml/prod | PR `compartilhado` do `vitest.config.ts` | 03/11 – 04/11 |
| 6 | Tarefa 6 — ambientes (US-014 e US-013 3/3) | GAP-INF-001 (domínio), Tarefas 4 e 5 | 05/11 – 07/11 |
| 7 | Tarefa 7 — backup (US-015) | GAP-INF-001 (storage), Tarefa 6 | 07/11 – 13/11 |
| — | P4 (cadastros), em paralelo com o que sobrar das Tarefas 6 e 7 | P1 na `main` (11/11) | a partir de 11/11 |
| 8 | Tarefa 8 — runbook (US-119) | Tarefas 4, 6 e 7 | até 08/12 |

Os contratos C3 e C4 ficam prontos bem antes de 11/11, data em que o P5 da frente A começa. Se o GAP-INF-001 atrasar, as Tarefas 6 e 7 esperam e a frente B adianta o P4.

## Encerramento do P3

- [ ] Critérios de aceite das issues #35, #36, #37 e #141 marcados, com o link da prova (run do Actions, linha de `restauracoes.md`, registro do rollback).
- [ ] Os checks `Lint, tipos, testes e build`, `Testes de integração`, `Migrations`, `Scripts de operação`, `Imagem` e `Fronteira de frente` obrigatórios na proteção da `main`.
- [ ] Revisão do bloco (spec §12.12) num comentário no épico EP01 (#2).
- [ ] Atualizar `docs/memoria/memoria-do-projeto.md` (estado, pendências, diário).
- [ ] Detalhar o P4 com o writing-plans, a partir das interfaces reais do P1 e dos contratos C3/C4 na `main`.
