#!/usr/bin/env bats
# Testes do backup (US-015; plano do P3, Tarefa 7, Step 2): docker, age, rclone, df, logger e curl falsos.

bats_require_minimum_version 1.5.0

setup() {
  T="$BATS_TEST_TMPDIR"
  D="$BATS_TEST_DIRNAME/.."
  mkdir -p "$T/bin" "$T/travas"
  export PATH="$T/bin:$PATH"
  export LOGGER="$T/bin/logger" CURL="$T/bin/curl" DOCKER="$T/bin/docker" AGE="$T/bin/age" RCLONE="$T/bin/rclone" DF="$T/bin/df"
  export DIR_TRAVAS="$T/travas" ESPERA_TRAVA=1
  export ALERTA_WEBHOOK_URL="https://alerta.exemplo/topico"
  export LOG_RESTAURACOES="$T/restauracoes.log" ESPERA_PRONTO=2 INTERVALO=1 PULL=never
  export AGE_DESTINATARIO="age1exemplo" DESTINO_DUMP="sgo:balde/dumps"
  export ENV_LEITURA="$T/leitura.env"
  printf '%s\n' 'PGBACKREST_REPO1_S3_KEY=chave-de-leitura' 'PGBACKREST_REPO1_CIPHER_PASS="senha do cofre"' > "$ENV_LEITURA"
  # logger falso: como o real, só lê o stdin quando não recebe mensagem (só "-t <tag>").
  printf '#!/bin/sh\necho "$@" >> %s/logger.out\nif [ $# -le 2 ]; then cat >> %s/logger.in; fi\n' "$T" "$T" > "$LOGGER"
  printf '#!/bin/sh\necho "$@" >> %s/curl.out\ncat >> %s/curl.in\n' "$T" "$T" > "$CURL"
  printf '#!/bin/sh\necho "$@" >> %s/rclone.out\n' "$T" > "$RCLONE"
  # df falso: espaço livre em bytes (LIVRE, padrão 100 GB).
  printf '#!/bin/sh\necho Avail\necho "${LIVRE:-100000000000}"\n' > "$DF"
  # age falso: lê o stdin e grava um "cifrado" não vazio no -o, ou falha com AGE_FALHA=1.
  printf '%s\n' '#!/bin/bash' '[ "${AGE_FALHA:-}" = 1 ] && exit 1' 'saida=/dev/stdout' \
    'while [ $# -gt 0 ]; do [ "$1" = -o ] && saida="$2"; shift; done' \
    'cat > /dev/null' 'echo cifrado > "$saida"' > "$AGE"
  chmod +x "$T/bin/"*
}

# docker falso: registra os argumentos e responde às consultas dos scripts.
# - DOCKER_FALHA=<trechos>: a chamada que contiver um deles sai com 1;
# - SEM_CONTEINER=1: o ps não acha o db;
# - ARQUIVO_FALHANDO=1: o pg_stat_archiver indica falha;
# - BACKUP_STOP=<epoch>: fim do último backup (padrão: agora);
# - HIST_RESTAURADO / HIST_REFERENCIA: max(ocorrido_em) restaurado e o de origem;
# - PARADO=1: o contêiner da restauração não está rodando; RECUPERANDO=1: pg_is_in_recovery = t.
docker_falso() {
  cat > "$DOCKER" <<EOF
#!/bin/bash
echo "\$*" >> "$T/docker.out"
for f in \${DOCKER_FALHA:-}; do [[ "\$*" == *"\$f"* ]] && exit 1; done
args="\$*"
case "\$1" in
  ps) [ "\${SEM_CONTEINER:-}" = 1 ] || echo "sgo-hml_db.1.abc" ;;
  info) echo /var/lib/docker ;;
  inspect) [ "\${PARADO:-}" = 1 ] && echo false || echo true ;;
  logs) echo "log do contêiner" ;;
  run) echo "id-do-conteiner" ;;
  exec)
    if [[ "\$args" == *pg_dump* ]]; then echo "dump-binario"
    elif [[ "\$args" == *pg_stat_archiver* ]]; then [ "\${ARQUIVO_FALHANDO:-}" = 1 ] && echo t || echo f
    elif [[ "\$args" == *"info --output=json"* ]]; then echo "[{\"backup\":[{\"timestamp\":{\"stop\":\${BACKUP_STOP:-\$(date +%s)}}}]}]"
    elif [[ "\$args" == *pg_database_size* ]]; then echo 1000000
    elif [[ "\$args" == *"now() - interval"* ]]; then echo "\${HIST_REFERENCIA:-2026-11-12 02:00:00+00}"
    elif [[ "\$args" == *pg_is_in_recovery* ]]; then [ "\${RECUPERANDO:-}" = 1 ] && echo t || echo f
    elif [[ "\$args" == *"count(*)"* ]]; then echo 42
    elif [[ "\$args" == *"::timestamptz >="* ]]; then
      r="\${HIST_RESTAURADO:-2026-11-12 03:00:00+00}"; o="\${HIST_REFERENCIA:-2026-11-12 02:00:00+00}"
      [[ "\$r" > "\$o" || "\$r" == "\$o" ]] && echo t || echo f
    elif [[ "\$args" == *"max(ocorrido_em)"* ]]; then echo "\${HIST_RESTAURADO:-2026-11-12 03:00:00+00}"
    fi
    ;;
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

@test "pgbackrest: full confere o check e roda no db do ambiente como postgres" {
  docker_falso
  run "$D/backup-pgbackrest.sh" hml full
  [ "$status" -eq 0 ]
  grep -q 'exec -u postgres sgo-hml_db.1.abc pgbackrest --stanza=sgo check' "$T/docker.out"
  grep -q 'exec -u postgres sgo-hml_db.1.abc pgbackrest --stanza=sgo backup --type=full' "$T/docker.out"
}

@test "pgbackrest: falha no backup → código ≠ 0, journal e alerta" {
  docker_falso
  DOCKER_FALHA="--type=diff" run "$D/backup-pgbackrest.sh" hml diff
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

@test "pgbackrest: docker fora do ar → alerta (não sai em silêncio)" {
  docker_falso
  DOCKER_FALHA="ps" run "$D/backup-pgbackrest.sh" hml full
  [ "$status" -ne 0 ]
  grep -q 'docker não respondeu' "$T/curl.out"
}

@test "pgbackrest: arquivamento falhando → alerta mesmo com o backup ok" {
  docker_falso
  ARQUIVO_FALHANDO=1 run "$D/backup-pgbackrest.sh" hml full
  [ "$status" -eq 0 ]
  grep -q 'arquivamento de WAL está falhando' "$T/curl.out"
}

@test "pgbackrest: outra operação do ambiente em andamento → falha com alerta, sem backup" {
  docker_falso
  exec 8> "$T/travas/sgo-backup-hml.lock"
  flock 8
  run "$D/backup-pgbackrest.sh" hml diff
  flock -u 8
  [ "$status" -ne 0 ]
  grep -q 'em andamento' "$T/curl.out"
  ! grep -q 'backup --type' "$T/docker.out" 2>/dev/null
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

@test "dump: docker fora do ar → alerta" {
  docker_falso
  DOCKER_FALHA="ps" run "$D/dump-diario.sh" hml
  [ "$status" -ne 0 ]
  grep -q 'docker não respondeu' "$T/curl.out"
}

# --- testar-restauracao.sh ---

@test "restauração: docker run com 768m, oom 500, sem porta, segredos montados só leitura e não no ambiente" {
  docker_falso
  run "$D/testar-restauracao.sh" hml
  [ "$status" -eq 0 ]
  linha=$(grep '^run ' "$T/docker.out")
  [[ "$linha" == *"--memory 768m"* ]]
  [[ "$linha" == *"--oom-score-adj 500"* ]]
  [[ "$linha" == *"--name sgo-restauro-hml-"* ]]
  [[ "$linha" == *"/etc/pgbackrest/conf.d/repo.conf:ro"* ]]
  [[ "$linha" != *"--env-file"* && "$linha" != *" -e "* ]]
  [[ "$linha" != *" -p "* && "$linha" != *"--publish"* ]]
  [[ "$linha" != *"chave-de-leitura"* && "$linha" != *"senha do cofre"* ]]
}

@test "restauração: ok → linha OK no log, alerta e só o próprio contêiner removido" {
  docker_falso
  run "$D/testar-restauracao.sh" hml
  [ "$status" -eq 0 ]
  grep -qE '^[0-9T:+-]+ hml OK [0-9]+s tabelas=42 historico=2026-11-12 03:00:00\+00$' "$LOG_RESTAURACOES"
  grep -q 'OK' "$T/curl.out"
  nome=$(grep -o -- '--name [^ ]*' "$T/docker.out" | cut -d' ' -f2)
  [[ "$nome" =~ ^sgo-restauro-hml-[0-9]{14}-[0-9]+$ ]]
  grep -qx "rm -fv $nome" "$T/docker.out"
}

@test "restauração: espera o fim da recuperação (pg_is_in_recovery) e reprova no prazo" {
  docker_falso
  RECUPERANDO=1 run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU .*recuperação não terminou' "$LOG_RESTAURACOES"
}

@test "restauração: Histórico restaurado atrás do de origem → FALHOU (WAL faltando)" {
  docker_falso
  HIST_RESTAURADO="2026-11-12 01:00:00+00" HIST_REFERENCIA="2026-11-12 02:00:00+00" run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU .*WAL faltando' "$LOG_RESTAURACOES"
}

@test "restauração: último backup com mais de 8 dias → FALHOU antes de restaurar" {
  docker_falso
  BACKUP_STOP=$(( $(date +%s) - 9 * 86400 )) run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU .*mais de 8 dias' "$LOG_RESTAURACOES"
  ! grep -q '^run ' "$T/docker.out"
}

@test "restauração: espaço livre menor que o dobro do banco → FALHOU sem docker run" {
  docker_falso
  LIVRE=1500000 run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU .*espaço livre insuficiente' "$LOG_RESTAURACOES"
  ! grep -q '^run ' "$T/docker.out"
}

@test "restauração: contêiner falhando ao subir → FALHOU, alerta e nada a remover" {
  docker_falso
  DOCKER_FALHA="run" run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU ' "$LOG_RESTAURACOES"
  grep -q 'FALHOU' "$T/curl.out"
  ! grep -q '^rm ' "$T/docker.out"
}

@test "restauração: contêiner que para → FALHOU na hora, log para o journal e contêiner removido" {
  docker_falso
  PARADO=1 run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU .*parou' "$LOG_RESTAURACOES"
  grep -q 'log do contêiner' "$T/logger.in"
  grep -q '^rm -fv sgo-restauro-hml-' "$T/docker.out"
}

@test "restauração: sem o arquivo de leitura → FALHOU" {
  docker_falso
  ENV_LEITURA="$T/nao-existe.env" run "$D/testar-restauracao.sh" hml
  [ "$status" -ne 0 ]
  grep -q ' hml FALHOU .*falta' "$LOG_RESTAURACOES"
}

@test "alerta: URL com quebra de linha não vai para o curl" {
  docker_falso
  ALERTA_WEBHOOK_URL=$'https://a\nb' DOCKER_FALHA="--type=full" run "$D/backup-pgbackrest.sh" hml full
  [ "$status" -ne 0 ]
  [ ! -e "$T/curl.out" ]
  grep -q 'inválida' "$T/logger.out"
}

@test "alerta-falha: a unit que falhou vai para o alerta" {
  run "$D/alerta-falha.sh" sgo-backup-dump@hml.service
  [ "$status" -eq 0 ]
  grep -q 'sgo-backup-dump@hml.service falhou' "$T/curl.out"
}
