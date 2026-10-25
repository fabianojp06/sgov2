#!/usr/bin/env bash
# Vínculo do PR com uma issue (US-013, spec §12.8): o corpo, lido no stdin, precisa de
# Closes/Fixes/Resolves #n (com ou sem dois-pontos), ou de Refs #n em PR parcial ou de contrato (decisão do PO, plano do P3).
set -euo pipefail

# Lê o corpo inteiro antes de procurar: grep -q pararia no primeiro acerto, e o printf do
# workflow levaria SIGPIPE, reprovando com pipefail um PR válido.
corpo="$(cat)"
# Comentários HTML (<!-- ... -->, inclusive de várias linhas) não contam como vínculo.
corpo="$(perl -0pe 's/<!--.*?-->//gs' <<< "$corpo")"
if grep -Eiq '(^|[^[:alnum:]_])(closes|fixes|resolves|refs):?[[:space:]]+#[0-9]+' <<< "$corpo"; then
  exit 0
fi
echo 'O corpo do PR precisa de "Closes #n" (ou "Refs #n" em PR parcial ou de contrato), spec §12.8.' >&2
exit 1
