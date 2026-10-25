#!/usr/bin/env bash
# Frente do PR a partir das labels (US-013, spec §12.8): exatamente uma entre frente:A e frente:B.
# Uso: frente-do-pr.sh "<labels separadas por vírgula>"  → imprime A ou B
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo 'Uso: frente-do-pr.sh "<labels separadas por vírgula>"' >&2
  exit 64
fi

frentes=()
IFS=',' read -r -a labels <<< "$1"
for label in "${labels[@]}"; do
  label="${label#"${label%%[![:space:]]*}"}"
  label="${label%"${label##*[![:space:]]}"}"
  case "$label" in
    frente:A) frentes+=(A) ;;
    frente:B) frentes+=(B) ;;
  esac
done

if [[ ${#frentes[@]} -eq 0 ]]; then
  echo 'O PR precisa da label frente:A ou frente:B (spec §12.5).' >&2
  exit 1
fi
if [[ ${#frentes[@]} -gt 1 ]]; then
  echo 'O PR tem as duas labels de frente; use só uma (spec §12.5).' >&2
  exit 1
fi
echo "${frentes[0]}"
