#!/usr/bin/env bats
# Testes da frente do PR a partir das labels (US-013, spec §12.8)

bats_require_minimum_version 1.5.0

setup() { SCRIPT="$BATS_TEST_DIRNAME/../frente-do-pr.sh"; }

@test "uma label frente:B entre outras → imprime B" {
  run "$SCRIPT" "frente:B,migration"
  [ "$status" -eq 0 ]
  [ "$output" = "B" ]
}

@test "frente:A sozinha → imprime A" {
  run "$SCRIPT" "frente:A"
  [ "$status" -eq 0 ]
  [ "$output" = "A" ]
}

@test "sem label de frente → falha" {
  run "$SCRIPT" "migration"
  [ "$status" -eq 1 ]
  [[ "$output" == *"frente:A ou frente:B"* ]]
}

@test "labels vazias → falha" {
  run "$SCRIPT" ""
  [ "$status" -eq 1 ]
}

@test "as duas frentes → falha" {
  run "$SCRIPT" "frente:A,frente:B"
  [ "$status" -eq 1 ]
  [[ "$output" == *"só uma"* ]]
}

@test "label parecida não conta (frente:C, xfrente:B)" {
  run "$SCRIPT" "frente:C,xfrente:B,frente:B-extra"
  [ "$status" -eq 1 ]
}

@test "sem argumento → uso, código 64" {
  run "$SCRIPT"
  [ "$status" -eq 64 ]
}

@test "na falha, nada vai para o stdout (o workflow não grava frente vazia)" {
  run --separate-stderr "$SCRIPT" "migration"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}
