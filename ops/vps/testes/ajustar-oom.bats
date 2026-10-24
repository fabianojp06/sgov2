#!/usr/bin/env bats
# Testes da prioridade de memória por contêiner (US-122, spec D12)

setup() {
  T="$(mktemp -d)"
  cat > "$T/docker" <<'SH'
#!/bin/sh
case "$1" in
  ps)  printf 'z0 sgo-a-sumiu-1\na1 sgo-prod_db.1.x\nb2 sgo-hml_app.1.y\nc3 sgo-a-db-1\nd4 sgo-b-app-1\ne5 easypanel.1.z\nf6 easypanel-traefik.1.w\ng7 outro-servico\nh8 sgo-ab-x\ni9 sgo-api_app.1.z\nj10 sgo-backup_job.1.q\nk11 sgo-production_x.1.a\nl12 sgo-hmlx_app.1\nm13 sgo-prod_vazio.1\n' ;;
  top) case "$2" in z0) exit 1;; a1) printf 'PID\n101\n102\n';; b2) printf 'PID\n201\n';; c3) printf 'PID\n301\n';; d4) printf 'PID\n401\n';; e5) printf 'PID\n501\n';; f6) printf 'PID\n601\n';; g7) printf 'PID\n701\n';; h8) printf 'PID\n801\n';; i9) printf 'PID\n901\n';; j10) printf 'PID\n1001\n';; k11) printf 'PID\n1101\n';; l12) printf 'PID\n1201\n';; m13) printf 'PID\n\n  \nabc\n';; esac ;;
esac
SH
  chmod +x "$T/docker"
  export DOCKER="$T/docker" PROC="$T/proc"
  for p in 101 102 201 301 401 501 601 701 801 901 1001 1101 1201; do mkdir -p "$PROC/$p"; echo 0 > "$PROC/$p/oom_score_adj"; done
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

@test "contêiner que sai antes do docker top não impede o ajuste da produção" {
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(cat "$PROC/101/oom_score_adj")" = "-500" ]
}

@test "nomes parecidos não são tratados como dev nem como produção" {
  run "$SCRIPT" --simular
  [[ "$output" != *"sgo-ab-x"* ]]
  [[ "$output" != *"sgo-api_app"* ]]
  [[ "$output" != *"sgo-backup_job"* ]]
  [[ "$output" != *"sgo-production_x"* ]]
  [[ "$output" != *"sgo-hmlx_app"* ]]
  [[ "$output" != *"sgo-prod_vazio"* ]]
  run "$SCRIPT"
  for p in 801 901 1001 1101 1201; do [ "$(cat "$PROC/$p/oom_score_adj")" = "0" ]; done
}

@test "docker indisponível: sai com 0 sem escrever nada" {
  printf '#!/bin/sh\nexit 1\n' > "$DOCKER"
  run "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(cat "$PROC/101/oom_score_adj")" = "0" ]
}
