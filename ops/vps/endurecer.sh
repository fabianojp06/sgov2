#!/usr/bin/env bash
# Endurecimento do host (US-016). Idempotente. Rodar como root.
# NÃO aplica sshd-90-sgo.conf (SSH só por chave) nem a regra da porta 3000: os dois dependem do PO (docs/operacao/vps.md).
# Desfazer: ver docs/operacao/vps.md, seção "Como desfazer".
set -euo pipefail
cd "$(dirname "$0")"

export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq ufw fail2ban unattended-upgrades >/dev/null

# A porta 22 é liberada antes de ligar o firewall, para não derrubar a sessão SSH.
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null

install -m 0644 jail-sgo.local /etc/fail2ban/jail.d/sgo.local
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban

install -m 0644 52-sgo-unattended.conf /etc/apt/apt.conf.d/52-sgo-unattended
echo "Endurecimento aplicado (ufw, fail2ban, atualizações de segurança)."
