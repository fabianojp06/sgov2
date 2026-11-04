#!/usr/bin/env bats
# Testes do alerta de memória (US-122, spec D12)

setup() {
  T="$(mktemp -d)"
  export LOG_ALERTAS="$T/alertas.log" ESTADO_ALERTA="$T/estado" LOGGER="$T/logger" CURL="$T/curl" LIMITE_MB=1024
  printf '#!/bin/sh\necho "$@" >> %s/logger.out\n' "$T" > "$LOGGER"
  printf '#!/bin/sh\necho "$@" >> %s/curl.out\ncat >> %s/curl.in\n' "$T" "$T" > "$CURL"
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
  [ ! -e "$T/logger.out" ]
}

@test "sem webhook não tenta POST" {
  meminfo 900000
  unset ALERTA_WEBHOOK_URL
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ ! -e "$T/curl.out" ]
}

@test "com webhook faz POST com a mensagem" {
  meminfo 900000
  ALERTA_WEBHOOK_URL="https://exemplo.invalid/t?token=segredo" run "$SCRIPT"
  [ "$status" -eq 0 ]
  grep -q 'memória disponível baixa' "$T/curl.out"
  # A URL vai pelo stdin (-K -), nunca nos argumentos, que o ps mostra.
  grep -qx 'url = "https://exemplo.invalid/t?token=segredo"' "$T/curl.in"
  run ! grep -q 'segredo' "$T/curl.out"
}

@test "URL com caractere de controle: não chama o curl e avisa no journal" {
  meminfo 900000
  ALERTA_WEBHOOK_URL=$'https://exemplo.invalid/a\nb' run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ ! -e "$T/curl.out" ]
  grep -q 'ALERTA_WEBHOOK_URL inválida' "$T/logger.out"
}

@test "aspas e barra invertida na URL são escapadas no config do curl" {
  meminfo 900000
  ALERTA_WEBHOOK_URL='https://exemplo.invalid/a"b\c' run "$SCRIPT"
  [ "$status" -eq 0 ]
  grep -qxF 'url = "https://exemplo.invalid/a\"b\\c"' "$T/curl.in"
}

@test "falha do webhook não derruba o script" {
  meminfo 900000
  printf '#!/bin/sh\nexit 7\n' > "$CURL"
  ALERTA_WEBHOOK_URL="https://exemplo.invalid/t" run "$SCRIPT"
  [ "$status" -eq 0 ]
}

@test "um episódio longo conta uma vez só (contador de episódios, não de minutos)" {
  meminfo 900000
  run "$SCRIPT"; [ "$status" -eq 0 ]
  run "$SCRIPT"; [ "$status" -eq 0 ]
  run "$SCRIPT"; [ "$status" -eq 0 ]
  [ "$(wc -l < "$LOG_ALERTAS")" -eq 1 ]
}

@test "novo episódio só depois de voltar acima da histerese (120% do limite)" {
  meminfo 900000; run "$SCRIPT"
  meminfo 1100000; run "$SCRIPT"   # 1074 MB: acima do limite, abaixo da histerese (1228 MB)
  meminfo 900000; run "$SCRIPT"
  [ "$(wc -l < "$LOG_ALERTAS")" -eq 1 ]
  meminfo 1300000; run "$SCRIPT"   # 1269 MB: normalizou
  meminfo 900000; run "$SCRIPT"
  [ "$(wc -l < "$LOG_ALERTAS")" -eq 2 ]
}

@test "meminfo sem MemAvailable não gera alerta falso e sai com 0" {
  printf 'MemTotal: 8130000 kB\n' > "$T/meminfo"; export MEMINFO="$T/meminfo"
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ ! -s "$LOG_ALERTAS" ]
}

@test "meminfo inexistente sai com 0" {
  export MEMINFO="$T/nao-existe"
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ ! -s "$LOG_ALERTAS" ]
}

@test "fronteiras: exatamente no limite não alerta; volta ao normal exatamente em 120%" {
  meminfo 1048576; run "$SCRIPT"; [ "$status" -eq 0 ]; [ ! -s "$LOG_ALERTAS" ]
  meminfo 900000; run "$SCRIPT"
  meminfo 1257472; run "$SCRIPT"; [ "$(cat "$ESTADO_ALERTA")" = "normal" ]   # 1228 MB
}

@test "estado sem permissão de escrita: sai com 0 e não conta o episódio" {
  meminfo 900000
  # Um diretório no lugar do arquivo de estado: a escrita falha até para root (o chmod não bastaria).
  mkdir -p "$T/estado.d"; export ESTADO_ALERTA="$T/estado.d"
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ ! -s "$LOG_ALERTAS" ]
}
