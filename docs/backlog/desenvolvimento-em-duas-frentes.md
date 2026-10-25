# SGO 2.0 — Guia operacional das duas frentes

> As **regras** estão na spec, §12 (`docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md`). Este guia traz só os comandos do dia a dia. Em caso de divergência, vale a spec.

## 1. Montar o ambiente da frente B (uma vez)

```bash
# worktree da frente B a partir da main atualizada
git -C /root/sistemas/sgo fetch origin
git -C /root/sistemas/sgo worktree add /root/sistemas/sgo-b origin/main
git -C /root/sistemas/sgo config extensions.worktreeConfig true

# primeira sessão da conta 2: fazer /login com a segunda conta
cd /root/sistemas/sgo-b && CLAUDE_CONFIG_DIR=/root/.claude-frente-b claude
```

Atalho opcional no `~/.bashrc`:

```bash
alias sgo-a='cd /root/sistemas/sgo && claude'
alias sgo-b='cd /root/sistemas/sgo-b && CLAUDE_CONFIG_DIR=/root/.claude-frente-b claude'
```

Cada worktree tem dois arquivos locais, fora do git, copiados do `.env.example` com as portas da §12.4:

- **`.env`**: lido pelo Docker Compose. Sem ele, o compose não sobe, para que uma frente nunca assuma os contêineres da outra.
- **`.env.local`**: lido pelo Prisma (`prisma.config.ts`) e pela aplicação.

| Variável | Arquivo | Frente A | Frente B |
| --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `.env` | `sgo-a` | `sgo-b` |
| `DB_PORT` | `.env` | 55432 | 56432 |
| `APP_PORT` | `.env` | 3100 | 3200 |
| `MAILPIT_PORT` | `.env` | 8125 | 8225 |
| `POSTGRES_PASSWORD` | `.env` | aleatória | aleatória |
| `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `SHADOW_DATABASE_URL` | `.env.local` | `127.0.0.1:55432` | `127.0.0.1:56432` |

Depois de criar os dois arquivos: `npm ci`, `docker compose up -d`, `npm run db:deploy` e `npm run db:seed`.

O texto de abertura da primeira sessão da frente B está em `docs/backlog/abertura-frente-b.md`.

## 2. Início de cada sessão (as duas frentes)

Mensagem inicial sugerida para o Claude Code:

> Você é a **frente X** do SGO 2.0. Siga a spec §12. Pegue no projeto "SGO 2.0 – Roadmap" a próxima issue com Frente = X, Status = "A fazer" e dependências fechadas; mova para "Em andamento", comente na issue e trabalhe na branch `us-NNN-slug`.

Comandos úteis:

```bash
gh issue list --repo fabianojp06/sgov2 --label frente:A --label trilha-2027 --state open   # fila da frente
git fetch origin && git rebase origin/main                                                # atualizar a branch
gh pr create --fill --label frente:A                                                      # abrir PR (corpo com Closes #n)
```

## 3. Encerramento de cada sessão

Comentar na issue em andamento:

```
Passagem de sessão (frente X)
- Feito: …
- Falta: …
- Decisões: …
- Branch/PR: …
```

## 4. Divisão atual

Pelo épico (spec §12.2; `docs/backlog/fonte/dados.py`, `FRENTE_POR_EPICO`). Na trilha 2027: frente A com 23 histórias (196 h) e frente B com 18 histórias (188 h). Pelo `cronograma.py`, a trilha termina por volta de 11/12/2026 a 40 h/semana por frente e de 27/11/2026 a 60 h/semana por frente.
