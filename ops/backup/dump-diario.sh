#!/usr/bin/env bash
# Dump lógico diário (US-015; plano do P3, Tarefa 7), às 02:30 (timer sgo-backup-dump@).
# pg_dump -Fc como postgres pelo socket local do contêiner db → cifrado no host com o age (a chave
# privada fica fora da VPS, com o PO) → enviado pelo rclone a <DESTINO_DUMP>/<ambiente>/AAAA-MM-DD.dump.age.
# O dump em claro nunca toca o disco: vai do pg_dump direto para o age. A retenção de 90 dias é a
# regra de lifecycle do bucket, não deste script.
# Variáveis (/etc/sgo/backup-dump-<ambiente>.env): AGE_DESTINATARIO (chave pública), DESTINO_DUMP (sgo:<balde>/dumps)
# e o remoto "sgo" do rclone com a chave só de escrita em dumps/ (RCLONE_CONFIG_SGO_TYPE=s3,
# RCLONE_CONFIG_SGO_PROVIDER, RCLONE_CONFIG_SGO_ENDPOINT, RCLONE_CONFIG_SGO_ACCESS_KEY_ID e
# RCLONE_CONFIG_SGO_SECRET_ACCESS_KEY).
# Uso: dump-diario.sh <hml|prod>
set -euo pipefail
# shellcheck source=ops/backup/comum.sh
. "$(dirname "$(readlink -f "$0")")/comum.sh"

AGE="${AGE:-age}"
RCLONE="${RCLONE:-rclone}"

ambiente="${1:-}"
projeto="$(projeto_do_ambiente "$ambiente")" || { trap - ERR; exit 64; }
[ -n "${AGE_DESTINATARIO:-}" ] || falhar "$ambiente: AGE_DESTINATARIO não definido; dump não feito"
[ -n "${DESTINO_DUMP:-}" ] || falhar "$ambiente: DESTINO_DUMP não definido; dump não feito"

travar "$ambiente"
c="$(conteiner_db "$projeto")" || falhar "$ambiente: o docker não respondeu; dump não feito"
[ -n "$c" ] || falhar "$ambiente: contêiner do db não encontrado ($projeto); dump não feito"

tmp="$(mktemp -d)" || falhar "$ambiente: mktemp falhou (disco cheio?); dump não feito"
trap 'rm -rf "$tmp"' EXIT
arquivo="$tmp/$(date +%F).dump.age"

# pipefail: a falha do pg_dump ou do age reprova o pipeline; o arquivo parcial não é enviado.
if ! "$DOCKER" exec -u postgres "$c" pg_dump -Fc -d sgo | "$AGE" -r "$AGE_DESTINATARIO" -o "$arquivo"; then
  falhar "$ambiente: pg_dump ou age falhou; nada foi enviado"
fi
# O age falso dos testes (e um age que saia 0 sem escrever) não pode passar por dump válido.
[ -s "$arquivo" ] || falhar "$ambiente: dump cifrado vazio; nada foi enviado"

# A chave só grava em dumps/: sem listar nem conferir o destino antes (--no-check-dest, --s3-no-check-bucket).
"$RCLONE" copyto "$arquivo" "${DESTINO_DUMP%/}/$ambiente/$(basename "$arquivo")" \
  --no-check-dest --s3-no-check-bucket --retries 3 \
  || falhar "$ambiente: envio do dump ao storage falhou"
"$LOGGER" -t sgo-backup "$ambiente: dump diário enviado ($(basename "$arquivo"))" 2>/dev/null || true
