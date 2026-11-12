#!/usr/bin/env bash
# Backup físico com o pgBackRest (US-015; plano do P3, Tarefa 7): full aos domingos e diferencial
# nos outros dias, às 03:00 (timers sgo-backup-full@ e sgo-backup-diff@). Roda o pgbackrest dentro do
# contêiner db do ambiente, que tem a configuração do repositório S3 nas variáveis do Easypanel.
# Uso: backup-pgbackrest.sh <hml|prod> <full|diff>
set -euo pipefail
# shellcheck source=ops/backup/comum.sh
. "$(dirname "$(readlink -f "$0")")/comum.sh"

ambiente="${1:-}"
tipo="${2:-}"
case "$tipo" in
  full | diff) ;;
  *) echo "uso: $0 <hml|prod> <full|diff>" >&2; exit 64 ;;
esac
projeto="$(projeto_do_ambiente "$ambiente")" || exit 64

c="$(conteiner_db "$projeto")"
[ -n "$c" ] || falhar "$ambiente: contêiner do db não encontrado ($projeto); backup $tipo não feito"

inicio=$(date +%s)
"$DOCKER" exec -u postgres "$c" pgbackrest --stanza=sgo backup --type="$tipo" \
  || falhar "$ambiente: backup $tipo do pgBackRest falhou"
"$LOGGER" -t sgo-backup "$ambiente: backup $tipo concluído em $(( $(date +%s) - inicio ))s" 2>/dev/null || true
