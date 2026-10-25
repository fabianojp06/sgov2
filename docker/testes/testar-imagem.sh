#!/usr/bin/env bash
# Testes da imagem do SGO (job "Imagem" do CI e verificação local; plano do P3, Tarefa 4, Step 6).
# Uso: docker/testes/testar-imagem.sh <imagem>
# Sobe um Postgres descartável numa rede Docker interna (sem internet), sem porta publicada, com
# limite de memória e oom_score_adj 500 (D12), e remove tudo no fim, mesmo com falha.
set -euo pipefail

IMAGEM="${1:?Uso: testar-imagem.sh <imagem>}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
PREFIXO="sgo-b-teste-$$"
REDE="$PREFIXO-rede"
PG="$PREFIXO-pg"
PG_IMAGEM="pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a"
LIMITES=(--memory 768m --memory-swap 768m --oom-score-adj 500)
URL_MIGRATOR="postgresql://sgo_migrator:sgo_migrator@$PG:5432"
URL_APP="postgresql://sgo_app:sgo_app@$PG:5432"

limpar() {
  docker ps -aq --filter "name=^$PREFIXO-" | xargs -r docker rm -f > /dev/null
  docker network rm "$REDE" > /dev/null 2>&1 || true
}
trap limpar EXIT

falhar() {
  echo "FALHOU: $*" >&2
  exit 1
}

# Pergunta HTTP de dentro da rede interna, com o node da própria imagem.
http_login() {
  docker run --rm --network "$REDE" "${LIMITES[@]}" --entrypoint node "$IMAGEM" -e \
    "fetch('http://$1:3000/login').then((r) => console.log(r.status)).catch(() => console.log('sem-resposta'))"
}

echo "1. A imagem não contém .env nem .git"
achados=$(docker run --rm --entrypoint sh "$IMAGEM" -c \
  "find / -xdev \( -name '.env*' -o -name .git \) -not -path '/proc/*' 2>/dev/null || true")
[[ -z "$achados" ]] || falhar "arquivos proibidos na imagem: $achados"

echo "2. Banco descartável numa rede sem internet"
docker network create --internal "$REDE" > /dev/null
docker run -d --name "$PG" --network "$REDE" "${LIMITES[@]}" -e POSTGRES_HOST_AUTH_METHOD=trust "$PG_IMAGEM" > /dev/null
# Por TCP (-h 127.0.0.1): o servidor temporário da inicialização da imagem do Postgres só escuta no
# socket local e reinicia em seguida; pelo socket, o pg_isready diria "pronto" cedo demais.
pronto=0
for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; then pronto=1; break; fi
  sleep 1
done
[[ "$pronto" == 1 ]] || falhar "o Postgres descartável não ficou pronto em 60 s"
docker exec -i "$PG" psql -q -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 < "$RAIZ/docker/postgres/init/01-papeis.sql"

echo "3. migrar sem internet e sem devDependencies → código 0"
docker run --rm --name "$PREFIXO-migrar" --network "$REDE" "${LIMITES[@]}" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_teste" "$IMAGEM" migrar \
  || falhar "o migrador não aplicou as migrations sem rede"

echo "4. migrar com migration quebrada → código diferente de 0"
if docker run --rm --name "$PREFIXO-quebrada" --network "$REDE" "${LIMITES[@]}" \
  -v "$RAIZ/docker/testes/migration-quebrada:/opt/migrador/prisma/migrations:ro" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_shadow" "$IMAGEM" migrar; then
  falhar "a migration quebrada passou"
fi

echo "5. app com migration quebrada → sai com erro e nunca responde HTTP"
docker run -d --name "$PREFIXO-app-ruim" --network "$REDE" "${LIMITES[@]}" \
  -v "$RAIZ/docker/testes/migration-quebrada:/opt/migrador/prisma/migrations:ro" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_dev" -e DATABASE_URL="$URL_APP/sgo_dev" "$IMAGEM" app > /dev/null
saida=$(docker wait "$PREFIXO-app-ruim")
[[ "$saida" != 0 ]] || falhar "o app subiu com a migration quebrada (código 0)"
if docker logs "$PREFIXO-app-ruim" 2>&1 | grep -q 'Next.js'; then
  falhar "o servidor Next.js chegou a iniciar com a migration quebrada"
fi

echo "6. app com as migrations boas → /login responde 200"
docker run -d --name "$PREFIXO-app" --network "$REDE" "${LIMITES[@]}" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_teste" -e DATABASE_URL="$URL_APP/sgo_teste" "$IMAGEM" app > /dev/null
status=sem-resposta
for _ in $(seq 1 30); do
  status=$(http_login "$PREFIXO-app")
  [[ "$status" == 200 ]] && break
  sleep 2
done
[[ "$status" == 200 ]] || falhar "/login respondeu $status"

echo "Imagem aprovada."
