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
[ -z "${ADMIN_INICIAL_SENHA:-}" ] || echo "prisma-com-senha" >> "$REGISTRO"
exit "${PRISMA_SAIDA:-0}"
SH
  cat > "$T/bin/node" <<'SH'
#!/bin/sh
echo "node $*" >> "$REGISTRO"
echo "node-env MIGRATE_DATABASE_URL=${MIGRATE_DATABASE_URL:-<ausente>}" >> "$REGISTRO"
exit "${NODE_SAIDA:-0}"
SH
  # O sleep do implantar roda com env -i: o caminho do registro vai fixo no script.
  cat > "$T/bin/sleep" <<SH
#!/bin/sh
echo "sleep \$* senha=\${ADMIN_INICIAL_SENHA:-<ausente>} migrate=\${MIGRATE_DATABASE_URL:-<ausente>}" >> "$T/registro"
exit 0
SH
  mkdir -p "$T/migrador/prisma/migrations/202610260000_nucleo_x"
  chmod +x "$T/migrador/node_modules/.bin/prisma" "$T/bin/node" "$T/bin/sleep"
  export REGISTRO="$T/registro" PATH="$T/bin:$PATH" MIGRADOR_DIR="$T/migrador" APP_DIR="$T" IMPLANTAR_MARCADOR="$T/implantar"
  export MIGRATE_DATABASE_URL="postgresql://sgo_migrator:x@db:5432/sgo"
  # Por padrão, sem troca de usuário (o teste roda como root na VPS e sem root no CI).
  export APP_USUARIO=""
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

@test "semear: roda a seed com a MIGRATE_DATABASE_URL e o código dela, sem migrar" {
  NODE_SAIDA=5 run "$SCRIPT" semear
  [ "$status" -eq 5 ]
  grep -q "^node --enable-source-maps $T/seed/seed.mjs$" "$REGISTRO"
  grep -q '^node-env MIGRATE_DATABASE_URL=postgresql://sgo_migrator' "$REGISTRO"
  ! grep -q '^prisma' "$REGISTRO"
  [ ! -e "$T/implantar" ]
}

@test "semear sem MIGRATE_DATABASE_URL → sai com erro, sem chamar a seed" {
  unset MIGRATE_DATABASE_URL
  run "$SCRIPT" semear
  [ "$status" -ne 0 ]
  ! grep -q '^node' "$REGISTRO"
}

@test "implantar: migra, semeia e fica parado sem as variáveis; com o marcador do saude.sh" {
  ADMIN_INICIAL_SENHA=segredo-do-teste run "$SCRIPT" implantar
  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$REGISTRO")" = 'prisma migrate deploy' ]
  grep -q "^node --enable-source-maps $T/seed/seed.mjs$" "$REGISTRO"
  grep -q '^\[IMPLANTAR_CONCLUIDO\]' <<< "$output"
  # O sleep final não tem a senha nem a URL do migrador; o prisma também não recebe a senha.
  grep -q '^sleep infinity senha=<ausente> migrate=<ausente>$' "$REGISTRO"
  ! grep -q '^prisma-com-senha$' "$REGISTRO"
  [ -e "$T/implantar" ]
}

@test "implantar: migração ou seed com falha → sai com erro, sem ficar parado" {
  PRISMA_SAIDA=1 run "$SCRIPT" implantar
  [ "$status" -ne 0 ]
  ! grep -q '^node' "$REGISTRO"
  ! grep -q '^sleep' "$REGISTRO"
  : > "$REGISTRO"
  NODE_SAIDA=4 run "$SCRIPT" implantar
  [ "$status" -eq 4 ]
  ! grep -q '^sleep' "$REGISTRO"
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

@test "worker sem FILA_DATABASE_URL → código 64, sem subir o node" {
  run "$SCRIPT" worker
  [ "$status" -eq 64 ]
  [[ "$output" == *"FILA_DATABASE_URL"* ]]
  ! grep -q '^node' "$REGISTRO"
}

@test "worker: não migra e sobe o bundle sem a credencial do migrador" {
  FILA_DATABASE_URL="postgresql://sgo_fila:x@db:5432/sgo" run "$SCRIPT" worker
  [ "$status" -eq 0 ]
  # run !: um "! comando" no meio do teste não reprova (o bash ignora o set -e nele).
  run ! grep -q '^prisma' "$REGISTRO"
  grep -q "^node --enable-source-maps $T/worker/index.mjs\$" "$REGISTRO"
  grep -q '^node-env MIGRATE_DATABASE_URL=<ausente>$' "$REGISTRO"
}

@test "worker como root: troca para o usuário node com setpriv" {
  cat > "$T/bin/id" <<'SH'
#!/bin/sh
echo 0
SH
  cat > "$T/bin/setpriv" <<'SH'
#!/bin/sh
echo "setpriv $*" >> "$REGISTRO"
while [ "$#" -gt 0 ] && [ "${1#--}" != "$1" ]; do shift; done
exec "$@"
SH
  chmod +x "$T/bin/id" "$T/bin/setpriv"
  APP_USUARIO=node FILA_DATABASE_URL="postgresql://sgo_fila:x@db:5432/sgo" run "$SCRIPT" worker
  [ "$status" -eq 0 ]
  grep -q "^setpriv --reuid=node --regid=node --init-groups --inh-caps=-all --bounding-set=-all --no-new-privs env -u MIGRATE_DATABASE_URL node --enable-source-maps $T/worker/index.mjs\$" "$REGISTRO"
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

@test "app como root: troca para o usuário node com setpriv no exec do servidor" {
  cat > "$T/bin/id" <<'SH'
#!/bin/sh
echo 0
SH
  cat > "$T/bin/setpriv" <<'SH'
#!/bin/sh
echo "setpriv $*" >> "$REGISTRO"
while [ "$#" -gt 0 ] && [ "${1#--}" != "$1" ]; do shift; done
exec "$@"
SH
  chmod +x "$T/bin/id" "$T/bin/setpriv"
  APP_USUARIO=node run "$SCRIPT" app
  [ "$status" -eq 0 ]
  grep -q '^setpriv --reuid=node --regid=node --init-groups --inh-caps=-all --bounding-set=-all --no-new-privs env -u MIGRATE_DATABASE_URL node server.js$' "$REGISTRO"
  grep -q '^node-env MIGRATE_DATABASE_URL=<ausente>$' "$REGISTRO"
}

@test "app sem root, com APP_USUARIO definido: avisa que a credencial fica legível" {
  APP_USUARIO=node run --separate-stderr "$SCRIPT" app
  if [ "$(id -u)" = 0 ]; then skip "rodando como root: o caminho sem troca não se aplica"; fi
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"não roda como root"* ]]
}
