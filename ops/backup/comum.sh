#!/usr/bin/env bash
# Funções comuns do backup (US-015; plano do P3, Tarefa 7). Carregado pelos scripts de ops/backup.
# Roda no host da VPS, pelos timers do systemd (o host não é sessão de dev). Os comandos externos são
# injetáveis por variável (DOCKER, LOGGER, CURL, AGE, RCLONE), como no alerta de memória (US-122).

DOCKER="${DOCKER:-docker}"
LOGGER="${LOGGER:-logger}"
CURL="${CURL:-curl}"

# hml ou prod → nome do projeto no Easypanel. Outro valor: código 64 (uso).
projeto_do_ambiente() {
  case "${1:-}" in
    hml) echo sgo-hml ;;
    prod) echo sgo-prod ;;
    *) echo "ambiente inválido: '${1:-}' (use hml ou prod)" >&2; return 64 ;;
  esac
}

# Nome do contêiner do serviço db do projeto (Swarm: <projeto>_db.<n>.<id>), ou vazio.
conteiner_db() {
  "$DOCKER" ps --filter "name=^${1}_db\." --format '{{.Names}}' | head -n1
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
  alertar "SGO backup: $1"
  exit 1
}
