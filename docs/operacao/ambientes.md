# Ambientes hml e prod

Como o banco de `sgo-hml` e de `sgo-prod` é preparado (US-014; plano do P3, Tarefa 5). A criação dos projetos no Easypanel, os domínios e as variáveis entram na Tarefa 6.

## Papéis do banco

| Papel | Login | Para quê | Pode |
| --- | --- | --- | --- |
| `sgo_admin` | não | Dono do banco `sgo` | Nada no dia a dia. O PO entra como `postgres` e usa `SET ROLE` se precisar |
| `sgo_migrator` | sim | `MIGRATE_DATABASE_URL` (migrations) | Dono do schema `public`: cria e altera tabelas. Não altera o banco nem cria schema |
| `sgo_app` | sim | `DATABASE_URL` (app) | Lê e grava dados pelos privilégios que as migrations dão. Não cria objetos |
| `sgo_sync` | sim | Sincronização (US futura) | O mesmo que o `sgo_app` |
| `sgo_fila` | sim | `FILA_DATABASE_URL` (worker, pg-boss) | Dono só do schema `pgboss` |
| `sgo_leitura` | sim | Consultas *ad hoc* (spec §11.5 item 5) | Só `SELECT` no `public`, sujeito à RLS |

Regras que o script garante a cada execução:

- nenhum papel do SGO é superusuário nem tem `BYPASSRLS`;
- só os papéis do SGO conectam no `sgo`, e o PUBLIC não conecta nem no `postgres`;
- ninguém cria tabela temporária;
- funções que o `sgo_migrator` criar não nascem executáveis por todos. A migration que cria uma função chamada pela aplicação dá `GRANT EXECUTE` a quem usa. Funções de *trigger* não precisam disso. O dev e os testes seguem a mesma regra (`docker/postgres/init/03-privilegios.sql`).

O dump diário (Tarefa 7) não usa o `sgo_leitura`: com RLS, o `pg_dump` sem `BYPASSRLS` aborta. Ele roda como `postgres` pelo socket local do contêiner `db`.

## Criar os papéis (PO, uma vez por ambiente)

O script é `deploy/postgres/01-papeis-ambiente.sql`. Ele roda como superusuário, no banco `postgres`, e pega as senhas só do ambiente, nunca do arquivo nem da linha de comando.

1. Gere cinco senhas diferentes, com 16 caracteres ou mais, para cada ambiente. Guarde-as só nas variáveis do Easypanel (Tarefa 6) e no seu cofre de senhas.
2. No console do serviço `db` do ambiente, no Easypanel, leia as senhas sem eco, para elas não irem para o histórico:

   ```sh
   for v in SGO_SENHA_MIGRATOR SGO_SENHA_APP SGO_SENHA_SYNC SGO_SENHA_FILA SGO_SENHA_LEITURA; do
     read -rs -p "$v: " valor; echo; export "$v=$valor"
   done
   ```

3. Copie o script para o contêiner e rode:

   ```sh
   psql -X -U postgres -d postgres -f 01-papeis-ambiente.sql
   ```

   Sem saída é sucesso. Se faltar uma senha, ou se uma for curta, o script para e diz o nome da variável, sem mostrar o valor.
4. Confira que o `log_statement` do servidor não é `ddl` nem `all`. Se for, o `CREATE ROLE` com a senha vai para o log.

Rodar de novo é seguro: o script cria só o que falta e reaplica os atributos e os privilégios. Ele **não troca** a senha de papel que já existe.

## Trocar a senha de um papel

No `psql` como `postgres`, use `\password sgo_app` (pede a senha sem eco e não a manda em texto puro ao servidor). Depois, atualize a variável no Easypanel e reinicie o serviço.

## Próximos passos (Tarefa 6)

- Projetos `sgo-hml` e `sgo-prod` no Easypanel, cada um com o serviço `db` (`pgvector/pgvector:pg16`) e o `app`.
- Variáveis do `app`: `DATABASE_URL` (`sgo_app`) e `MIGRATE_DATABASE_URL` (`sgo_migrator`), apontando para o banco `sgo`.
- Domínios (GAP-INF-001) e a prova do deploy de ponta a ponta.
