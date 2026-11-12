#!/usr/bin/env bash
# Teste de restauração mensal (US-015; plano do P3, Tarefa 7), no dia 1 às 04:00 (timer
# sgo-backup-restauracao@). Com a chave só de leitura e a senha do cofre (/etc/sgo/backup-leitura-<ambiente>.env,
# variáveis PGBACKREST_*), restaura o último backup do ambiente num contêiner descartável
# sgo-restauro-<ambiente>-<data>, fora dos nomes vedados de D12, sem porta publicada, com 768 MB e
# prioridade baixa de memória e de CPU. Confere as tabelas do public e o último registro do Histórico,
# grava a linha em /var/lib/sgo/restauracoes.log, manda o mesmo texto ao alerta e remove o contêiner.
# O PO transcreve a linha para docs/operacao/restauracoes.md (o host não tem a worktree).
# Uso: testar-restauracao.sh <hml|prod>
set -euo pipefail
# shellcheck source=ops/backup/comum.sh
. "$(dirname "$(readlink -f "$0")")/comum.sh"

IMAGEM_POSTGRES="${IMAGEM_POSTGRES:-ghcr.io/fabianojp06/sgov2-postgres:atual}"
ENV_LEITURA="${ENV_LEITURA:-/etc/sgo/backup-leitura-${1:-}.env}"
LOG_RESTAURACOES="${LOG_RESTAURACOES:-/var/lib/sgo/restauracoes.log}"
# Segundos até o banco restaurado aceitar conexões (o replay dos WAL pode demorar).
ESPERA_PRONTO="${ESPERA_PRONTO:-1800}"

ambiente="${1:-}"
projeto_do_ambiente "$ambiente" > /dev/null || exit 64

nome="sgo-restauro-${ambiente}-$(date +%Y%m%d%H%M)"
inicio=$(date +%s)
mkdir -p "$(dirname "$LOG_RESTAURACOES")"

registrar() {
  local linha
  linha="$(date -Is) $ambiente $1 $(( $(date +%s) - inicio ))s $2"
  echo "$linha" >> "$LOG_RESTAURACOES"
  alertar "SGO restauração: $linha"
}

# -v: o volume anônimo do PGDATA restaurado sai junto (senão sobraria uma cópia do banco por mês).
remover() { "$DOCKER" rm -fv "$nome" > /dev/null 2>&1 || true; }
trap remover EXIT

reprovar() {
  registrar FALHOU "$1"
  exit 1
}

# Restaura no PGDATA vazio do contêiner e sobe o Postgres sem arquivar (o restauro não grava no
# repositório: a chave é só de leitura). nice 10: o teste cede CPU à produção. O $PGDATA expande no contêiner.
# shellcheck disable=SC2016
script='set -e
gosu postgres pgbackrest --stanza=sgo --pg1-path="$PGDATA" restore
exec nice -n 10 gosu postgres postgres -c archive_mode=off -c listen_addresses=""'

"$DOCKER" run -d --name "$nome" \
  --memory 768m --memory-swap 768m --oom-score-adj 500 \
  --env-file "$ENV_LEITURA" \
  --entrypoint /bin/bash "$IMAGEM_POSTGRES" -c "$script" > /dev/null \
  || reprovar "o contêiner de restauração não subiu"

pronto=0
for _ in $(seq 1 "$ESPERA_PRONTO"); do
  if "$DOCKER" exec -u postgres "$nome" pg_isready -q -d sgo > /dev/null 2>&1; then pronto=1; break; fi
  sleep 1
done
[ "$pronto" = 1 ] || reprovar "o banco restaurado não ficou pronto em ${ESPERA_PRONTO}s"

consultar() { "$DOCKER" exec -u postgres "$nome" psql -X -d sgo -Atc "$1"; }
tabelas="$(consultar "select count(*) from information_schema.tables where table_schema = 'public'")" \
  || reprovar "não consegui contar as tabelas do public"
historico="$(consultar "select max(ocorrido_em) from historico_operacao")" \
  || reprovar "não consegui ler o Histórico"
[ "${tabelas:-0}" -gt 0 ] || reprovar "o public restaurado está vazio"

registrar OK "tabelas=$tabelas historico=${historico:-vazio}"
