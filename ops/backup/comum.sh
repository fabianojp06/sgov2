#!/usr/bin/env bash
# Funções comuns do backup (US-015; plano do P3, Tarefa 7). Carregado pelos scripts de ops/backup.
# Roda no host da VPS, pelos timers do systemd (o host não é sessão de dev). Os comandos externos são
# injetáveis por variável (DOCKER, LOGGER, CURL, AGE, RCLONE, FLOCK), como no alerta de memória (US-122).

DOCKER="${DOCKER:-docker}"
LOGGER="${LOGGER:-logger}"
CURL="${CURL:-curl}"
FLOCK="${FLOCK:-flock}"
DIR_TRAVAS="${DIR_TRAVAS:-/run/lock}"

# hml ou prod → nome do projeto no Easypanel. Outro valor: código 64 (uso).
projeto_do_ambiente() {
  case "${1:-}" in
    hml) echo sgo-hml ;;
    prod) echo sgo-prod ;;
    *) echo "ambiente inválido: '${1:-}' (use hml ou prod)" >&2; return 64 ;;
  esac
}

# Nome do contêiner do serviço db do projeto (Swarm: <projeto>_db.<n>.<id>), ou vazio. Falha se o
# docker falhar (daemon fora): quem chama trata com "|| falhar".
conteiner_db() {
  local nomes
  nomes="$("$DOCKER" ps --filter "name=^${1}_db\." --format '{{.Names}}')" || return 1
  printf '%s\n' "$nomes" | head -n1
}

# Journal e webhook do alerta (o mesmo ALERTA_WEBHOOK_URL do P2). Nunca falha.
alertar() {
  local msg="$1"
  "$LOGGER" -t sgo-backup "$msg" 2>/dev/null || true
  if [[ "${ALERTA_WEBHOOK_URL:-}" == *[[:cntrl:]]* ]]; then
    # Uma quebra de linha deixaria o config do curl sem fechar a aspa.
    "$LOGGER" -t sgo-backup "ALERTA_WEBHOOK_URL inválida (caractere de controle); alerta não enviado" 2>/dev/null || true
  elif [[ -n "${ALERTA_WEBHOOK_URL:-}" ]]; then
    # A URL (que costuma levar o token) vai pelo stdin (-K -), nunca na linha de comando.
    local url="${ALERTA_WEBHOOK_URL//\\/\\\\}"
    url="${url//\"/\\\"}"
    printf 'url = "%s"\n' "$url" | "$CURL" -fsS -m 10 -d "$msg" -K - >/dev/null 2>&1 \
      || "$LOGGER" -t sgo-backup "falha ao enviar o alerta para o webhook" 2>/dev/null || true
  fi
}

# Alerta e sai com código 1.
falhar() {
  trap - ERR
  alertar "SGO backup: $1"
  exit 1
}

# Qualquer comando que falhe fora de um "|| falhar" também alerta (set -e sairia em silêncio). O que
# acontece antes do script (unit sem EnvironmentFile, docker.service fora, OOM) é coberto pelo
# OnFailure= das units (sgo-backup-alerta@).
set -E
trap 'falhar "erro inesperado em $(basename "$0"), linha $LINENO (código $?)"' ERR

# Uma operação por ambiente de cada vez (full × diff que disparam juntos no boot, manual × timer).
travar() {
  exec 9> "$DIR_TRAVAS/sgo-backup-$1.lock" || falhar "$1: não consegui abrir a trava em $DIR_TRAVAS"
  "$FLOCK" -w "${ESPERA_TRAVA:-3600}" 9 || falhar "$1: outra operação de backup do ambiente segue em andamento"
}
