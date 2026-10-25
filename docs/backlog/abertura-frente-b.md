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

Na primeira sessão da conta 2, faça `/login` com a segunda conta (spec §12.11).

A frente A cria a worktree `/root/sistemas/sgo-b` antes desta sessão (seção 1 de `docs/backlog/desenvolvimento-em-duas-frentes.md`). Confira com `git worktree list`; se ela não aparecer, pare e avise o PO. Depois:

1. Criar o `.env` e o `.env.local` a partir do `.env.example`, com os valores da frente B. A tabela está em `docs/backlog/desenvolvimento-em-duas-frentes.md`. O `POSTGRES_PASSWORD` é aleatório (`openssl rand -hex 16`).
2. **Conferir que nada aponta para o banco da frente A:** `grep -c 55432 .env .env.local` deve dar 0 nos dois arquivos, e `grep -c 56432 .env.local` deve dar 3. O `.env.example` traz as URLs da frente A, e as travas aceitam as duas portas de dev: esquecer a troca faria você gravar no banco da frente A.
3. `npm ci`. É processo pesado: confira se a frente A não está rodando build ou `test:int`.
4. `docker compose up -d --wait`, que sobe o db e o mailpit do projeto `sgo-b` e espera o healthcheck. Depois, `npm run db:deploy` e `npm run db:seed`: os dois **escrevem** no seu banco de dev (`127.0.0.1:56432`).
5. Conferir que as suas portas só aparecem ligadas a `127.0.0.1`: `ss -ltnp | grep -E ':(56432|8225)\b'`.

## 3. O que é seu (spec §12.3, `.github/frentes.yml`)

- **Da frente B:**
  - `src/shared/ia/`, `src/modules/{ger,cad,rel,int}/` e `prisma/schema/{cad,rel,int}.prisma`;
  - `src/app/(sistema)/{ger,cad,rel,int}/` e `e2e/{ger,cad,rel,int}/`;
  - `worker/`, `.github/workflows/`, `Dockerfile`, `docker/`, `deploy/`, `ops/`;
  - `e2e/seguranca/`, `docs/modelos/` e `docs/operacao/`.
- **Testes de integração dos seus módulos:** ficam junto do código (`src/modules/<mod>/**/*.int.test.ts`, `worker/**/*.int.test.ts`) e usam o helper `iniciarBancoTeste()` de `tests/integracao/banco.ts`, que é da frente A.
- **Compartilhados** (`package.json`, lint, `CLAUDE.md`, `.claude/`, `docs/superpowers/`, `_base.prisma`...): só em PR exclusivo com a label `compartilhado`.
- **Código da frente A:** só com a label `toca-outra-frente` e justificativa.
- **Exceção combinada:** a US-010 da frente A (P1, Tarefa 9) cria o `worker/index.ts` e entra com `toca-outra-frente`. Não crie arquivos em `worker/` antes do merge dela. Depois, `worker/` é seu.

## 4. O que já existe e o que a frente A ainda entrega

- **Na `main` (US-001 a US-005):**
  - fronteiras de módulo (ESLint);
  - hooks das sessões e marca neutra;
  - compose de dev com limites de D12;
  - Prisma 7, com papéis `sgo_migrator`/`sgo_app`/`sgo_sync` e trava do shadow;
  - núcleo `Dinheiro`/`Percentual`/`Competencia` em `@/shared/kernel`. O lint barra `number` para dinheiro.
- **Próximas da frente A, ainda não iniciadas, nesta ordem:**
  - US-006 (Histórico de Operações, `auditar`);
  - US-008 (guarda de autorização, `definirAcao`/`exigir`);
  - US-009 (totalizador);
  - US-010 (worker e filas).
- O **contrato C5** (`definirAcao`, `exigir`, `auditar`) sai da US-006 e da US-008. O seu P4 (cadastros) depende dele. O marco é **11/11, com o P1 inteiro na `main`**.

## 5. Contratos que você entrega (plano-mestre, spec §12.6)

Cada contrato é um PR pequeno, com a label `contrato`, contendo o `index.ts` do módulo (tipos, assinaturas e um adaptador falso). Ele entra **antes** das histórias que o consomem, e a frente A revisa e registra no PR que o contrato atende.

| Contrato | Módulo | Conteúdo mínimo | Antes de |
| --- | --- | --- | --- |
| C3 Componentes de tela | `ger` | `<GradeArvore>`, `<Formulario>` com `Resultado`, `exportarXlsx()` | US-031 (P5 da frente A, a partir de 11/11) |
| C4 E-mail | `ger` | `enviarEmail(tx, modelo, destinatario, dados)` via *outbox* | US-038 (P5) |
| C1 Estrutura financeira | `cad` | `listarArvoreContas()`, `listarArvoreCentrosCusto()`, `ehContaAnaliticaAtiva()`, `ehCentroCustoAnalitico()`, `NoConta`/`NoCentroCusto` | US-121 (P6) |
| C2 Custo de pessoal | `cad` | `calcularCustoPosicao(posicao, premissas)` e `obterPremissasExercicio(ano)` (spec §6.6, C33) | US-121 (P6) |

O C3 e o C4 são os mais urgentes, porque o P5 da frente A começa em 11/11.

## 6. Por onde começar

O seu próximo bloco é o **P3 Entrega** (plano-mestre: `docs/superpowers/plans/2026-10-24-trilha-2027-plano-mestre.md`), com as histórias US-013 #35, US-014 #36, US-015 #37 e US-119 #141.

1. **Escreva o plano do P3** com a skill `superpowers:writing-plans`, no padrão do P1 e do P2 (`docs/superpowers/plans/`). Ele vai num PR compartilhado (`docs/superpowers/`) para o PO aprovar. Encaixe nele os PRs de contrato C3 e C4, ou planeje-os à parte, sem perder a data de 11/11.
2. **US-013 (pipeline de CI/CD, issue #35):**
   - **critérios de aceite da issue:** build da imagem, publicação no GHCR, webhook do Easypanel, deploy em hml no push da `main`, deploy em prod por tag, e migration com falha impedindo a subida da versão nova;
   - **verificações da §12.8 no CI:** fronteira de frente e PR compartilhado puro, chamando o `scripts/frentes/verificar.ts` (já existe na `main`, CLI `--frente/--labels`) com os arquivos e as labels do PR; migration única; vínculo `Closes #n` e label `frente:X`;
   - **§12.7, item 4:** aplicar as migrations num banco efêmero e rodar `prisma migrate diff` contra ele, nunca contra hml ou prod;
   - o deploy em hml depende da US-014.

   Hoje o `ci.yml` roda lint, tipos, testes de unidade e de arquitetura e build. Depois do merge da US-013, o PO inclui o check como obrigatório na proteção da `main`.
3. **US-014 e US-015** dependem do GAP-INF-001 (domínio, storage de backup e SMTP), que o PO decide até ~05/11. Até lá, prepare o que não depende disso.
4. **Ao terminar o P3,** siga para o **P4** (cadastros), quando o P1 estiver completo na `main`.

**Marcos (plano-mestre):**
- 05/11: GAP-INF-001 decidido. Sem isso, o P3 trava.
- 11/11: P1 na `main`. Sem isso, a frente B só faz infra.
- 16/11: CCs da DIREX e premissas da GFIN.
- 20/11: P6 iniciado. Sem isso, o PO aciona o plano B, a aprovação sobre a planilha.
- 30/11: orçamento 2027 aprovado.

**Migrations (spec §12.7):**
- uma por PR, gerada depois do rebase na `main`;
- nome `AAAAMMDDHHMM_<modulo>_<descricao>`;
- label `migration`;
- o PO faz merge de um PR com migration por vez;
- migration mergeada nunca é editada.

## 7. Pendências que tocam a sua área

- **Issue #165:**
  - o `postinstall: prisma generate` quebra um `npm ci --omit=dev`. Leve isso em conta no `Dockerfile`;
  - o `docker/postgres/init/01-papeis.sql` é **só de dev**. Na US-014, o banco de hml/prod deve pertencer a um papel administrativo, com o migrator dono só do schema e sem CONNECT/TEMP para PUBLIC.
- **Issue #163:** melhorias menores do compose de dev.
- **Testes de integração:** o Testcontainers roda **sem o Ryuk** (D12). Se um teste morrer no meio, limpe com `docker rm -f $(docker ps -aq --filter label=org.testcontainers=true)`, **só quando a frente A não estiver rodando `test:int`**: o filtro pega os contêineres de teste das duas frentes.

## 8. Rotina de cada sessão

Siga as seções 2 e 3 de `docs/backlog/desenvolvimento-em-duas-frentes.md`:
- pegar a próxima issue da frente B no quadro, com dependências fechadas;
- uma história por branch e por PR (`us-NNN-slug`, `Closes #n`, label `frente:B`);
- commits com `Frente: B` e os trailers de coautoria;
- comentário de passagem na issue ao encerrar;
- atualizar a memória do projeto só com as suas linhas.
