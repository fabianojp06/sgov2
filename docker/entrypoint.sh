#!/usr/bin/env bash
# Entrypoint da imagem do SGO (US-013, plano do P3, Tarefa 4).
#   app                  migra o banco e, só se a migração passar, sobe o servidor Next.js;
#                        migração com falha → sai com erro antes de abrir a porta, e o Easypanel
#                        (atualização start-first) mantém a versão anterior no ar
#   migrar               só a migração (prisma migrate deploy), com o código de saída do Prisma
#   semear               roda a seed (/app/seed/seed.mjs, o prisma/seed.ts em bundle; #195) com a
#                        MIGRATE_DATABASE_URL, como o usuário node; com o código de saída dela
#   implantar            migrar e, só se passar, semear: o serviço de migração do deploy
#   resolver <migration> marca uma migration com falha como desfeita (prisma migrate resolve
#                        --rolled-back), para o PO destravar o deploy (runbook, "migration presa")
#   worker               sobe o worker (outbox e filas, US-010), sem migrar: quem migra é o app
# Nada de set -x: as URLs do banco levam senha.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
MIGRADOR_DIR="${MIGRADOR_DIR:-/opt/migrador}"
# O entrypoint (e o tini, PID 1) roda como root e só o servidor desce para este usuário: assim o
# ambiente do PID 1, que tem a MIGRATE_DATABASE_URL, não fica legível pelo processo do app
# (/proc/1/environ). Vazio = sem troca (testes).
APP_USUARIO="${APP_USUARIO-node}"

uso() {
  echo "Uso: entrypoint.sh app | migrar | semear | implantar | resolver <migration> | worker" >&2
  exit 64
}

exigir_url_migracao() {
  if [[ -z "${MIGRATE_DATABASE_URL:-}" ]]; then
    echo "MIGRATE_DATABASE_URL não definida: a imagem não sobe sem migrar o banco." >&2
    exit 1
  fi
}

prisma() {
  # O migrador é autossuficiente: prisma, prisma.config.ts e as migrations ficam em /opt/migrador.
  (cd "$MIGRADOR_DIR" && ./node_modules/.bin/prisma "$@")
}

# Troca o processo pelo comando dado, sem a credencial do sgo_migrator (dono do DDL) e, como
# root, já no APP_USUARIO sem capacidades.
exec_sem_migrador() {
  if [[ -n "$APP_USUARIO" && "$(id -u)" == 0 ]]; then
    exec setpriv --reuid="$APP_USUARIO" --regid="$APP_USUARIO" --init-groups \
      --inh-caps=-all --bounding-set=-all --no-new-privs \
      env -u MIGRATE_DATABASE_URL "$@"
  fi
  if [[ -n "$APP_USUARIO" ]]; then
    echo "Aviso: o entrypoint não roda como root (uid $(id -u)); o processo e o PID 1 ficam com o mesmo usuário e a MIGRATE_DATABASE_URL fica legível em /proc/1/environ. Não use --user nesta imagem." >&2
  fi
  exec env -u MIGRATE_DATABASE_URL "$@"
}

migrar() {
  exigir_url_migracao
  # Sem nenhuma migration na imagem, o migrate deploy sairia 0 sem aplicar nada.
  if ! compgen -G "$MIGRADOR_DIR/prisma/migrations/*/" > /dev/null; then
    echo "A imagem não tem nenhuma migration em $MIGRADOR_DIR/prisma/migrations." >&2
    exit 1
  fi
  echo "Aplicando as migrations (prisma migrate deploy)..."
  prisma migrate deploy
}

# A seed precisa da MIGRATE_DATABASE_URL (dona dos dados de referência) e das ADMIN_INICIAL_* do
# serviço de migração; desce para o APP_USUARIO sem capacidades, mas com o ambiente.
semear() {
  exigir_url_migracao
  echo "Aplicando as seeds..."
  cd "$APP_DIR"
  if [[ -n "$APP_USUARIO" && "$(id -u)" == 0 ]]; then
    exec setpriv --reuid="$APP_USUARIO" --regid="$APP_USUARIO" --init-groups \
      --inh-caps=-all --bounding-set=-all --no-new-privs node "$APP_DIR/seed/seed.mjs"
  fi
  exec node "$APP_DIR/seed/seed.mjs"
}

case "${1:-}" in
  app)
    migrar
    cd "$APP_DIR"
    exec_sem_migrador node server.js
    ;;
  migrar)
    migrar
    ;;
  semear)
    semear
    ;;
  implantar)
    migrar
    semear
    ;;
  resolver)
    [[ -n "${2:-}" ]] || uso
    exigir_url_migracao
    prisma migrate resolve --rolled-back "$2"
    ;;
  worker)
    # Não migra: com app e worker subindo juntos, só o app aplica as migrations. Enquanto o
    # schema não chega, o publicador do outbox falha e o worker sai depois de algumas falhas
    # seguidas (worker/index.ts), para o Easypanel reiniciá-lo.
    [[ -n "${FILA_DATABASE_URL:-}" ]] || { echo "FILA_DATABASE_URL não definida: o worker não sobe sem a fila." >&2; exit 64; }
    cd "$APP_DIR"
    exec_sem_migrador node --enable-source-maps "$APP_DIR/worker/index.mjs"
    ;;
  *)
    uso
    ;;
esac
