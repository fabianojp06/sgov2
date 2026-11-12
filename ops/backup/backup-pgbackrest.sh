#!/usr/bin/env bash
# Backup físico com o pgBackRest (US-015; plano do P3, Tarefa 7): full aos domingos e diferencial
# nos outros dias, às 03:00 UTC (timers sgo-backup-full@ e sgo-backup-diff@). Roda o pgbackrest dentro
# do contêiner db do ambiente, que tem a configuração do repositório S3 nas variáveis do Easypanel.
# Antes do backup, confere o arquivamento contínuo: um archive-push falhando acumula WAL no disco do
# db e quebra o PITR, então alerta mesmo que o backup em si passe.
# Uso: backup-pgbackrest.sh <hml|prod> <full|diff>
set -euo pipefail
# shellcheck source=ops/backup/comum.sh
. "$(dirname "$(readlink -f "$0")")/comum.sh"

ambiente="${1:-}"
tipo="${2:-}"
case "$tipo" in
  full | diff) ;;
  *) trap - ERR; echo "uso: $0 <hml|prod> <full|diff>" >&2; exit 64 ;;
esac
projeto="$(projeto_do_ambiente "$ambiente")" || { trap - ERR; exit 64; }
travar "$ambiente"

c="$(conteiner_db "$projeto")" || falhar "$ambiente: o docker não respondeu; backup $tipo não feito"
[ -n "$c" ] || falhar "$ambiente: contêiner do db não encontrado ($projeto); backup $tipo não feito"

# Arquivamento: falha mais recente que o último sucesso = WAL parado no disco do db.
arquivo="$("$DOCKER" exec -u postgres "$c" psql -X -Atc \
  "select coalesce(last_failed_time > coalesce(last_archived_time, 'epoch'), false) from pg_stat_archiver")" \
  || falhar "$ambiente: não consegui consultar o pg_stat_archiver"
if [ "$arquivo" = t ]; then
  alertar "SGO backup: $ambiente: o arquivamento de WAL está falhando (pg_stat_archiver); o PITR está parado e os WAL se acumulam no disco"
fi
"$DOCKER" exec -u postgres "$c" pgbackrest --stanza=sgo check \
  || falhar "$ambiente: pgbackrest check falhou (repositório ou arquivamento); backup $tipo não feito"

inicio=$(date +%s)
"$DOCKER" exec -u postgres "$c" pgbackrest --stanza=sgo backup --type="$tipo" \
  || falhar "$ambiente: backup $tipo do pgBackRest falhou"
"$LOGGER" -t sgo-backup "$ambiente: backup $tipo concluído em $(( $(date +%s) - inicio ))s" 2>/dev/null || true
