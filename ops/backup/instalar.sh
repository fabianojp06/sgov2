#!/usr/bin/env bash
# Instala o backup no host (US-015; plano do P3, Tarefa 7). Idempotente. Rodar como root a partir da
# raiz do repositório, com os ambientes cujo backup já está configurado no Easypanel:
#   sudo bash ops/backup/instalar.sh hml        (depois, quando o prod estiver pronto: ... prod)
# Liga os timers do ambiente só se os arquivos de segredos dele existirem (docs/operacao/backup.md).
# Desfazer: systemctl disable --now sgo-backup-full@<amb>.timer sgo-backup-diff@<amb>.timer \
#   sgo-backup-dump@<amb>.timer sgo-backup-restauracao@<amb>.timer
set -euo pipefail
cd "$(dirname "$0")"
[ $# -gt 0 ] || { echo "uso: $0 <hml|prod> [...]" >&2; exit 64; }
export DEBIAN_FRONTEND=noninteractive

# age (cifra do dump) e o cliente S3 (envio do dump).
if ! command -v age > /dev/null || ! command -v rclone > /dev/null; then
  apt-get update -qq
  apt-get install -y -qq age rclone > /dev/null
fi

install -d -m 0755 /usr/local/lib/sgo-backup /var/lib/sgo /etc/sgo
install -m 0644 comum.sh /usr/local/lib/sgo-backup/comum.sh
install -m 0755 backup-pgbackrest.sh /usr/local/lib/sgo-backup/backup-pgbackrest.sh
install -m 0755 dump-diario.sh /usr/local/lib/sgo-backup/dump-diario.sh
install -m 0755 testar-restauracao.sh /usr/local/lib/sgo-backup/testar-restauracao.sh
install -m 0755 alerta-falha.sh /usr/local/lib/sgo-backup/alerta-falha.sh
# Os scripts acham o comum.sh pelo caminho real (readlink -f), então o link em /usr/local/sbin serve.
ln -sfn /usr/local/lib/sgo-backup/backup-pgbackrest.sh /usr/local/sbin/sgo-backup-pgbackrest
ln -sfn /usr/local/lib/sgo-backup/dump-diario.sh /usr/local/sbin/sgo-backup-dump
ln -sfn /usr/local/lib/sgo-backup/testar-restauracao.sh /usr/local/sbin/sgo-backup-restauracao
ln -sfn /usr/local/lib/sgo-backup/alerta-falha.sh /usr/local/sbin/sgo-backup-alerta-falha

for u in sgo-backup-*@.service sgo-backup-*@.timer; do
  install -m 0644 "$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload

if ! grep -qs '^ALERTA_WEBHOOK_URL=..*' /etc/sgo/alerta.env; then
  echo "AVISO: sem ALERTA_WEBHOOK_URL em /etc/sgo/alerta.env, as falhas do backup ficam só no journal." >&2
fi

for amb in "$@"; do
  case "$amb" in hml | prod) ;; *) echo "ambiente inválido: $amb" >&2; exit 64 ;; esac
  faltam=()
  for f in "/etc/sgo/backup-dump-$amb.env" "/etc/sgo/backup-leitura-$amb.env"; do
    if [ -f "$f" ]; then chown root:root "$f" && chmod 0600 "$f"; else faltam+=("$f"); fi
  done
  if [ ${#faltam[@]} -gt 0 ]; then
    echo "$amb: faltam ${faltam[*]}; timers não ligados (docs/operacao/backup.md)." >&2
    continue
  fi
  systemctl enable --now "sgo-backup-full@$amb.timer" "sgo-backup-diff@$amb.timer" \
    "sgo-backup-dump@$amb.timer" "sgo-backup-restauracao@$amb.timer"
  echo "$amb: timers do backup ligados."
done
systemctl list-timers 'sgo-backup-*' --no-pager
