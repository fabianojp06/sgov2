#!/usr/bin/env bash
# Healthcheck da imagem (HEALTHCHECK do app.Dockerfile).
# - app: GET /login responde 200;
# - worker (processo do /app/worker/index.mjs): o sinal de vida que ele grava a cada tique, depois
#   do primeiro ciclo do outbox com sucesso, tem menos de 60 s. Ele para de gravar com o outbox
#   falhando ou com um ciclo em curso há mais de 60 s, e sai com um ciclo preso há mais de 5 min
#   (worker/index.ts). Conexão do pg-boss quebrada com o outbox vazio não aparece aqui: o outbox
#   só chama o pg-boss quando há mensagem.
set -euo pipefail

VIVO=/tmp/sgo-worker-vivo
LIMITE_S=60

for p in /proc/[0-9]*; do
  if tr '\0' '\n' < "$p/cmdline" 2>/dev/null | grep -qx '/app/worker/index.mjs'; then
    [[ -f "$VIVO" ]] || exit 1
    idade=$(( $(date +%s) - $(stat -c %Y "$VIVO") ))
    # Idade negativa (relógio voltou) também reprova.
    (( idade >= 0 && idade < LIMITE_S ))
    exit
  fi
done
exec node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/login').then((r) => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"
