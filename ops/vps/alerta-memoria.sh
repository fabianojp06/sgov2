#!/usr/bin/env bash
# Alerta de memória disponível baixa na VPS (US-122, spec D12).
# Grava no journal e no contador semanal; envia webhook se ALERTA_WEBHOOK_URL estiver definido. Sempre sai com 0.
set -euo pipefail

MEMINFO="${MEMINFO:-/proc/meminfo}"
LIMITE_MB="${LIMITE_MB:-1024}"
LOG_ALERTAS="${LOG_ALERTAS:-/var/lib/sgo/alertas-memoria.log}"
LOGGER="${LOGGER:-logger}"
CURL="${CURL:-curl}"

disp_kb="$(awk '/^MemAvailable:/ {print $2}' "$MEMINFO")"
disp_mb=$(( disp_kb / 1024 ))

if (( disp_mb < LIMITE_MB )); then
  msg="SGO: memória disponível baixa na VPS (${disp_mb} MB < ${LIMITE_MB} MB)"
  mkdir -p "$(dirname "$LOG_ALERTAS")"
  printf '%s %s MemAvailable=%s\n' "$(date +%G-W%V)" "$(date -Is)" "$disp_mb" >> "$LOG_ALERTAS"
  "$LOGGER" -t sgo-alerta "$msg" || true
  if [[ -n "${ALERTA_WEBHOOK_URL:-}" ]]; then
    "$CURL" -fsS -m 10 -d "$msg" "$ALERTA_WEBHOOK_URL" >/dev/null 2>&1 \
      || "$LOGGER" -t sgo-alerta "falha ao enviar o alerta para o webhook" || true
  fi
fi
exit 0
