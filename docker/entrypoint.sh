#!/usr/bin/env bash
# Entrypoint da imagem do SGO (US-013, plano do P3, Tarefa 4).
#   app                  migra o banco e, só se a migração passar, sobe o servidor Next.js;
#                        migração com falha → sai com erro antes de abrir a porta, e o Easypanel
#                        (atualização start-first) mantém a versão anterior no ar
#   migrar               só a migração (prisma migrate deploy), com o código de saída do Prisma
#   resolver <migration> marca uma migration com falha como desfeita (prisma migrate resolve
#                        --rolled-back), para o PO destravar o deploy (runbook, "migration presa")
#   worker               ainda não disponível nesta versão da imagem (P3, Tarefa 4, Step 10)
# Nada de set -x: as URLs do banco levam senha.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
MIGRADOR_DIR="${MIGRADOR_DIR:-/opt/migrador}"

uso() {
  echo "Uso: entrypoint.sh app | migrar | resolver <migration> | worker" >&2
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

case "${1:-}" in
  app)
    migrar
    cd "$APP_DIR"
    # O servidor não precisa da credencial do sgo_migrator (dono do DDL): sobe sem ela.
    exec env -u MIGRATE_DATABASE_URL node server.js
    ;;
  migrar)
    migrar
    ;;
  resolver)
    [[ -n "${2:-}" ]] || uso
    exigir_url_migracao
    prisma migrate resolve --rolled-back "$2"
    ;;
  worker)
    echo "O worker ainda não está nesta versão da imagem (P3, Tarefa 4, Step 10)." >&2
    exit 64
    ;;
  *)
    uso
    ;;
esac
