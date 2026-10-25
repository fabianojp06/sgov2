#!/usr/bin/env bats
# Testes do entrypoint da imagem (US-013 parte 2/3, plano do P3, Tarefa 4).
# prisma e node são simulados por scripts falsos no PATH, que registram a chamada.

bats_require_minimum_version 1.5.0

setup() {
  T="$(mktemp -d)"
  mkdir -p "$T/bin" "$T/migrador/node_modules/.bin"
  cat > "$T/migrador/node_modules/.bin/prisma" <<'SH'
#!/bin/sh
echo "prisma $*" >> "$REGISTRO"
exit "${PRISMA_SAIDA:-0}"
SH
  cat > "$T/bin/node" <<'SH'
#!/bin/sh
echo "node $*" >> "$REGISTRO"
echo "node-env MIGRATE_DATABASE_URL=${MIGRATE_DATABASE_URL:-<ausente>}" >> "$REGISTRO"
exit 0
SH
  mkdir -p "$T/migrador/prisma/migrations/202610260000_nucleo_x"
  chmod +x "$T/migrador/node_modules/.bin/prisma" "$T/bin/node"
  export REGISTRO="$T/registro" PATH="$T/bin:$PATH" MIGRADOR_DIR="$T/migrador" APP_DIR="$T"
  export MIGRATE_DATABASE_URL="postgresql://sgo_migrator:x@db:5432/sgo"
  touch "$REGISTRO"
  SCRIPT="$BATS_TEST_DIRNAME/../entrypoint.sh"
}
teardown() { rm -rf "$T"; }

@test "app: migração com falha → sai com erro e nunca sobe o servidor" {
  PRISMA_SAIDA=1 run "$SCRIPT" app
  [ "$status" -ne 0 ]
  grep -q '^prisma migrate deploy$' "$REGISTRO"
  ! grep -q '^node' "$REGISTRO"
}

@test "app: migração ok → sobe node server.js uma vez" {
  run "$SCRIPT" app
  [ "$status" -eq 0 ]
  [ "$(grep -c '^prisma migrate deploy$' "$REGISTRO")" -eq 1 ]
  [ "$(grep -c '^node server.js$' "$REGISTRO")" -eq 1 ]
}

@test "migrar: sai com o código do prisma" {
  PRISMA_SAIDA=3 run "$SCRIPT" migrar
  [ "$status" -eq 3 ]
  ! grep -q '^node' "$REGISTRO"
}

@test "resolver <migration> → migrate resolve --rolled-back" {
  run "$SCRIPT" resolver 202611010000_cad_x
  [ "$status" -eq 0 ]
  grep -q '^prisma migrate resolve --rolled-back 202611010000_cad_x$' "$REGISTRO"
}

@test "resolver sem nome → código 64, sem chamar o prisma" {
  run "$SCRIPT" resolver
  [ "$status" -eq 64 ]
  [ ! -s "$REGISTRO" ]
}

@test "subcomando desconhecido → código 64 e uso" {
  run "$SCRIPT" qualquer
  [ "$status" -eq 64 ]
  [[ "$output" == *"Uso:"* ]]
}

@test "sem subcomando → código 64" {
  run "$SCRIPT"
  [ "$status" -eq 64 ]
}

@test "app sem MIGRATE_DATABASE_URL → erro, sem chamar o prisma nem o node" {
  MIGRATE_DATABASE_URL="" run "$SCRIPT" app
  [ "$status" -ne 0 ]
  [ ! -s "$REGISTRO" ]
  [[ "$output" == *"MIGRATE_DATABASE_URL"* ]]
}

@test "nunca imprime a URL do banco (senha)" {
  PRISMA_SAIDA=1 run --separate-stderr "$SCRIPT" app
  [[ "$output$stderr" != *"sgo_migrator:x@"* ]]
}

@test "worker: ainda não disponível nesta versão da imagem → código 64" {
  run "$SCRIPT" worker
  [ "$status" -eq 64 ]
  [[ "$output" == *"worker"* ]]
}

@test "app: o servidor sobe sem a credencial do migrador no ambiente" {
  run "$SCRIPT" app
  [ "$status" -eq 0 ]
  grep -q '^node-env MIGRATE_DATABASE_URL=<ausente>$' "$REGISTRO"
}

@test "migrar sem nenhuma migration na imagem → erro, sem chamar o prisma" {
  rm -rf "$T/migrador/prisma/migrations"/*
  run "$SCRIPT" migrar
  [ "$status" -ne 0 ]
  [[ "$output" == *"nenhuma migration"* ]]
  [ ! -s "$REGISTRO" ]
}
