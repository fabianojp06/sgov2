#!/usr/bin/env bash
# Prioridade de memória por contêiner (US-122, spec D12): em falta de memória, o kernel mata primeiro o dev.
# Só ajusta /proc/<pid>/oom_score_adj; não toca contêiner, rede nem volume.
#   sgo-prod_* / sgo-prod-*  → -500   (produção)
#   easypanel.* / easypanel-* → -300  (painel e Traefik, que atende o tráfego de produção)
#   sgo-hml_* / sgo-hml-*    → -200   (homologação)
#   sgo-a-* / sgo-b-*        →  500   (dev das frentes A e B, COMPOSE_PROJECT_NAME da spec §12.4)
#   demais                   → sem alteração
# Uso: ajustar-oom.sh [--simular]
set -euo pipefail

DOCKER="${DOCKER:-docker}"
PROC="${PROC:-/proc}"
simular=0
[[ "${1:-}" == "--simular" ]] && simular=1

valor_para() {
  case "$1" in
    sgo-prod_*|sgo-prod-*) echo -500 ;;
    easypanel.*|easypanel-*) echo -300 ;;
    sgo-hml_*|sgo-hml-*) echo -200 ;;
    sgo-a-*|sgo-b-*) echo 500 ;;
    *) echo "" ;;
  esac
}

lista="$("$DOCKER" ps --format '{{.ID}} {{.Names}}' 2>/dev/null)" || exit 0
while read -r id nome; do
  [[ -z "${id:-}" ]] && continue
  valor="$(valor_para "$nome")"
  [[ -z "$valor" ]] && continue
  # O contêiner pode ter saído entre o `docker ps` e o `docker top`: segue para o próximo.
  pids="$("$DOCKER" top "$id" -eo pid 2>/dev/null)" || continue
  while read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    if (( simular )); then
      echo "$nome $pid $valor"
    else
      # O processo pode ter terminado entre o `docker top` e a escrita.
      echo "$valor" > "$PROC/$pid/oom_score_adj" 2>/dev/null || true
    fi
  done < <(tail -n +2 <<<"$pids")
done <<<"$lista"
exit 0
