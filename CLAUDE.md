# SGO 2.0

Sistema de Gestão Orçamentária: monólito modular Next.js 16 (App Router) + PostgreSQL 16 (Prisma 7) + worker com pg-boss. Fonte normativa: `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (a "spec") e a pasta `especificacao/`.

## Início e fim de sessão

- **No início:** ler `docs/memoria/memoria-do-projeto.md` (estado, decisões, pendências).
- **No fim:** atualizar a memória, acrescentando só as linhas da própria frente.
- Responder sempre em **português do Brasil**, inclusive textos de interface, mensagens e commits.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | app em `127.0.0.1:3100` (frente A) |
| `npm run lint` | ESLint, incluindo as fronteiras de módulo |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | testes de unidade |
| `npm run test:int` | testes de integração (Testcontainers, um processo pesado por vez) |
| `npm run test:arq` | testes de arquitetura (fronteiras, marca neutra, travas dos hooks) |
| `npm run build` | build de produção do Next.js |
| `docker compose up -d` | banco e serviços de dev (portas só em `127.0.0.1`) |

## Regras invioláveis (memória do projeto, seção 2)

1. **Fontes:** decisões vêm só da pasta `especificacao/` e da spec. As notas pessoais da raiz (`profile.md`, `preferences.md`, `areas/`, `projects/`, `people/`, `topics/`) não são fonte de nada: não ler, citar, mover nem apagar sem pedido do PO.
2. **Marca neutra:** o nome "CTCEA" nunca aparece no sistema (código, seeds, telas, modelos gerados); o nome exibido vem de `instituicao.nome_exibicao` (spec §6.7). O hook `alerta-marca` e o teste `tests/arquitetura/marca-neutra.test.ts` reprovam.
3. **Banco de produção** (spec §11.5): antes de comando que toque banco, dizer se ele escreve, apaga ou reseta; conferir `DATABASE_URL` e `SHADOW_DATABASE_URL`; `shadowDatabaseUrl` nunca aponta para prod; `migrate reset`, `db push` e `migrate diff` só no dev local (`127.0.0.1:55432`/`56432`). Na dúvida, perguntar.
4. **`main` protegida:** tudo entra por PR com merge *squash*. Ninguém faz push direto.
5. **Ações externas** (GitHub, e-mail, serviços) só com confirmação do PO.
6. **Segredos:** `ANTHROPIC_API_KEY` e credenciais de prod só nas variáveis do Easypanel; nunca no repositório nem em `.env` de dev.
7. **Commits** terminam com os trailers de coautoria da sessão e com `Frente: A` ou `Frente: B`.
8. **Code review (spec §12.12):** nenhum PR vai para o PO sem o comentário "Revisão de código (12.12)". O merge é sempre aprovado explicitamente pelo PO.
9. **Duas frentes:** cada pasta tem um dono (spec §12.3). Não alterar código da outra frente sem a label `toca-outra-frente`.
10. **Dev na VPS de produção (D12):** nunca acessar contêineres, redes, volumes ou variáveis de `sgo-prod`/`sgo-hml`. Os hooks de `.claude/` bloqueiam; exceção só com pedido explícito do PO. Portas de dev só em `127.0.0.1`; no máximo um processo pesado por vez.

## Frentes e propriedade (resumo da spec §12.3)

- **Frente A — núcleo e domínio** (`/root/sistemas/sgo`; banco 55432, app 3100, Mailpit 8125): `src/shared/{kernel,audit,unidade,authz,totalizer,config,db,filas}/`, `tests/integracao/`, `prisma/schema/nucleo.prisma`, `src/modules/{aut,adm,orc,apr}/`, `src/proxy.ts`.
- **Frente B — plataforma, cadastros e saídas** (`/root/sistemas/sgo-b`; banco 56432, app 3200, Mailpit 8225): `src/shared/ia/`, `src/modules/{ger,cad,rel,int}/`, `worker/`, `.github/workflows/`, `docker/`, `deploy/`, `ops/`.
- **Compartilhados** (PR exclusivo com a label `compartilhado`, spec §12.5): `package.json`, `package-lock.json`, `tsconfig*.json`, lint, `next.config.*`, `CLAUDE.md`, `.claude/`, `prisma/schema/_base.prisma`, `src/app/layout.tsx`, `.github/frentes.yml`, `docs/superpowers/`.
- A versão executável do mapa é `.github/frentes.yml`. Uma história = branch `us-NNN-slug` = um PR com `Closes #n` e a label da frente.

## Princípios de produto

- **IA sugere, não grava:** nenhuma resposta de IA altera dado oficial diretamente; sugestão aceita passa pelo caso de uso normal, com `origem = sugestao_ia` no Histórico.
- Dinheiro em `NUMERIC(15,2)` com arredondamento Half-Even; `number` do JS é proibido para dinheiro.
