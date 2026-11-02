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
| `sgo_leitura` | sim | Consultas *ad hoc* (spec §11.5 item 5) | Só `SELECT` no `public`, sujeito à RLS, numa sessão só de leitura. Vê o Histórico de Operações inteiro (IP, antes e depois), que não tem RLS |

Regras que o script garante a cada execução:

- nenhum papel do SGO é superusuário, tem `BYPASSRLS`, limite de conexões ou data de validade;
- as configurações dos papéis são só as do script (`search_path` fixo e, no `sgo_leitura`, sessão só de leitura);
- só os papéis do SGO conectam no `sgo`, e o PUBLIC não conecta no `postgres` nem no `template1`;
- ninguém cria schema nem tabela temporária, e privilégios dados a mais aos papéis do SGO e ao PUBLIC no banco e nos schemas `public` e `pgboss` são retirados. Esses privilégios pertencem ao script: nenhuma migration deve dá-los, porque a próxima execução os tiraria. Grants a papéis de fora do SGO não são mexidos;
- a extensão `vector` (pgvector) já fica instalada, também no dev, nos testes e no shadow (`03-privilegios.sql`). Só o superusuário a cria, e a migration que a usar escreve `CREATE EXTENSION IF NOT EXISTS vector`. Ela fica no `public`, que é do `sgo_migrator`: num `ALTER EXTENSION vector UPDATE` depois de atualizar a imagem, confira antes que o migrator não criou no `public` objetos com nomes das funções da extensão (CVE-2022-2625);
- funções que o `sgo_migrator` criar não nascem executáveis por todos. A migration que cria uma função chamada pela aplicação dá `GRANT EXECUTE` a quem usa. Funções de *trigger* não precisam disso.

O script **recusa, sem mudar nada,** um papel do SGO que seja membro de outro papel ou tenha membros, ou que tenha configuração por banco (`ALTER ROLE ... IN DATABASE`). Qualquer um desses dá a um papel o poder de outro, e não há como saber se foi de propósito. Se acontecer, desfaça à mão e rode de novo.

O dev e os testes seguem as regras de TEMP, de funções e da extensão (`docker/postgres/init/03-privilegios.sql`). Os scripts de init só rodam na criação do volume. Para um volume de dev que já existe, aplique à mão; o comando só mexe em privilégios:

```sh
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -f /docker-entrypoint-initdb.d/03-privilegios.sql
```

O dump diário (Tarefa 7) não usa o `sgo_leitura`: com RLS, o `pg_dump` sem `BYPASSRLS` aborta. Ele roda como `postgres` pelo socket local do contêiner `db`. O `pg_dump -d sgo` não leva os papéis, os privilégios do banco nem as configurações dos papéis. Por isso, a restauração começa rodando este script no servidor novo.

## Criar os papéis (PO, uma vez por ambiente)

O script é `deploy/postgres/01-papeis-ambiente.sql`. Ele roda como superusuário, no banco `postgres`, e pega as senhas só do ambiente, nunca do arquivo nem da linha de comando. Ele desliga, só na própria sessão, o log de comandos do servidor, que gravaria as senhas. Extensões de auditoria como `pgaudit` ou `auto_explain` não são desligadas por ele: se estiverem carregadas no servidor, tire-as antes.

1. Gere cinco senhas diferentes para cada ambiente, com 16 caracteres ou mais, só com letras e números: `@`, `/`, `#` e `:` quebram as URLs de conexão. Guarde-as só nas variáveis do Easypanel (Tarefa 6) e no seu cofre de senhas.
2. No console do serviço `db` do ambiente, no Easypanel, abra o `bash` (o `read -s` não existe no `sh`) e cole o script num arquivo:

   ```sh
   bash
   cat > /tmp/01-papeis-ambiente.sql   # cole o conteúdo e termine com Ctrl+D
   ```

3. Leia as senhas sem eco, para elas não irem para o histórico, rode o script e apague tudo:

   ```sh
   for v in SGO_SENHA_MIGRATOR SGO_SENHA_APP SGO_SENHA_SYNC SGO_SENHA_FILA SGO_SENHA_LEITURA; do
     read -rs -p "$v: " valor; echo; export "$v=$valor"
   done
   psql -X -U postgres -d postgres -f /tmp/01-papeis-ambiente.sql
   unset valor SGO_SENHA_MIGRATOR SGO_SENHA_APP SGO_SENHA_SYNC SGO_SENHA_FILA SGO_SENHA_LEITURA
   rm /tmp/01-papeis-ambiente.sql; exit
   ```

   Na primeira execução, sem saída é sucesso. Se faltar uma senha ou se uma for curta, o script para e diz o nome da variável, sem mostrar o valor. Se houver senhas repetidas, ele para e diz isso.

Rodar de novo é seguro: o script cria só o que falta e reaplica os atributos, as configurações e os privilégios. Ele **não troca** a senha de papel que já existe: nessa execução, a única saída é o aviso dos papéis que mantiveram a senha.

## Trocar a senha de um papel

No `psql` como `postgres`, use `\password sgo_app` (pede a senha sem eco e não a manda em texto puro ao servidor). Depois, atualize a variável no Easypanel e reinicie o serviço.

## Próximos passos (Tarefa 6)

- Projetos `sgo-hml` e `sgo-prod` no Easypanel, cada um com o serviço `db` (`pgvector/pgvector:pg16`) e o `app`.
- Variáveis do `app`: `DATABASE_URL` (`sgo_app`), `MIGRATE_DATABASE_URL` (`sgo_migrator`), `URL_PUBLICA` e `AMBIENTE`, apontando para o banco `sgo`.
- Variáveis do `worker`: `DATABASE_URL` (`sgo_app`), `FILA_DATABASE_URL` (`sgo_fila`), a mesma `URL_PUBLICA` do app, `AMBIENTE` e as de SMTP (`docs/operacao/deploy.md`, serviço `worker`).
- **Checklist do PO, `AMBIENTE`:** `hml` em todos os serviços de hml e `producao` em todos os de prod (app, worker e o serviço de migração/seed). Na imagem, a falta dele impede o worker de partir.
- Domínios (GAP-INF-001) e a prova do deploy de ponta a ponta.
