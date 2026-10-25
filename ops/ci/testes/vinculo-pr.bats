#!/usr/bin/env bats
# Testes do vínculo do PR com uma issue (US-013, spec §12.8; Refs aceito por decisão do PO, plano do P3)

setup() { SCRIPT="$BATS_TEST_DIRNAME/../vinculo-pr.sh"; }

vincular() { printf '%b' "$1" | "$SCRIPT"; }

@test "Closes #35 no fim do corpo → ok" {
  run vincular "Texto do PR.\n\nCloses #35"
  [ "$status" -eq 0 ]
}

@test "closes em minúsculas → ok" {
  run vincular "closes #35"
  [ "$status" -eq 0 ]
}

@test "Fixes e Resolves → ok" {
  run vincular "Fixes #7"
  [ "$status" -eq 0 ]
  run vincular "Resolves #12"
  [ "$status" -eq 0 ]
}

@test "Refs #35 → ok" {
  run vincular "Refs #35, Refs #36"
  [ "$status" -eq 0 ]
}

@test "menção sem palavra-chave → falha" {
  run vincular "Relacionado à 35 e ao #36"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Closes #n"* ]]
}

@test "corpo vazio → falha" {
  run vincular ""
  [ "$status" -eq 1 ]
}

@test "Closes sem número → falha" {
  run vincular "Closes #"
  [ "$status" -eq 1 ]
}

@test "palavra-chave colada em outra palavra não conta" {
  run vincular "Encloses #35"
  [ "$status" -eq 1 ]
}

@test "corpo grande com Closes no início não quebra o pipe (pipefail)" {
  run bash -o pipefail -c "{ printf 'Closes #35\n'; head -c 2000000 /dev/zero | tr '\0' 'x'; } | '$SCRIPT'"
  [ "$status" -eq 0 ]
}
