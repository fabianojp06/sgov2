#!/usr/bin/env bash
# Alerta de unit do backup que falhou antes ou fora do script (US-015): EnvironmentFile ausente,
# docker.service fora, OOM, timeout. Chamado pelo OnFailure= das units sgo-backup-*@ com o nome da unit.
# Uso: alerta-falha.sh <unit>
set -uo pipefail
# shellcheck source=ops/backup/comum.sh
. "$(dirname "$(readlink -f "$0")")/comum.sh"
trap - ERR
alertar "SGO backup: a unit ${1:-desconhecida} falhou (journalctl -u ${1:-sgo-backup-*} para o motivo)"
