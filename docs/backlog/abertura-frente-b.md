# SGO 2.0 — Abertura da frente B

> Texto para colar na **primeira sessão** da frente B (conta 2, em `/root/sistemas/sgo-b`). Preparado pela frente A em 25/10/2026, no fim do período de fundação (spec §12.3).

---

Você é a **frente B** do SGO 2.0, Sistema de Gestão Orçamentária: plataforma, cadastros e saídas. Responda sempre em português do Brasil.

## 1. Antes de qualquer coisa

1. Leia o `CLAUDE.md`, a memória do projeto (`docs/memoria/memoria-do-projeto.md`) e a spec §12 (`docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md`).
2. As regras invioláveis estão no `CLAUDE.md`. As mais sensíveis para você:
   - **D12:** esta VPS é a de produção. Nunca toque em contêineres, redes, volumes ou variáveis de `sgo-prod`/`sgo-hml`. Portas de dev só em `127.0.0.1`. **No máximo um processo pesado por vez** (build, `test:int`, Testcontainers), contando as duas frentes.
   - **Banco:** antes de qualquer comando que toque um banco, diga se ele escreve, apaga ou reseta. O seu banco de dev é `127.0.0.1:56432`. O `prisma.config.ts` e os hooks recusam comandos destrutivos fora do dev local.
   - **Ações externas** (push, PR, issue, merge) só com confirmação do PO. Nenhum PR vai para o PO sem o comentário "Revisão de código (12.12)".

## 2. Ambiente (uma vez)

A worktree `/root/sistemas/sgo-b` já existe. Falta:

1. Criar o `.env` e o `.env.local` a partir do `.env.example`, com os valores da frente B. A tabela está em `docs/backlog/desenvolvimento-em-duas-frentes.md`. O `POSTGRES_PASSWORD` é aleatório (`openssl rand -hex 16`).
2. `npm ci`. É processo pesado: confira se a frente A não está rodando build ou `test:int`.
3. `docker compose up -d`, que sobe o db e o mailpit do projeto `sgo-b`. Depois, `npm run db:deploy` e `npm run db:seed`.
4. Conferir que `ss -ltnp` mostra só `127.0.0.1:56432` e `127.0.0.1:8225`.

## 3. O que é seu (spec §12.3, `.github/frentes.yml`)

- **Da frente B:** `src/shared/ia/`, `src/modules/{ger,cad,rel,int}/`, `worker/`, `.github/workflows/`, `Dockerfile`, `docker/`, `deploy/`, `ops/`, `e2e/seguranca/`, `docs/modelos/` e `docs/operacao/`.
- **Testes de integração dos seus módulos:** ficam junto do código (`src/modules/<mod>/**/*.int.test.ts`, `worker/**/*.int.test.ts`) e usam o helper `iniciarBancoTeste()` de `tests/integracao/banco.ts`, que é da frente A.
- **Compartilhados** (`package.json`, lint, `CLAUDE.md`, `.claude/`, `docs/superpowers/`, `_base.prisma`...): só em PR exclusivo com a label `compartilhado`.
- **Código da frente A:** só com a label `toca-outra-frente` e justificativa.

## 4. O que já existe (P1 da frente A)

- **US-001 a US-005 na `main`:**
  - fronteiras de módulo (ESLint);
  - hooks das sessões e marca neutra;
  - compose de dev com limites de D12;
  - Prisma 7, com papéis `sgo_migrator`/`sgo_app`/`sgo_sync` e trava do shadow;
  - núcleo `Dinheiro`/`Percentual`/`Competencia` em `@/shared/kernel`. O lint barra `number` para dinheiro.
- **Ainda em andamento na frente A:** US-006 (Histórico de Operações), US-008 (guarda de autorização), US-009 (totalizador) e US-010 (worker e filas). Juntas, elas formam o contrato **C5** (`definirAcao`, `exigir`, `auditar`), de que o seu P4 (cadastros) depende.

## 5. Por onde começar

O seu próximo bloco é o **P3 Entrega** (plano-mestre: `docs/superpowers/plans/2026-10-24-trilha-2027-plano-mestre.md`), com as histórias US-013 #35, US-014 #36, US-015 #37 e US-119 #141.

1. **Escreva o plano do P3** com a skill `superpowers:writing-plans`, no padrão do P1 e do P2 (`docs/superpowers/plans/`). Ele vai num PR compartilhado (`docs/superpowers/`) para o PO aprovar.
2. **Comece pela US-013 (pipeline de CI).** O `ci.yml` atual roda lint, tipos, testes de unidade e de arquitetura e build. Faltam:
   - o `scripts/frentes/verificar.ts` (fronteira de frente, §12.8), lendo as labels do PR;
   - os testes de integração, se couberem no runner.

   Depois do merge da US-013, o PO inclui o check como obrigatório na proteção da `main`.
3. **US-014 e US-015** dependem do GAP-INF-001 (domínio, storage de backup e SMTP), que o PO decide até ~05/11. Até lá, prepare o que não depende disso.
4. **Ao terminar o P3,** siga para o **P4** (cadastros), quando o P1 estiver completo na `main`.

## 6. Pendências que tocam a sua área

- **Issue #165:** o `postinstall: prisma generate` quebra um `npm ci --omit=dev`. Leve isso em conta no `Dockerfile` (US-013/014).
- **Issue #165:** os privilégios de hml/prod são diferentes dos de dev. O `docker/postgres/init/01-papeis.sql` é **só de dev**. Na US-014, o banco deve pertencer a um papel administrativo, com o migrator dono só do schema e sem CONNECT/TEMP para PUBLIC.
- **Issue #163:** melhorias menores do compose de dev.
- **Testes de integração:** o Testcontainers roda **sem o Ryuk** (D12). Se um teste morrer no meio, limpe com `docker rm -f $(docker ps -aq --filter label=org.testcontainers=true)`.

## 7. Rotina de cada sessão

Siga as seções 2 e 3 de `docs/backlog/desenvolvimento-em-duas-frentes.md`:
- pegar a próxima issue da frente B no quadro, com dependências fechadas;
- uma história por branch e por PR (`us-NNN-slug`, `Closes #n`, label `frente:B`);
- commits com `Frente: B` e os trailers de coautoria;
- comentário de passagem na issue ao encerrar;
- atualizar a memória do projeto só com as suas linhas.
