# Ambientes hml e prod

Como o banco de `sgo-hml` e de `sgo-prod` é preparado (US-014; plano do P3, Tarefa 5). A criação dos projetos no Easypanel, os domínios e as variáveis entram na Tarefa 6.

## Papéis do banco

| Papel | Login | Para quê | Pode |
| --- | --- | --- | --- |
| `sgo_admin` | não | Dono do banco `sgo` | Nada no dia a dia. O PO entra como `postgres` e usa `SET ROLE` se precisar |
| `sgo_migrator` | sim | `MIGRATE_DATABASE_URL` (migrations) | Dono do schema `public`: cria e altera tabelas. Não altera o banco nem cria schema |
| `sgo_app` | sim | `DATABASE_URL` (app) | Lê e grava dados pelos privilégios que as migrations dão. Não cria objetos |
| `sgo_sync` | sim | `SYNC_DATABASE_URL` (**só no worker**): *merge* das cargas de estrutura (plano do P4, R6) e sincronização futura | Só o que cada migration dá. No `cad`: grava o plano de contas e o resultado dos lotes, e lê e apaga o *staging* |
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

## Cargas de estrutura (plano de contas, CC e cargos)

O app grava o pedido (lote `PENDENTE` e as linhas no *staging*) como `sgo_app`; o worker aplica como `sgo_sync`. Por isso:

- **`SYNC_DATABASE_URL` só no serviço `worker`.** O `app` **não** recebe essa variável: com ela, o app poderia gravar estrutura sem passar pelo lote.
- **Sem a variável no worker**, o log mostra `[CARGA_SEM_SYNC]` e os lotes ficam `PENDENTE` (visíveis na tela, que não avança). Com a variável apontando para outro papel, o log mostra `[CARGA_PAPEL_INVALIDO]` e nada é aplicado.
- **Lote que falha** fica `FALHOU`, com os erros por linha, e nunca é reprocessado: corrija a planilha e peça uma carga nova. Um lote preso em `PROCESSANDO` por mais de 15 min, ou `PENDENTE` por mais de 24 h, vira `FALHOU` sozinho.
- **Checklist do PO, por ambiente (hml e prod):**
  - [ ] `worker`: `SYNC_DATABASE_URL` com o `sgo_sync` e o banco `sgo`;
  - [ ] `app`, `worker` e serviço de migração: `AMBIENTE` (`hml` ou `producao`), obrigatório com `NODE_ENV=production` (R25);
  - [ ] `app`: **sem** `SYNC_DATABASE_URL`;
  - [ ] depois do deploy, o log do worker mostra `worker pronto` com `cargas: 'sgo_sync'`.

## Chave da cifra dos salários (cargos)

Os salários dos cargos (real, definido e função gratificada) são gravados cifrados, com AES-256-GCM, por coluna (plano do P4, R7). A cifra protege o disco, as cópias e os backups. **Ela não protege uma VPS comprometida**, porque a chave fica nas variáveis do app no mesmo host.

- **Variáveis, só no serviço `app`** (o `worker` não recebe a chave, porque ele só copia o envelope):
  - `CHAVE_CIFRA_SALARIOS`: 32 bytes em base64 (a chave atual);
  - `CHAVE_CIFRA_SALARIOS_ID`: o id da chave atual (até 20 letras, números, hífen ou sublinhado; ex.: `k2026a`);
  - `CHAVE_CIFRA_SALARIOS_ANTERIORES`: as chaves antigas, `id:base64;id:base64`, que ainda decifram os envelopes gravados com elas.
- **Gerar uma chave:** `openssl rand -base64 32`. No dev, ela fica só no `.env.local`; nunca no repositório.
- **Cópia fora da VPS:** o PO guarda cada chave, com o id, num cofre fora da VPS. Sem a chave, os salários cifrados não voltam.
- **Sem a chave**, só as funções de cargo com salário falham (`[CIFRA_SALARIOS_AUSENTE]` no log); o resto do sistema segue. A chave de teste do repositório é recusada com `AMBIENTE=producao`.
- **Checklist do PO, por ambiente (hml e prod):**
  - [ ] gerar a chave e escolher o id;
  - [ ] `app`: `CHAVE_CIFRA_SALARIOS` e `CHAVE_CIFRA_SALARIOS_ID`;
  - [ ] guardar a chave e o id no cofre fora da VPS;
  - [ ] `worker`: **sem** essas variáveis.

### Rotação da chave

1. Gere a chave nova e guarde-a no cofre, com um id novo.
2. No `app`, mova a atual para `CHAVE_CIFRA_SALARIOS_ANTERIORES` (`id_antigo:base64_antigo`) e ponha a nova em `CHAVE_CIFRA_SALARIOS` e `CHAVE_CIFRA_SALARIOS_ID`. Reinicie o `app`.
3. Rode a ação "Regravar salários com a chave atual" na tela de cargos (`cad.cargos:executar`, Task 12b). Ela regrava os campos manuais no app e manda o salário real num lote `CARGOS_RECIFRA` para o worker. Repita a ação até ela não ter mais o que regravar (um cargo alterado durante a regravação fica para a rodada seguinte). Com uma carga de cargos em andamento, a ação recusa antes de começar; se a carga entrar no meio, os manuais ficam regravados e o salário real fica para a rodada seguinte. Cargo com envelope ilegível fica de fora, com o log `[CIFRA_SALARIOS_ILEGIVEL]` (código e campo).
4. Confira que nenhum envelope usa o id antigo: `SELECT count(*) FROM cargo WHERE '<id_antigo>' IN (split_part(salario_real_cifrado, ':', 2), split_part(salario_definido_cifrado, ':', 2), split_part(funcao_gratificada_cifrada, ':', 2));` deve dar 0. (`LIKE` não serve: o `_` do id é curinga.)
5. Só então retire a chave antiga de `CHAVE_CIFRA_SALARIOS_ANTERIORES`. Depois da troca, a primeira recarga do Rubi também troca o envelope do salário real de todos os cargos: o lote conta todos como alterados (versão + 1 e uma entrada no Histórico cada), mesmo sem mudança de valor. Mantenha a cópia no cofre enquanto houver backup que a use.

## Trocar a senha de um papel

No `psql` como `postgres`, use `\password sgo_app` (pede a senha sem eco e não a manda em texto puro ao servidor). Depois, atualize a variável no Easypanel e reinicie o serviço.

## Próximos passos (Tarefa 6)

- Projetos `sgo-hml` e `sgo-prod` no Easypanel, cada um com o serviço `db` (`pgvector/pgvector:pg16`) e o `app`.
- Variáveis do `app`: `DATABASE_URL` (`sgo_app`), `MIGRATE_DATABASE_URL` (`sgo_migrator`), `URL_PUBLICA` e `AMBIENTE`, apontando para o banco `sgo`.
- Variáveis do `worker`: `DATABASE_URL` (`sgo_app`), `FILA_DATABASE_URL` (`sgo_fila`), a mesma `URL_PUBLICA` do app, `AMBIENTE` e as de SMTP (`docs/operacao/deploy.md`, serviço `worker`).
- **Checklist do PO, `AMBIENTE`:** `hml` em todos os serviços de hml e `producao` em todos os de prod (app, worker e o serviço de migração/seed). Na imagem, a falta dele impede o worker de partir.
- Domínios (GAP-INF-001) e a prova do deploy de ponta a ponta.
