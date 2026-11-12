# Backup de hml e prod

Backup com recuperação ponto a ponto (PITR), dump diário cifrado e teste de restauração mensal (US-015, #37; plano do P3, Tarefa 7; spec §4.3 e §11.5). Os horários são do host, em **UTC** (03:00 UTC = 00:00 em Brasília).

| O quê | Quando | Onde roda | Para onde vai |
| --- | --- | --- | --- |
| WAL contínuo (PITR) | a cada segmento, no máximo a cada 60 s (`archive_timeout`) | pgBackRest, dentro do `db` | storage externo, `/<ambiente>/archive` |
| Backup full | domingo, 03:00 | timer `sgo-backup-full@<ambiente>` | storage externo, retenção de 30 dias |
| Backup diferencial | segunda a sábado, 03:00 | timer `sgo-backup-diff@<ambiente>` | idem |
| Dump lógico cifrado (`pg_dump -Fc` + `age`) | todo dia, 02:30 | timer `sgo-backup-dump@<ambiente>` | storage externo, `dumps/<ambiente>/AAAA-MM-DD.dump.age`, 90 dias (*lifecycle* do bucket) |
| Teste de restauração | dia 1, 04:00 | timer `sgo-backup-restauracao@<ambiente>` | `/var/lib/sgo/restauracoes.log` e o alerta |

- Os timers têm até 20 min de atraso aleatório, para hml e prod não começarem juntos.
- Toda falha vai para o journal (`journalctl -t sgo-backup`) e para o `ALERTA_WEBHOOK_URL` de `/etc/sgo/alerta.env`, inclusive:
  - o erro inesperado do script;
  - a unit que falha antes do script (sem o arquivo de segredos, docker fora, OOM, timeout), pelo `OnFailure=sgo-backup-alerta@`.
- O backup diário também confere o arquivamento (`pg_stat_archiver` e `pgbackrest check`). Um `archive-push` falhando alerta, mesmo que o backup passe.
- Uma operação por ambiente de cada vez (trava em `/run/lock`): o full e o diferencial que disparam juntos depois de um boot não colidem.
- **O que está pronto no repositório:** a imagem do banco com o pgBackRest (`ghcr.io/fabianojp06/sgov2-postgres`), os scripts e os timers (`ops/backup/`). O CI também prova, a cada PR, o backup full e o diferencial e a restauração com um repositório local (`docker/testes/testar-backup.sh`).
- **O que falta é com o PO:** o storage externo (GAP-INF-001) e a ativação, nos passos abaixo.

## A imagem do banco

`docker/postgres-ambiente.Dockerfile`: a mesma `pgvector/pgvector:pg16` do CI, fixada pelo digest, com o pgBackRest.

- **Digest em três lugares, trocados juntos:** o `ci.yml` (serviço do job Migrations), o `postgres-ambiente.Dockerfile` e o `tests/integracao/banco.ts` (`IMAGEM_BANCO`, da frente A, #431). Assim, os testes, o CI, hml e prod usam o mesmo Postgres.

- O `imagem.yml` publica a cada merge na `main`: `sgov2-postgres:sha-<commit>` e `:atual`.
- **O arquivamento só liga com o repositório configurado.** Ele depende da variável `PGBACKREST_REPO1_S3_BUCKET` (`docker/postgres/entrypoint-backup.sh`). Sem ela, o banco sobe como a pgvector comum. É seguro trocar a imagem antes de o storage existir: um `archive_command` sem destino guardaria os WAL até encher o disco.
- A configuração fixa está em `docker/postgres/pgbackrest.conf`: cifra AES-256 do repositório, retenção de 30 dias e compressão zstd. O resto vem das variáveis do serviço `db`.

## Ativar (PO, primeiro em hml e só depois em prod)

### 1. Storage (uma vez)

1. Escolha o provedor (Backblaze B2 ou Cloudflare R2) e crie **um bucket** com versionamento.
2. Crie uma regra de *lifecycle* que apaga `dumps/` depois de 90 dias.
3. Crie **três chaves**, cada uma só com o que precisa:

   | Chave | Permissão | Onde fica |
   | --- | --- | --- |
   | pgBackRest | leitura e escrita no bucket | variáveis do serviço `db` no Easypanel |
   | dump | **só escrita** em `dumps/` | `/etc/sgo/backup-dump-<ambiente>.env` no host |
   | restauração | **só leitura** | `/etc/sgo/backup-leitura-<ambiente>.env` no host |
4. Gere a **senha do cofre** do pgBackRest (`openssl rand -base64 48`) e o par de chaves do `age` (`age-keygen -o chave-sgo.txt`).
   - A senha do cofre e a **chave privada** do `age` ficam no cofre do PO, **fora da VPS**. Sem elas, nenhum backup volta.
   - A chave pública (`age1...`) vai no arquivo do dump.

### 2. Serviço `db` do ambiente (Easypanel)

1. **Teste antes num serviço descartável:** confira se o Easypanel troca a imagem de um Postgres mantendo o volume. Depois, troque a imagem do `db` para `ghcr.io/fabianojp06/sgov2-postgres:sha-<commit>`, com a mesma credencial do GHCR do `app`. O campo *Command* fica **vazio** (`deploy.md`, "Comando dos serviços no Easypanel").
2. Variáveis do `db`:
   ```
   PGBACKREST_REPO1_S3_BUCKET=<bucket>
   PGBACKREST_REPO1_S3_ENDPOINT=<endpoint do provedor, sem https://>
   PGBACKREST_REPO1_S3_REGION=<região; no R2, auto>
   PGBACKREST_REPO1_S3_KEY=<chave do pgBackRest>
   PGBACKREST_REPO1_S3_KEY_SECRET=<segredo>
   PGBACKREST_REPO1_PATH=/<ambiente>
   PGBACKREST_REPO1_CIPHER_PASS=<senha do cofre>
   ```
3. Faça o *redeploy* do `db`. No console dele, `psql -U postgres -Atc 'show archive_mode'` deve dar `on`.
   **A partir daqui, o arquivamento está ligado.** Faça os passos 4 e o "Host" **no mesmo dia**. Sem a *stanza*, o `archive-push` falha, e sem os timers nada alerta: os WAL se acumulam no disco do `db`.
4. No console do `db`, como `postgres` (`su postgres -s /bin/bash`):
   ```
   pgbackrest --stanza=sgo stanza-create
   pgbackrest --stanza=sgo check
   pgbackrest --stanza=sgo backup --type=full
   pgbackrest --stanza=sgo info
   ```

### 3. Host

1. Crie `/etc/sgo/backup-dump-<ambiente>.env` (`chmod 600`):
   ```
   AGE_DESTINATARIO=age1...
   DESTINO_DUMP=sgo:<bucket>/dumps
   RCLONE_CONFIG_SGO_TYPE=s3
   RCLONE_CONFIG_SGO_PROVIDER=<Cloudflare | Other>
   RCLONE_CONFIG_SGO_ENDPOINT=https://<endpoint>
   RCLONE_CONFIG_SGO_ACCESS_KEY_ID=<chave só de escrita>
   RCLONE_CONFIG_SGO_SECRET_ACCESS_KEY=<segredo>
   ```
2. Crie `/etc/sgo/backup-leitura-<ambiente>.env` (`chmod 600`) com as **mesmas** sete `PGBACKREST_REPO1_*` do `db`, trocando a chave e o segredo pelos da **chave só de leitura**. Os valores podem ir com ou sem aspas.
   - O script monta essas variáveis como um arquivo só leitura no contêiner de restauração, e não no ambiente dele, para não aparecerem no `docker inspect`.
   - O restauro não grava no repositório: o banco restaurado sobe com `archive_mode=off`.
3. Faça login no GHCR com a credencial só de leitura (`docker login ghcr.io`), para o teste de restauração baixar a imagem do banco.
4. Instale e ligue: `sudo bash ops/backup/instalar.sh hml`. Ele recusa ligar os timers de um ambiente sem os dois arquivos.
5. Prove na hora, sem esperar o calendário:
   ```
   systemctl start sgo-backup-dump@hml.service sgo-backup-restauracao@hml.service
   journalctl -t sgo-backup -n 20
   tail -n1 /var/lib/sgo/restauracoes.log
   ```
   Transcreva a linha da restauração para `docs/operacao/restauracoes.md` num PR.

## Restaurar de verdade

- **Ponto no tempo (PITR):** com o `db` parado, num contêiner da imagem do banco com o volume dele, rode `pgbackrest --stanza=sgo --delta --type=time --target='AAAA-MM-DD HH:MM:SS+00' --target-action=promote restore` e suba o `db`. Antes, tire o snapshot da VPS (hPanel). O procedimento completo está em `runbook.md`, procedimento 4.
- **Dump:** sempre **fora da VPS**.
  1. Baixe com `rclone copyto sgo:<bucket>/dumps/<ambiente>/<data>.dump.age .`, usando uma chave de leitura.
  2. Decifre com `age -d -i chave-sgo.txt -o sgo.dump <data>.dump.age`.
  3. Para conferir: `pg_restore --list sgo.dump`.
  4. Para restaurar:
     - num servidor novo, rode **antes** o `deploy/postgres/01-papeis-ambiente.sql`, porque o dump leva só o banco `sgo`, sem os papéis;
     - depois, como `postgres`, rode `pg_restore -d sgo sgo.dump`. Os donos e os GRANTs voltam, porque os papéis já existem.

## Teste de restauração mensal

O `testar-restauracao.sh` faz o seguinte:
1. **antes de restaurar, reprova se:**
   - o último backup tiver mais de 8 dias;
   - faltar espaço livre para o dobro do banco no disco do Docker, porque a restauração não pode encher o disco do prod;
2. restaura o último backup num contêiner `sgo-restauro-<ambiente>-<data>-<pid>`, com o *replay* de todo o WAL arquivado:
   - sem porta publicada;
   - com 768 MB e `oom_score_adj 500`, de modo que, sob falta de memória, morre antes da produção;
   - com `nice 10`, para ceder CPU à produção;
3. **espera a recuperação terminar** (`pg_is_in_recovery()` falso), com um prazo de 1h30. Um contêiner que para reprova na hora, e o log dele vai para o journal;
4. confere as tabelas do `public` e se o último registro do Histórico restaurado chega **pelo menos ao do banco de origem de 15 minutos atrás**. Isso prova o PITR: um segmento de WAL faltando para a recuperação antes, e o teste reprova;
5. grava a linha `data ambiente OK|FALHOU tempo detalhe` e manda o mesmo texto ao alerta;
6. remove o contêiner **e o volume**, e só o que ele mesmo criou.

- **O nome `sgo-restauro-*`** fica fora dos padrões de prioridade de memória de produção (`sgo-ajustar-oom`). Assim, sob falta de memória, ele morre antes do prod.
- **O contêiner leva uma cópia integral dos dados do ambiente**, então as sessões de dev também não o acessam: o hook de D12 bloqueia `sgo-restauro-*` como bloqueia `sgo-prod`. Isso vem num PR `compartilhado`, porque `.claude/` é compartilhado.
