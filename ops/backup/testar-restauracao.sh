#!/usr/bin/env bash
# Teste de restauração mensal (US-015; plano do P3, Tarefa 7), no dia 1 às 04:00 UTC (timer
# sgo-backup-restauracao@). Restaura o último backup do ambiente, com o replay de todo o WAL
# arquivado, num contêiner descartável sgo-restauro-<ambiente>-<data>-<pid>:
# - sem porta publicada, com 768 MB, oom_score_adj 500 e nice 10 (cede memória e CPU à produção);
# - com a chave só de leitura e a senha do cofre de /etc/sgo/backup-leitura-<ambiente>.env, montadas
#   num arquivo só leitura (não aparecem no docker inspect);
# - só se houver espaço livre para o dobro do banco (a restauração não pode encher o disco do prod).
# Aprova só se a recuperação terminou, o public tem tabelas, o último backup tem até 8 dias e o
# Histórico restaurado chega pelo menos ao do banco de origem de 15 minutos atrás (prova o PITR: um
# segmento de WAL faltando para a recuperação antes). Grava a linha em /var/lib/sgo/restauracoes.log,
# manda o mesmo texto ao alerta e remove o contêiner e o volume. O PO transcreve a linha para
# docs/operacao/restauracoes.md (o host não tem a worktree).
# Uso: testar-restauracao.sh <hml|prod>
set -euo pipefail
# shellcheck source=ops/backup/comum.sh
. "$(dirname "$(readlink -f "$0")")/comum.sh"

ambiente="${1:-}"
projeto="$(projeto_do_ambiente "$ambiente")" || { trap - ERR; exit 64; }

IMAGEM_POSTGRES="${IMAGEM_POSTGRES:-ghcr.io/fabianojp06/sgov2-postgres:atual}"
# always: o teste usa o mesmo pgBackRest da imagem publicada, e não uma cópia antiga do host.
PULL="${PULL:-always}"
ENV_LEITURA="${ENV_LEITURA:-/etc/sgo/backup-leitura-${ambiente}.env}"
LOG_RESTAURACOES="${LOG_RESTAURACOES:-/var/lib/sgo/restauracoes.log}"
RESTAURO_PREFIXO="${RESTAURO_PREFIXO:-sgo-restauro}"
DF="${DF:-df}"
# Prazo, em segundos de relógio, para o banco restaurado terminar a recuperação. Menor que o
# TimeoutStartSec da unit (2h), para a reprovação ser registrada e alertada.
ESPERA_PRONTO="${ESPERA_PRONTO:-5400}"
INTERVALO="${INTERVALO:-5}"
IDADE_MAX_BACKUP_DIAS="${IDADE_MAX_BACKUP_DIAS:-8}"

nome="${RESTAURO_PREFIXO}-${ambiente}-$(date +%Y%m%d%H%M%S)-$$"
inicio=$(date +%s)
criado=0
tmp=""
mkdir -p "$(dirname "$LOG_RESTAURACOES")"

registrar() {
  local linha
  linha="$(date -Is) $ambiente $1 $(( $(date +%s) - inicio ))s $2"
  echo "$linha" >> "$LOG_RESTAURACOES"
  alertar "SGO restauração: $linha"
}

# Só remove o que este script criou. -v: o volume anônimo do PGDATA restaurado sai junto.
limpar() {
  if [ "$criado" = 1 ]; then "$DOCKER" rm -fv "$nome" > /dev/null 2>&1 || true; fi
  if [ -n "$tmp" ]; then rm -rf "$tmp"; fi
}
trap limpar EXIT

reprovar() {
  trap - ERR
  if [ "$criado" = 1 ]; then
    # O motivo costuma estar no log do contêiner (senha do cofre errada, WAL faltando): vai para o
    # journal antes de o contêiner ser removido.
    "$DOCKER" logs --tail 50 "$nome" 2>&1 | "$LOGGER" -t sgo-backup 2>/dev/null || true
  fi
  registrar FALHOU "$1"
  exit 1
}
# Erro inesperado também vira linha FALHOU (o ERR do comum.sh só alertaria).
trap 'reprovar "erro inesperado na linha $LINENO (código $?)"' ERR

[ -r "$ENV_LEITURA" ] || reprovar "falta $ENV_LEITURA"

# Banco de origem: referência do Histórico (15 min atrás, já arquivado com o archive_timeout de 60 s)
# e o tamanho, para o espaço livre.
origem="$(conteiner_db "$projeto")" || reprovar "o docker não respondeu"
[ -n "$origem" ] || reprovar "contêiner do db de origem não encontrado ($projeto)"
na_origem() { "$DOCKER" exec -u postgres "$origem" psql -X -d sgo -Atc "$1"; }
referencia="$(na_origem "select coalesce(max(ocorrido_em), 'epoch')::timestamptz from historico_operacao where ocorrido_em < now() - interval '15 minutes'")" \
  || reprovar "não consegui ler o Histórico de origem"
tamanho="$(na_origem "select sum(pg_database_size(datname)) from pg_database")" || reprovar "não consegui medir o banco de origem"
raiz="$("$DOCKER" info --format '{{.DockerRootDir}}')" || reprovar "o docker não respondeu"
livre="$("$DF" --output=avail -B1 "$raiz" | tail -n1 | tr -d ' ')" || reprovar "não consegui medir o disco"
if [ "$livre" -lt $(( tamanho * 2 )) ]; then
  reprovar "espaço livre insuficiente em $raiz ($livre bytes) para restaurar $tamanho bytes com folga"
fi

# Idade do último backup (o pgBackRest do db lê o repositório).
ultimo="$("$DOCKER" exec -u postgres "$origem" pgbackrest --stanza=sgo info --output=json \
  | python3 -c 'import json,sys; b=json.load(sys.stdin)[0]["backup"]; print(b[-1]["timestamp"]["stop"] if b else 0)')" \
  || reprovar "não consegui ler o pgbackrest info"
if [ "$ultimo" -lt $(( $(date +%s) - IDADE_MAX_BACKUP_DIAS * 86400 )) ]; then
  reprovar "o último backup tem mais de ${IDADE_MAX_BACKUP_DIAS} dias (ou não existe)"
fi

# Segredos: PGBACKREST_REPO1_X_Y=valor → repo1-x-y=valor, num arquivo montado só leitura, na seção da
# stanza (que sobrepõe a [global] do pgbackrest.conf da imagem sem conflito). Aspas em volta do valor
# saem (o EnvironmentFile do systemd as tira; aqui tiramos igual).
tmp="$(mktemp -d)"
{
  echo '[sgo]'
  sed -nE 's/^[[:space:]]*PGBACKREST_([A-Z0-9_]+)=(.*)$/\1=\2/p' "$ENV_LEITURA" | while IFS='=' read -r chave valor; do
    valor="${valor%\"}"; valor="${valor#\"}"; valor="${valor%\'}"; valor="${valor#\'}"
    chave="$(tr 'A-Z_' 'a-z-' <<< "$chave")"
    echo "$chave=$valor"
  done
} > "$tmp/repo.conf"
chmod 0644 "$tmp/repo.conf"

# Restaura no PGDATA vazio e sobe o Postgres sem arquivar (a chave é só de leitura) e sem rede.
# shellcheck disable=SC2016
script='set -e
gosu postgres pgbackrest --stanza=sgo --pg1-path="$PGDATA" restore
exec nice -n 10 gosu postgres postgres -c archive_mode=off -c listen_addresses=""'

"$DOCKER" run -d --name "$nome" --pull "$PULL" \
  --memory 768m --memory-swap 768m --oom-score-adj 500 \
  -v "$tmp/repo.conf:/etc/pgbackrest/conf.d/repo.conf:ro" \
  --entrypoint /bin/bash "$IMAGEM_POSTGRES" -c "$script" > /dev/null \
  || reprovar "o contêiner de restauração não subiu"
criado=1

consultar() { "$DOCKER" exec -u postgres "$nome" psql -X -d sgo -Atc "$1"; }
fim=$(( SECONDS + ESPERA_PRONTO ))
pronto=0
while [ "$SECONDS" -lt "$fim" ]; do
  [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$nome" 2>/dev/null || echo false)" = true ] \
    || reprovar "o contêiner de restauração parou (log no journal)"
  # Pronto = aceita conexão E terminou o replay (pg_is_in_recovery falso, depois da promoção).
  if "$DOCKER" exec -u postgres "$nome" pg_isready -q -d sgo > /dev/null 2>&1 \
    && [ "$(consultar 'select pg_is_in_recovery()' 2>/dev/null || true)" = f ]; then
    pronto=1
    break
  fi
  sleep "$INTERVALO"
done
[ "$pronto" = 1 ] || reprovar "a recuperação não terminou em ${ESPERA_PRONTO}s"

tabelas="$(consultar "select count(*) from information_schema.tables where table_schema = 'public'")" \
  || reprovar "não consegui contar as tabelas do public"
[ "${tabelas:-0}" -gt 0 ] || reprovar "o public restaurado está vazio"
historico="$(consultar "select coalesce(max(ocorrido_em), 'epoch')::timestamptz from historico_operacao")" \
  || reprovar "não consegui ler o Histórico restaurado"
# Comparação feita pelo próprio Postgres (timestamptz), sem depender do formato do texto.
chegou="$(consultar "select '$historico'::timestamptz >= '$referencia'::timestamptz")" \
  || reprovar "não consegui comparar o Histórico"
[ "$chegou" = t ] || reprovar "o Histórico restaurado ($historico) não chega ao de origem ($referencia): WAL faltando no repositório"

registrar OK "tabelas=$tabelas historico=$historico"
