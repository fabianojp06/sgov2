#!/usr/bin/env bash
# Roda o paginas.js no k6 por imagem, com memória e CPU limitadas (plano do P7, Task 3, D-P7-1).
# Uso: veja ops/carga/README.md. Destinos aceitos:
#   - o app de dev da frente B: SGO_BASE=http://127.0.0.1:3200;
#   - hml, só na janela combinada com o PO: SGO_BASE=https://<host>, com SGO_HOST_HML=<host> (o mesmo
#     host, informado pelo PO) e SGO_JANELA_PO=sim. IP literal e localhost em https são recusados.
# Nunca contêiner, rede ou volume de sgo-prod/sgo-hml (D12): o k6 só fala com a URL pública.
set -euo pipefail

IMAGEM="grafana/k6:1.0.0@sha256:f21270290d702cbf0a7d6ba5d7ed100b63bcb233b558b885ed787547b3488279"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$DIR/../.." && pwd)"
# O navegador do login roda no contêiner oficial do Playwright (decisão do PO de 25/10): o host não
# tem as bibliotecas do Chromium. Mesma imagem e digest do e2e/global-setup.ts.
NAVEGADOR="mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f"
recusar() { echo "$1" >&2; exit 2; }

: "${SGO_BASE:?SGO_BASE obrigatória}"
if [[ "$SGO_BASE" != "http://127.0.0.1:3200" ]]; then
  [[ "$SGO_BASE" =~ ^https://([a-z0-9.-]+)$ ]] || recusar "SGO_BASE recusada: só http://127.0.0.1:3200 ou https://<host de hml>, sem caminho."
  host="${BASH_REMATCH[1]}"
  [[ "$host" =~ ^[0-9.]+$ || "$host" == localhost || "$host" == *.localhost ]] && recusar "SGO_BASE recusada: IP literal e localhost não valem em https."
  [[ "$host" == "${SGO_HOST_HML:-}" ]] || recusar "SGO_BASE recusada: o host precisa ser o de hml informado pelo PO (SGO_HOST_HML)."
  [[ "${SGO_JANELA_PO:-}" == sim ]] || recusar "Carga em hml só na janela combinada com o PO (SGO_JANELA_PO=sim, D-P7-1)."
fi

# Teto da D-P7-1: até 20 usuários virtuais e uma rodada que cabe na janela de 30 minutos.
export SGO_VUS="${SGO_VUS:-20}" SGO_DURACAO="${SGO_DURACAO:-2m}"
if ! [[ "$SGO_VUS" =~ ^[0-9]+$ ]] || (( SGO_VUS < 1 || SGO_VUS > 20 )); then
  recusar "SGO_VUS deve ser um inteiro de 1 a 20 (D-P7-1)."
fi
[[ "$SGO_DURACAO" =~ ^([0-9]+)(s|m)$ ]] || recusar "SGO_DURACAO deve ser como 90s ou 2m."
segundos="${BASH_REMATCH[1]}"
if [[ "${BASH_REMATCH[2]}" == m ]]; then segundos=$(( segundos * 60 )); fi
(( segundos >= 1 && segundos <= 1500 )) || recusar "SGO_DURACAO deve ficar entre 1 s e 25 min (janela de 30 min)."

# Um processo pesado por vez (D12): o mesmo lock do test:int e do test:e2e.
exec 9>"${SGO_LOCK:-/tmp/sgo-processo-pesado.lock}"
flock -w 1800 9 || { echo "Outro processo pesado em curso há 30 min; tente depois." >&2; exit 3; }

# Repositório só para leitura; o node_modules pelo caminho real (numa worktree, é um symlink). A senha
# vai por nome de variável (-e SGO_SENHA), nunca na linha de comando.
par="$(docker run --rm --network host --memory 1g --cpus 1 \
  -v "$RAIZ":/repo:ro -v "$(readlink -f "$RAIZ/node_modules")":/repo/node_modules:ro -w /repo \
  -e SGO_BASE -e SGO_LOGIN -e SGO_SENHA "$NAVEGADOR" node ops/carga/sessao.mjs)"
unset SGO_SENHA SGO_LOGIN
export SGO_COOKIE="${par%%=*}" SGO_SESSAO="${par#*=}"

docker run --rm -i --network host --memory 256m --cpus 1 \
  -e SGO_BASE -e SGO_SESSAO -e SGO_COOKIE -e SGO_PAGINAS -e SGO_VUS -e SGO_DURACAO \
  "$IMAGEM" run --quiet --include-system-env-vars - < "$DIR/paginas.js"
