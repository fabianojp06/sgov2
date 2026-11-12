#!/usr/bin/env bats
# Testes do backup (US-015; plano do P3, Tarefa 7, Step 2): docker, age, rclone, logger e curl falsos.

bats_require_minimum_version 1.5.0

setup() {
  T="$BATS_TEST_TMPDIR"
  D="$BATS_TEST_DIRNAME/.."
  mkdir -p "$T/bin"
  export PATH="$T/bin:$PATH"
  export LOGGER="$T/bin/logger" CURL="$T/bin/curl" DOCKER="$T/bin/docker" AGE="$T/bin/age" RCLONE="$T/bin/rclone"
  export ALERTA_WEBHOOK_URL="https://alerta.exemplo/topico"
  export LOG_RESTAURACOES="$T/restauracoes.log" ESPERA_PRONTO=2
  export AGE_DESTINATARIO="age1exemplo" DESTINO_DUMP="sgo:balde/dumps"
  printf '#!/bin/sh\necho "$@" >> %s/logger.out\n' "$T" > "$LOGGER"
  printf '#!/bin/sh\necho "$@" >> %s/curl.out\ncat >> %s/curl.in\n' "$T" "$T" > "$CURL"
  printf '#!/bin/sh\necho "$@" >> %s/rclone.out\n' "$T" > "$RCLONE"
  # age falso: lê o stdin e grava um "cifrado" não vazio no -o, ou falha com AGE_FALHA=1.
  printf '%s\n' '#!/bin/bash' '[ "${AGE_FALHA:-}" = 1 ] && exit 1' 'saida=/dev/stdout' \
    'while [ $# -gt 0 ]; do [ "$1" = -o ] && saida="$2"; shift; done' \
    'cat > /dev/null' 'echo cifrado > "$saida"' > "$AGE"
  chmod +x "$T/bin/"*
}

# docker falso: ps devolve o contêiner do db do ambiente; exec e run registram os argumentos.
# DOCKER_FALHA=<subcomando ou trecho> faz a chamada que o contiver falhar.
docker_falso() {
  cat > "$DOCKER" <<EOF
#!/bin/bash
echo "\$*" >> "$T/docker.out"
for f in \${DOCKER_FALHA:-}; do [[ "\$*" == *"\$f"* ]] && exit 1; done
case "\$1" in
  ps) [ "\${SEM_CONTEINER:-}" = 1 ] || echo "sgo-hml_db.1.abc" ;;
  exec)
    [[ "\$*" == *pg_dump* ]] && echo "dump-binario"
    [[ "\$*" == *"count(*)"* ]] && echo 42
    [[ "\$*" == *"max(ocorrido_em)"* ]] && echo "2026-11-12 03:00:00+00"
    ;;
  run) echo "id-do-conteiner" ;;
esac
exit 0
EOF
  chmod +x "$DOCKER"
}

# --- backup-pgbackrest.sh ---

@test "pgbackrest: tipo semanal → código 64, sem tocar no docker" {
  docker_falso
  run "$D/backup-pgbackrest.sh" hml semanal
  [ "$status" -eq 64 ]
  [ ! -e "$T/docker.out" ]
}

@test "pgbackrest: ambiente fora de hml/prod → código 64" {
  docker_falso
  run "$D/backup-pgbackrest.sh" dev full
  [ "$status" -eq 64 ]
}

@test "pgbackrest: full roda no db do ambiente como postgres" {
  docker_falso
  run "$D/backup-pgbackrest.sh" hml full
  [ "$status" -eq 0 ]
  grep -q 'exec -u postgres sgo-hml_db.1.abc pgbackrest --stanza=sgo backup --type=full' "$T/docker.out"
}

@test "pgbackrest: falha no backup → código ≠ 0, journal e alerta" {
  docker_falso
  DOCKER_FALHA="backup" run "$D/backup-pgbackrest.sh" hml diff
  [ "$status" -ne 0 ]
  grep -q 'sgo-backup' "$T/logger.out"
  grep -q 'hml' "$T/curl.out"
}

@test "pgbackrest: sem o contêiner do db → código ≠ 0 e alerta" {
  docker_falso
  SEM_CONTEINER=1 run "$D/backup-pgbackrest.sh" hml full
  [ "$status" -ne 0 ]
  grep -q 'não encontrado' "$T/curl.out"
}

# --- dump-diario.sh ---

@test "dump: pg_dump falhando → código ≠ 0 e nenhum envio" {
  docker_falso
  DOCKER_FALHA="pg_dump" run "$D/dump-diario.sh" hml
  [ "$status" -ne 0 ]
  [ ! -e "$T/rclone.out" ]
  grep -q 'sgo-backup' "$T/logger.out"
}

@test "dump: age falhando → código ≠ 0 e nenhum envio (nunca envia em claro)" {
  docker_falso
  AGE_FALHA=1 run "$D/dump-diario.sh" hml
  [ "$status" -ne 0 ]
  [ ! -e "$T/rclone.out" ]
}

@test "dump: ok → envia dumps/<ambiente>/AAAA-MM-DD.dump.age pelo rclone, sem sobra no disco" {
  docker_falso
  export TMPDIR="$T/tmp"; mkdir -p "$TMPDIR"
  run "$D/dump-diario.sh" hml
  [ "$status" -eq 0 ]
  grep -qE "copyto .* sgo:balde/dumps/hml/[0-9]{4}-[0-9]{2}-[0-9]{2}\.dump\.age --no-check-dest --s3-no-check-bucket" "$T/rclone.out"
  [ -z "$(ls -A "$TMPDIR")" ]
}

@test "dump: sem AGE_DESTINATARIO → código ≠ 0 antes do pg_dump" {
  docker_falso
  AGE_DESTINATARIO="" run "$D/dump-diario.sh" hml
  [ "$status" -ne 0 ]
  ! grep -q pg_dump "$T/docker.out" 2>/dev/null
}

# --- testar-restauracao.sh ---

@test "restauração: docker run com --memory 768m, --oom-score-adj 500, sem porta e nome fora dos vedados" {
  docker_falso
  run "$D/testar-restauracao.sh" hml
  [ "$status" -eq 0 ]
  linha=$(grep '^run ' "$T/docker.out")
  [[ "$linha" == *"--memory 768m"* ]]
  [[ "$linha" == *"--oom-score-adj 500"* ]]
  [[ "$linha" == *"--name sgo-restauro-hml-"* ]]
  [[ "$linha" != *" -p "* && "$linha" != *"--publish"* ]]
}

@test "restauração: ok → linha OK no log com tabelas e Histórico, alerta enviado e contêiner removido" {
  docker_falso
  run "$D/testar-restauracao.sh" hml
  [ "$status" -eq 0 ]
  grep -qE '^[0-9T:+-]+ hml OK [0-9]+s tabelas=42 historico=2026-11-12 03:00:00\+00$' "$LOG_RESTAURACOES"
  grep -q 'OK' "$T/curl.out"
  grep -q '^rm -fv sgo-restauro-hml-' "$T/docker.out"
}

@test "restauração: contêiner falhando → linha FALHOU, alerta e código ≠ 0" {
  docker_falso
  DOCKER_FALHA="run" run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU ' "$LOG_RESTAURACOES"
  grep -q 'FALHOU' "$T/curl.out"
}

@test "restauração: banco que nunca fica pronto → FALHOU e contêiner removido" {
  docker_falso
  DOCKER_FALHA="pg_isready" run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU ' "$LOG_RESTAURACOES"
  grep -q '^rm -fv sgo-restauro-hml-' "$T/docker.out"
}

@test "alerta: URL com quebra de linha não vai para o curl" {
  docker_falso
  ALERTA_WEBHOOK_URL=$'https://a\nb' DOCKER_FALHA="backup" run "$D/backup-pgbackrest.sh" hml full
  [ "$status" -ne 0 ]
  [ ! -e "$T/curl.out" ]
  grep -q 'inválida' "$T/logger.out"
}
