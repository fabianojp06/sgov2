# SGO 2.0 — Desenvolvimento em duas frentes (duas contas do Claude Code)

| Campo | Valor |
| --- | --- |
| Versão | 1.0 — 24/10/2026 |
| Objetivo | Dobrar a vazão de desenvolvimento para a trilha do orçamento 2027 (meta 30/11/2026) sem conflito entre as frentes |
| Cronograma | GitHub Project "SGO 2.0 – Roadmap", campo **Frente** (A/B), gerado por `docs/backlog/fonte/cronograma.py` |

## 1. Por que duas frentes ajudam

O caminho crítico da trilha 2027 é curto (96 h). O que segura o prazo é a vazão total (376 h, ou 452 h com contingência). Uma segunda conta dobra o limite de uso do Claude Code e permite dois trabalhos simultâneos. O gargalo passa a ser a revisão do PO.

## 2. Divisão de responsabilidades

| Frente | Conta | Foco | Histórias fixadas |
| --- | --- | --- | --- |
| **A — Núcleo e domínio** | conta atual | kernel (dinheiro, auditoria, totalizador), autenticação, motor de custo de pessoal, orçamento da Adm. Central | US-001, 004, 005, 006, 009, 051, 058, 059, 061, 121 |
| **B — Infra, componentes e cargas** | segunda conta | VPS/CI/backup, componentes de tela, importações (plano de contas, CC, cargos, benefícios), planilha-modelo, testes de segurança | US-013, 014, 015, 016, 017, 116, 119, 120 |

As demais histórias vão para a primeira frente livre, respeitando as dependências. O campo **Frente** do projeto mostra quem pega cada uma, e pode ser trocado à mão.

**Primeira semana:** a frente B não depende do código para começar. Ela abre com a **planilha-modelo (US-120)**, que é urgente porque os gestores precisam dela já, com o endurecimento da VPS (US-016) e os ambientes do Easypanel (US-014). Enquanto isso, a frente A monta o repositório (US-001). Com o US-001 na `main`, as duas frentes seguem com o código.

## 3. Como montar o ambiente da segunda conta

Opção recomendada, na mesma VPS, com diretório e configuração separados:

```bash
# uma vez
git -C /root/sistemas/sgo worktree add /root/sistemas/sgo-b main
# cada sessão da frente B
cd /root/sistemas/sgo-b && CLAUDE_CONFIG_DIR=/root/.claude-frente-b claude   # na primeira vez: /login com a segunda conta
```

- `CLAUDE_CONFIG_DIR` separa login, histórico e memória das duas contas.
- Cada worktree sobe o próprio Docker Compose com `COMPOSE_PROJECT_NAME` e portas próprias (A: banco 55432 e app 3100; B: banco 56432 e app 3200; a 3000 já é do Easypanel), para que os bancos de dev não se misturem.
- Alternativa: a frente B roda no seu computador, com um clone do repositório. O efeito é o mesmo.
- Cada conta é sua e de uso pessoal. Não compartilhe credenciais nem tokens entre elas.

## 4. Regras para as frentes não colidirem

1. **Uma história = uma branch = um PR.** Branch `us-0NN-slug`, criada a partir da `main` atualizada. O PR fecha a issue (`Closes #n`).
2. **Status "Em andamento" é a trava.** Antes de começar, a frente move a issue no quadro. A outra frente não pega issue em andamento.
3. **Só começa história com as dependências já na `main`.**
4. **Schema do Prisma em arquivos por módulo** (`prisma/schema/<modulo>.prisma`), para que as frentes editem arquivos diferentes.
5. **Migrations:** uma por PR, gerada só depois de rebase na `main`. Se a outra frente fez merge de uma migration antes, a sua é apagada e gerada de novo; nunca se edita migration já aplicada.
6. **Arquivos compartilhados** (`CLAUDE.md`, `shared/kernel`, `package.json`, componentes base) só mudam em PR próprio e pequeno, com merge rápido.
7. **CI obrigatório verde e revisão do PO** antes do merge. A proteção da `main` exige PR.
8. **Banco de produção:** só a frente B mexe na infraestrutura de prod, sempre seguindo a regra do `CLAUDE.md` (dizer se o comando escreve, apaga ou reseta, conferir `DATABASE_URL`/`SHADOW_DATABASE_URL`, nunca apontar shadow para prod).

## 5. Rotina do PO

| Momento | O que fazer |
| --- | --- |
| Início do dia | Conferir o quadro e liberar 1 ou 2 histórias por frente |
| Durante o dia | Revisar PRs à medida que chegam (CI já validou lint, testes e marca neutra) |
| Fim do dia | Merge dos PRs aprovados, nesta ordem: arquivos compartilhados → migrations → resto |
| Semanal | Homologação em hml do que entrou e ajuste das datas (rodar `cronograma.py` de novo) |

## 6. Pré-requisito

As frentes trabalham via GitHub, então o desenvolvimento só começa depois do push da branch de especificação para a `main` e da proteção da `main` (PR obrigatório e CI). O push depende da sua liberação.
