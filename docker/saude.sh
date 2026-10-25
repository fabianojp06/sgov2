#!/usr/bin/env bash
# Healthcheck da imagem (HEALTHCHECK do app.Dockerfile).
# - app: GET /login responde 200;
# - worker: não abre porta. Ele sai sozinho depois de falhas seguidas no outbox
#   (worker/index.ts) e o contêiner para junto, então, se este script roda, ele está vivo.
set -euo pipefail

# Modo pela linha de comando do PID 1: tini -g -- /app/docker/entrypoint.sh <modo>.
if tr '\0' '\n' < /proc/1/cmdline | grep -qx worker; then
  exit 0
fi
exec node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/login').then((r) => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"
