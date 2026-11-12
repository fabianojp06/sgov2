#!/usr/bin/env bats
# Testes das URLs de banco versionadas (plano do P3, Tarefa 6, Step 3; US-014)

bats_require_minimum_version 1.5.0

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../urls-banco.sh"
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  git -C "$REPO" init -q
}

versionar() {
  mkdir -p "$REPO/$(dirname "$1")"
  printf '%s\n' "$2" > "$REPO/$1"
  git -C "$REPO" add "$1"
}

@test "só URLs de dev local e do db do compose → ok" {
  versionar .env.example 'DATABASE_URL="postgresql://sgo_app:sgo_app@127.0.0.1:55432/sgo_dev"'
  versionar docker-compose.yml 'DATABASE_URL: postgresql://sgo_app:sgo_app@db:5432/sgo_dev'
  versionar ci.yml 'url: postgres://postgres@localhost:56432/postgres?sslmode=disable'
  run "$SCRIPT" "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"só dev local"* ]]
}

@test "URL do db de prod no código → reprova com o arquivo e a linha" {
  versionar src/config.ts $'const a = 1;\nconst url = "postgresql://sgo_app:x@sgo-prod_db:5432/sgo";'
  run "$SCRIPT" "$REPO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"src/config.ts:2"* ]]
  [[ "$output" == *"sgo-prod_db:5432"* ]]
}

@test "porta de dev em outro host, ou localhost na porta 5432 → reprova" {
  versionar a.env 'X=postgresql://u:x@10.0.1.5:55432/sgo_dev'
  versionar b.env 'Y=postgresql://u:x@localhost:5432/sgo'
  run "$SCRIPT" "$REPO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"10.0.1.5:55432"* ]]
  [[ "$output" == *"localhost:5432"* ]]
  [[ "$output" == *"2 URL(s)"* ]]
}

@test "testes, planos e e2e citam prod de propósito → ficam de fora" {
  versionar src/x.test.ts 'postgresql://u:x@sgo-prod_db:5432/sgo'
  versionar ops/testes/y.bats 'postgresql://u:x@sgo-prod_db:5432/sgo'
  versionar docs/plano.md 'postgresql://u:x@sgo-prod_db:5432/sgo'
  versionar tests/integracao/banco.ts 'postgresql://u:x@10.0.1.5:5432/sgo'
  versionar e2e/apoio.ts 'postgresql://u:x@10.0.1.5:5432/sgo'
  run "$SCRIPT" "$REPO"
  [ "$status" -eq 0 ]
}

@test "arquivo fora do git não conta" {
  printf '%s\n' 'postgresql://u:x@sgo-prod_db:5432/sgo' > "$REPO/.env.local"
  run "$SCRIPT" "$REPO"
  [ "$status" -eq 0 ]
}
