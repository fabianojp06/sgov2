#!/usr/bin/env bash
# Prova real do backup (US-015; plano do P3, Tarefa 7) com a imagem do banco, sem storage externo:
# o repositório do pgBackRest é um volume local (repo1-type=posix, que as variáveis sobrepõem ao
# pgbackrest.conf). Usa os próprios scripts de ops/backup, com um docker que só redireciona o
# contêiner do db para o deste teste e monta o repositório no contêiner de restauração.
# Prova: o arquivamento liga com o repositório configurado; stanza, full e diff funcionam; a
# restauração devolve o registro gravado antes do diff; o contêiner e o volume da restauração somem.
# Uso: testar-backup.sh <imagem>   (ex.: sgo-b-postgres-teste:local). Roda no CI, no job Imagem.
set -euo pipefail

IMAGEM="${1:?uso: $0 <imagem do banco>}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
SUFIXO="$$"
DB="sgo-teste-backup-db-$SUFIXO"
REPO="sgo-teste-backup-repo-$SUFIXO"
T="$(mktemp -d)"
SENHA_COFRE="cofre-de-teste-$SUFIXO"
# Prefixo só deste teste: a limpeza nunca toca num teste mensal real (sgo-restauro-*) em andamento.
PREFIXO="sgo-teste-restauro-$SUFIXO"

limpar() {
  docker rm -fv "$DB" > /dev/null 2>&1 || true
  docker ps -aq --filter "name=^$PREFIXO-" | xargs -r docker rm -fv > /dev/null 2>&1 || true
  docker volume rm "$REPO" > /dev/null 2>&1 || true
  rm -rf "$T"
}
trap limpar EXIT

passo() { echo "== $*"; }
falha() { echo "FALHOU: $*" >&2; [ -s "$T/journal" ] && { echo "--- journal dos scripts:" >&2; cat "$T/journal" >&2; }; exit 1; }

# Variáveis do repositório: o db as recebe do Easypanel; a restauração, do backup-leitura.env.
cat > "$T/repo.env" <<EOF
PGBACKREST_REPO1_TYPE=posix
PGBACKREST_REPO1_PATH=/repo
PGBACKREST_REPO1_CIPHER_PASS=$SENHA_COFRE
PGBACKREST_REPO1_S3_BUCKET=teste-local
EOF

passo "banco com o repositório configurado (archive_timeout de 60 s)"
docker volume create "$REPO" > /dev/null
docker run -d --name "$DB" --memory 768m --env-file "$T/repo.env" \
  -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=sgo -v "$REPO:/repo" "$IMAGEM" > /dev/null
docker exec "$DB" chown postgres:postgres /repo
for _ in $(seq 1 60); do docker exec -u postgres "$DB" pg_isready -q -d sgo && break; sleep 1; done
# O entrypoint oficial reinicia o Postgres depois do init: espera o servidor definitivo.
sleep 3
for _ in $(seq 1 60); do docker exec -u postgres "$DB" pg_isready -q -d sgo && break; sleep 1; done
[ "$(docker exec -u postgres "$DB" psql -Atc 'show archive_mode')" = on ] || falha "archive_mode não ligou com o repositório configurado"
[ "$(docker exec -u postgres "$DB" psql -Atc 'show archive_timeout')" = 1min ] || falha "archive_timeout não é 60 s"

passo "stanza e tabelas"
docker exec -u postgres "$DB" pgbackrest --stanza=sgo stanza-create
docker exec -u postgres "$DB" psql -q -d sgo -c \
  "create table historico_operacao (id serial primary key, ocorrido_em timestamptz default clock_timestamp(), texto text);
   insert into historico_operacao (texto) values ('antes do full');"

# docker para os scripts: o ps devolve o db deste teste; o run da restauração monta o repositório.
cat > "$T/docker" <<EOF
#!/usr/bin/env bash
if [ "\$1" = ps ] && [[ "\$*" == *"_db"* ]]; then echo "$DB"; exit 0; fi
if [ "\$1" = run ]; then shift; exec docker run -v "$REPO:/repo" "\$@"; fi
exec docker "\$@"
EOF
chmod +x "$T/docker"
# O "journal" dos scripts vai para um arquivo, mostrado se a prova falhar.
printf '#!/bin/sh\necho "$@" >> %s/journal\nif [ $# -le 2 ]; then cat >> %s/journal; fi\n' "$T" "$T" > "$T/logger"
chmod +x "$T/logger"
export DOCKER="$T/docker" LOGGER="$T/logger" ALERTA_WEBHOOK_URL=""

passo "backup full pelo script"
"$RAIZ/ops/backup/backup-pgbackrest.sh" hml full

passo "registro novo e backup diferencial"
docker exec -u postgres "$DB" psql -q -d sgo -c "insert into historico_operacao (texto) values ('depois do full');"
"$RAIZ/ops/backup/backup-pgbackrest.sh" hml diff
docker exec -u postgres "$DB" pgbackrest --stanza=sgo info | grep -q 'diff backup' || falha "o diferencial não aparece no info"

passo "restauração pelo script"
grep -v '^PGBACKREST_REPO1_S3_BUCKET=' "$T/repo.env" > "$T/leitura.env"
IMAGEM_POSTGRES="$IMAGEM" PULL=never RESTAURO_PREFIXO="$PREFIXO" ENV_LEITURA="$T/leitura.env" \
  LOG_RESTAURACOES="$T/restauracoes.log" ESPERA_PRONTO=180 INTERVALO=2 \
  "$RAIZ/ops/backup/testar-restauracao.sh" hml || { cat "$T/restauracoes.log" >&2 || true; falha "a restauração reprovou"; }
cat "$T/restauracoes.log"
grep -qE ' hml OK [0-9]+s tabelas=1 historico=' "$T/restauracoes.log" || falha "linha OK esperada no log"
# O último registro do Histórico restaurado é o gravado depois do full (veio do diferencial).
ultimo="$(docker exec -u postgres "$DB" psql -Atc "select max(ocorrido_em) from historico_operacao" -d sgo)"
grep -qF "historico=$ultimo" "$T/restauracoes.log" || falha "o registro do diferencial não voltou na restauração ($ultimo)"

passo "contêiner e volume da restauração removidos"
[ -z "$(docker ps -aq --filter "name=^$PREFIXO-")" ] || falha "o contêiner da restauração ficou"

echo "OK: backup full e diferencial, restauração com o registro do diferencial e limpeza."
