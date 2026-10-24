#!/usr/bin/env bash
# Prioridade de memória por contêiner (US-122, spec D12): em falta de memória, o kernel mata primeiro o dev.
# sgo-prod* → -500 · sgo-hml* → -200 · easypanel* → -300 · sgo-a*/sgo-b* (dev) → 500 · demais: sem alteração.
# Uso: ajustar-oom.sh [--simular]
set -euo pipefail

DOCKER="${DOCKER:-docker}"
PROC="${PROC:-/proc}"
simular=0
[[ "${1:-}" == "--simular" ]] && simular=1

valor_para() {
  case "$1" in
    sgo-prod*) echo -500 ;;
    sgo-hml*) echo -200 ;;
    easypanel*) echo -300 ;;
    sgo-a*|sgo-b*) echo 500 ;;
    *) echo "" ;;
  esac
}

"$DOCKER" ps --format '{{.ID}} {{.Names}}' | while read -r id nome; do
  valor="$(valor_para "$nome")"
  [[ -z "$valor" ]] && continue
  "$DOCKER" top "$id" -eo pid 2>/dev/null | tail -n +2 | while read -r pid; do
    if (( simular )); then
      echo "$nome $pid $valor"
    else
      # O processo pode ter terminado entre o `docker top` e a escrita.
      echo "$valor" > "$PROC/$pid/oom_score_adj" 2>/dev/null || true
    fi
  done
done
