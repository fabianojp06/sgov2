#!/usr/bin/env bash
# Instala as mitigações de D12 no host (US-122). Idempotente. Rodar como root a partir da raiz do repositório.
# Desfazer: ver docs/operacao/vps.md, seção "Como desfazer".
set -euo pipefail
cd "$(dirname "$0")"

install -m 0755 ajustar-oom.sh /usr/local/sbin/sgo-ajustar-oom
install -m 0755 alerta-memoria.sh /usr/local/sbin/sgo-alerta-memoria
install -m 0644 90-sgo.sysctl.conf /etc/sysctl.d/90-sgo.conf
sysctl --system >/dev/null

install -d -m 0755 /var/lib/sgo /etc/sgo
[[ -f /etc/sgo/alerta.env ]] || printf 'ALERTA_WEBHOOK_URL=\nLIMITE_MB=1024\n' > /etc/sgo/alerta.env
chmod 0600 /etc/sgo/alerta.env

for u in sgo-oom.service sgo-oom.timer sgo-alerta-memoria.service sgo-alerta-memoria.timer; do
  install -m 0644 "$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable --now sgo-oom.timer sgo-alerta-memoria.timer

if command -v earlyoom >/dev/null; then
  install -m 0644 earlyoom.default /etc/default/earlyoom
  systemctl enable earlyoom >/dev/null 2>&1
  systemctl restart earlyoom
fi
echo "Mitigações de D12 instaladas."
