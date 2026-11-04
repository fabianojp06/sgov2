#!/usr/bin/env bash
# Roda o paginas.js no k6 por imagem, com memória e CPU limitadas (plano do P7, Task 3, D-P7-1).
# Uso: SGO_BASE=http://127.0.0.1:3200 SGO_LOGIN=... SGO_SENHA=... ops/carga/rodar.sh
# Destinos aceitos: o app de dev da frente B (127.0.0.1:3200) ou uma URL https informada pelo PO
# (hml, na janela combinada). Nunca contêiner, rede ou volume de sgo-prod/sgo-hml (D12).
set -euo pipefail

IMAGEM="grafana/k6:1.0.0"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${SGO_BASE:?SGO_BASE obrigatória}"
case "$SGO_BASE" in
  http://127.0.0.1:3200) ;;
  https://*) echo "Destino remoto: $SGO_BASE. Confirme a janela combinada com o PO (D-P7-1)." >&2 ;;
  *) echo "SGO_BASE recusada: só http://127.0.0.1:3200 ou uma URL https." >&2; exit 2 ;;
esac

# Um processo pesado por vez (D12): o mesmo lock do test:int e do test:e2e.
exec 9>/tmp/sgo-processo-pesado.lock
flock -w 1800 9

par="$(node "$DIR/sessao.mjs")"
export SGO_COOKIE="${par%%=*}" SGO_SESSAO="${par#*=}"

docker run --rm -i --network host --memory 256m --cpus 1 \
  -e SGO_BASE -e SGO_SESSAO -e SGO_COOKIE -e SGO_PAGINAS -e SGO_VUS -e SGO_DURACAO \
  "$IMAGEM" run --quiet --include-system-env-vars - < "$DIR/paginas.js"
