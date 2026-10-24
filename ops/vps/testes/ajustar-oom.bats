#!/usr/bin/env bats
# Testes da prioridade de memória por contêiner (US-122, spec D12)

setup() {
  T="$(mktemp -d)"
  cat > "$T/docker" <<'SH'
#!/bin/sh
case "$1" in
  ps)  printf 'a1 sgo-prod_db.1.x\nb2 sgo-hml_app.1.y\nc3 sgo-a-db-1\nd4 sgo-b-app-1\ne5 easypanel.1.z\nf6 easypanel-traefik.1.w\ng7 outro-servico\n' ;;
  top) case "$2" in a1) printf 'PID\n101\n102\n';; b2) printf 'PID\n201\n';; c3) printf 'PID\n301\n';; d4) printf 'PID\n401\n';; e5) printf 'PID\n501\n';; f6) printf 'PID\n601\n';; g7) printf 'PID\n701\n';; esac ;;
esac
SH
  chmod +x "$T/docker"
  export DOCKER="$T/docker" PROC="$T/proc"
  for p in 101 102 201 301 401 501 601 701; do mkdir -p "$PROC/$p"; echo 0 > "$PROC/$p/oom_score_adj"; done
  SCRIPT="$BATS_TEST_DIRNAME/../ajustar-oom.sh"
}
teardown() { rm -rf "$T"; }

@test "--simular lista os valores por contêiner e não altera nada" {
  run "$SCRIPT" --simular
  [ "$status" -eq 0 ]
  [[ "$output" == *"sgo-prod_db.1.x 101 -500"* ]]
  [[ "$output" == *"sgo-prod_db.1.x 102 -500"* ]]
  [[ "$output" == *"sgo-hml_app.1.y 201 -200"* ]]
  [[ "$output" == *"sgo-a-db-1 301 500"* ]]
  [[ "$output" == *"sgo-b-app-1 401 500"* ]]
  [[ "$output" == *"easypanel.1.z 501 -300"* ]]
  [[ "$output" == *"easypanel-traefik.1.w 601 -300"* ]]
  [[ "$output" != *"outro-servico"* ]]
  [ "$(cat "$PROC/101/oom_score_adj")" = "0" ]
}

@test "aplica os valores em /proc" {
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(cat "$PROC/101/oom_score_adj")" = "-500" ]
  [ "$(cat "$PROC/201/oom_score_adj")" = "-200" ]
  [ "$(cat "$PROC/301/oom_score_adj")" = "500" ]
  [ "$(cat "$PROC/501/oom_score_adj")" = "-300" ]
  [ "$(cat "$PROC/701/oom_score_adj")" = "0" ]
}

@test "processo que sumiu no meio não derruba o script" {
  rm -rf "$PROC/102"
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(cat "$PROC/101/oom_score_adj")" = "-500" ]
}
