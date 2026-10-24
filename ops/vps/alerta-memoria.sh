#!/usr/bin/env bash
# Alerta de memória disponível baixa na VPS (US-122, spec D12). Sempre sai com 0.
# Conta EPISÓDIOS, não minutos: grava e notifica só na transição normal → baixo. Volta ao normal
# quando a memória disponível passa de 120% do limite (histerese), para um pico oscilante contar uma vez.
# O log semanal é o contador do gatilho de revisão de D12 (mais de 3 episódios por semana).
set -euo pipefail

MEMINFO="${MEMINFO:-/proc/meminfo}"
LIMITE_MB="${LIMITE_MB:-1024}"
LOG_ALERTAS="${LOG_ALERTAS:-/var/lib/sgo/alertas-memoria.log}"
ESTADO_ALERTA="${ESTADO_ALERTA:-/var/lib/sgo/alerta-memoria.estado}"
LOGGER="${LOGGER:-logger}"
CURL="${CURL:-curl}"

disp_kb="$(awk '/^MemAvailable:/ {print $2}' "$MEMINFO" 2>/dev/null || true)"
if [[ ! "$disp_kb" =~ ^[0-9]+$ ]]; then
  "$LOGGER" -t sgo-alerta "MemAvailable ilegível em $MEMINFO; nenhum alerta gravado" 2>/dev/null || true
  exit 0
fi
disp_mb=$(( disp_kb / 1024 ))
retorno_mb=$(( LIMITE_MB * 120 / 100 ))
estado="$(cat "$ESTADO_ALERTA" 2>/dev/null || echo normal)"

if (( disp_mb < LIMITE_MB )); then
  if [[ "$estado" != "baixo" ]]; then
    msg="SGO: memória disponível baixa na VPS (${disp_mb} MB < ${LIMITE_MB} MB)"
    mkdir -p "$(dirname "$LOG_ALERTAS")" "$(dirname "$ESTADO_ALERTA")" 2>/dev/null || true
    # Estado antes do log: se o estado não puder ser gravado, não grava o episódio (evita recontar a cada minuto).
    if echo baixo > "$ESTADO_ALERTA" 2>/dev/null; then
      printf '%s %s MemAvailable=%s\n' "$(date +%G-W%V)" "$(date -Is)" "$disp_mb" >> "$LOG_ALERTAS" 2>/dev/null || true
    else
      "$LOGGER" -t sgo-alerta "não foi possível gravar $ESTADO_ALERTA; episódio não contado" || true
    fi
    "$LOGGER" -t sgo-alerta "$msg" || true
    if [[ -n "${ALERTA_WEBHOOK_URL:-}" ]]; then
      "$CURL" -fsS -m 10 -d "$msg" "$ALERTA_WEBHOOK_URL" >/dev/null 2>&1 \
        || "$LOGGER" -t sgo-alerta "falha ao enviar o alerta para o webhook" || true
    fi
  fi
elif (( disp_mb >= retorno_mb )) && [[ "$estado" == "baixo" ]]; then
  echo normal > "$ESTADO_ALERTA" 2>/dev/null || true
  "$LOGGER" -t sgo-alerta "SGO: memória disponível normalizada (${disp_mb} MB)" || true
fi
exit 0
