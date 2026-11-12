#!/usr/bin/env bash
# URLs de banco versionadas (plano do P3, Tarefa 6, Step 3; US-014 "variáveis de prod só no
# Easypanel"): toda URL postgres(ql):// do repositório, fora de testes e da documentação, aponta
# para o banco de dev (127.0.0.1 ou localhost nas portas 55432/56432) ou para o serviço db do
# compose de dev (db:5432). Uma URL de hml ou de prod no código ou na configuração reprova.
# Os testes e os planos citam URLs de prod de propósito (são os casos das travas): ficam de fora.
# Roda na raiz de um repositório git; o primeiro argumento, opcional, é o diretório.
set -euo pipefail

cd "${1:-.}"

permitido='^(127\.0\.0\.1|localhost):(55432|56432)$|^db:5432$'
achados=0
while IFS= read -r linha; do
  arquivo=${linha%%:*}
  resto=${linha#*:}
  numero=${resto%%:*}
  url=${resto#*:}
  # host:porta: tira o esquema e o usuário:senha@, e para no /, ? ou fim.
  hostporta=$(sed -E 's#^postgres(ql)?://##; s#^[^@/]*@##; s#[/?].*$##' <<< "$url")
  if ! grep -Eq "$permitido" <<< "$hostporta"; then
    echo "${arquivo}:${numero}: URL de banco fora do dev local (${hostporta})" >&2
    achados=$((achados + 1))
  fi
done < <(git grep -n -o -I -E "postgres(ql)?://[^[:space:]'\"\`)<>]+" -- \
  ':!*.md' ':!*.test.*' ':!*.bats' ':!**/testes/**' ':!tests/**' ':!e2e/**' || true)

if [ "$achados" -gt 0 ]; then
  echo "${achados} URL(s) de banco versionada(s) fora do dev local. Credencial de hml e prod fica só no Easypanel." >&2
  exit 1
fi
echo "URLs de banco versionadas: só dev local."
