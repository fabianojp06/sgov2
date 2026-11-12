#!/usr/bin/env bash
# Entrypoint do banco de hml e prod (US-015). Liga o arquivamento contínuo de WAL no pgBackRest só
# quando o repositório está configurado (PGBACKREST_REPO1_S3_BUCKET nas variáveis do Easypanel). Sem
# ele, o banco sobe como a pgvector comum: um archive_command sem destino falharia sempre, e o
# Postgres guardaria os WAL até encher o disco. Depois chama o entrypoint oficial da imagem.
set -euo pipefail

if [ "${1:-}" = postgres ] && [ -n "${PGBACKREST_REPO1_S3_BUCKET:-}" ]; then
  set -- "$@" -c archive_mode=on -c 'archive_command=pgbackrest --stanza=sgo archive-push %p'
fi
exec docker-entrypoint.sh "$@"
