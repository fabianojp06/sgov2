#!/usr/bin/env bats
# Testes do alerta de memória (US-122, spec D12)

setup() {
  T="$(mktemp -d)"
  export LOG_ALERTAS="$T/alertas.log" LOGGER="$T/logger" CURL="$T/curl" LIMITE_MB=1024
  printf '#!/bin/sh\necho "$@" >> %s/logger.out\n' "$T" > "$LOGGER"
  printf '#!/bin/sh\necho "$@" >> %s/curl.out\n' "$T" > "$CURL"
  chmod +x "$LOGGER" "$CURL"
  SCRIPT="$BATS_TEST_DIRNAME/../alerta-memoria.sh"
}
teardown() { rm -rf "$T"; }

meminfo() { printf 'MemTotal: 8130000 kB\nMemAvailable: %s kB\n' "$1" > "$T/meminfo"; export MEMINFO="$T/meminfo"; }

@test "abaixo do limite grava no log semanal e no journal" {
  meminfo 900000
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$LOG_ALERTAS")" -eq 1 ]
  grep -qE '^[0-9]{4}-W[0-9]{2} .* MemAvailable=878$' "$LOG_ALERTAS"
  grep -q 'sgo-alerta' "$T/logger.out"
}

@test "acima do limite não alerta" {
  meminfo 2000000
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ ! -s "$LOG_ALERTAS" ]
}

@test "sem webhook não tenta POST" {
  meminfo 900000
  unset ALERTA_WEBHOOK_URL
  run "$SCRIPT"
  [ ! -e "$T/curl.out" ]
}

@test "com webhook faz POST com a mensagem" {
  meminfo 900000
  ALERTA_WEBHOOK_URL="https://exemplo.invalid/t" run "$SCRIPT"
  [ "$status" -eq 0 ]
  grep -q 'exemplo.invalid' "$T/curl.out"
}

@test "falha do webhook não derruba o script" {
  meminfo 900000
  printf '#!/bin/sh\nexit 7\n' > "$CURL"
  ALERTA_WEBHOOK_URL="https://exemplo.invalid/t" run "$SCRIPT"
  [ "$status" -eq 0 ]
}
