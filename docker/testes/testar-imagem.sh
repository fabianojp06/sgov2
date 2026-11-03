#!/usr/bin/env bash
# Testes da imagem do SGO (job "Imagem" do CI e verificação local; plano do P3, Tarefa 4, Step 6).
# Uso: docker/testes/testar-imagem.sh <imagem>      (na VPS: nice -n 10 docker/testes/testar-imagem.sh …)
# Sobe um Postgres descartável numa rede Docker interna (sem internet), sem porta publicada, com
# limite de memória e de CPU e oom_score_adj 500 (D12), e remove tudo no fim, mesmo com falha.
set -euo pipefail

IMAGEM="${1:?Uso: testar-imagem.sh <imagem>}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
PREFIXO="sgo-b-teste-$$"
REDE="$PREFIXO-rede"
PG="$PREFIXO-pg"
PG_IMAGEM="pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a"
LIMITES=(--memory 768m --memory-swap 768m --oom-score-adj 500 --cpus 1)
URL_MIGRATOR="postgresql://sgo_migrator:sgo_migrator@$PG:5432"
URL_APP="postgresql://sgo_app:sgo_app@$PG:5432"
URL_FILA="postgresql://sgo_fila:sgo_fila@$PG:5432"
# A imagem roda com NODE_ENV=production: o worker exige AMBIENTE e URL_PUBLICA (plano do P4, R25).
ENV_WORKER=(-e AMBIENTE=hml -e URL_PUBLICA=http://127.0.0.1:3000)
MIGRATION_QUEBRADA="$RAIZ/docker/testes/migration-quebrada:/opt/migrador/prisma/migrations:ro"

limpar() {
  docker ps -aq --filter "name=^$PREFIXO-" | xargs -r docker rm -f > /dev/null
  docker network rm "$REDE" > /dev/null 2>&1 || true
}
trap limpar EXIT

falhar() {
  echo "FALHOU: $*" >&2
  exit 1
}

psql_pg() {
  docker exec -i "$PG" psql -qtA -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 "$@"
}

# Pergunta HTTP de dentro da rede interna, com o node da própria imagem.
http_login() {
  docker run --rm --name "$PREFIXO-sonda-$RANDOM" --network "$REDE" "${LIMITES[@]}" --entrypoint node "$IMAGEM" -e \
    "fetch('http://$1:3000/login', { signal: AbortSignal.timeout(5000) }).then((r) => console.log(r.status)).catch(() => console.log('sem-resposta'))"
}

saude() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}}' "$1"
}

esperar_saude() {
  local estado=starting
  for _ in $(seq 1 60); do
    estado=$(saude "$1")
    [[ "$estado" == healthy || "$estado" == unhealthy || "$estado" == sem-healthcheck ]] && break
    sleep 3
  done
  echo "$estado"
}

# Processo do usuário node (uid 1000) cuja linha de comando casa com o padrão: confere que existe
# e que não tem a MIGRATE_DATABASE_URL.
# A leitura do /proc/<pid>/environ de um processo de outro uid exige CAP_SYS_PTRACE, que o root do
# contêiner não tem. Ela é feita num contêiner auxiliar da imagem do Postgres (fixada por digest),
# no espaço de PIDs do contêiner em teste e só com essa capacidade: nenhum binário da imagem em
# teste roda com privilégio na VPS (D12). Ambiente ilegível reprova, em vez de passar por vazio.
sem_credencial_do_migrador() {
  local ambiente
  ambiente=$(docker run --rm --name "$PREFIXO-inspecao-$RANDOM" --network none --memory 128m \
    --pid "container:$1" --cap-add SYS_PTRACE -e PADRAO="$2" --entrypoint sh "$PG_IMAGEM" -c \
    'for p in /proc/[0-9]*; do
       grep -qE "^Uid:[[:space:]]+1000[[:space:]]" "$p/status" 2>/dev/null || continue
       if grep -qaE "$PADRAO" "$p/cmdline" 2>/dev/null; then
         echo "PROCESSO $p"
         tr "\000" "\n" < "$p/environ" 2>/dev/null || echo "ILEGIVEL $p"
       fi
     done; true')
  grep -q '^PROCESSO ' <<< "$ambiente" || falhar "não achei o processo '$2' do usuário node em $1"
  ! grep -q '^ILEGIVEL ' <<< "$ambiente" || falhar "não consegui ler o ambiente do processo '$2' em $1"
  # Prova de que o ambiente foi lido: a DATABASE_URL, que o processo precisa, está lá.
  grep -q '^DATABASE_URL=' <<< "$ambiente" || falhar "o ambiente lido do processo '$2' não tem a DATABASE_URL"
  ! grep -q '^MIGRATE_DATABASE_URL=' <<< "$ambiente" || falhar "o processo '$2' tem a MIGRATE_DATABASE_URL no ambiente"
}

echo "1. A imagem não contém .env, .git nem chave (find como root, sem rede)"
# Só nas pastas que recebem conteúdo do projeto ou de usuário; o resto vem da imagem oficial do
# Node (ela traz, por exemplo, o .npmrc interno do próprio npm em /usr/local/lib).
achados=$(docker run --rm --name "$PREFIXO-find" --user root --network none "${LIMITES[@]}" --entrypoint sh "$IMAGEM" -c \
  'for d in /app /opt /root /home /tmp /srv; do
     [ -d "$d" ] && find "$d" -xdev \( -name ".env*" -o -name .git -o -name .npmrc -o -name "*.pem" -o -name "*.key" \)
   done; true')
[[ -z "$achados" ]] || falhar "arquivos proibidos na imagem: $achados"

echo "1b. O app tem o binário nativo do Argon2 (glibc) e não leva o Playwright (#190)"
# A base é bookworm (glibc): o pacote opcional é o @node-rs/argon2-linux-x64-gnu. O standalone do
# Next precisa tê-lo rastreado; sem ele, o login de hml e prod quebra só na primeira senha.
# Como o usuário node (o app desce para o uid 1000): uma permissão errada no .node também reprova.
# O stderr fica fora da captura (vai para o log); o || true deixa a causa chegar ao falhar (set -e).
argon=$(docker run --rm --name "$PREFIXO-argon2" --user node --network none "${LIMITES[@]}" --workdir /app --entrypoint node "$IMAGEM" -e \
  "require('@node-rs/argon2').hash('x', { algorithm: 2 }).then((h) => console.log(h.split('\$')[1])).catch((e) => console.log('falhou: ' + e.message))" || true)
[[ "$argon" == argon2id ]] || falhar "o Argon2 não roda na imagem: ${argon:-sem saída (veja o erro do node acima)}"
# O Next declara o @playwright/test como peer opcional (nota do #189): nada dele em /app, em nenhum nível.
playwright=$(docker run --rm --name "$PREFIXO-playwright" --network none "${LIMITES[@]}" --entrypoint sh "$IMAGEM" -c \
  'find /app -xdev -type d \( -name playwright -o -name playwright-core -o -name @playwright \) -prune -print; true')
[[ -z "$playwright" ]] || falhar "o Playwright está na imagem: $playwright"

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
# Os mesmos scripts de init do dev (papéis, schema pgboss, privilégios e pgvector).
for script in "$RAIZ"/docker/postgres/init/*.sql; do psql_pg < "$script"; done

echo "3. migrar sem internet e sem devDependencies → todas as migrations aplicadas"
docker run --rm --name "$PREFIXO-migrar" --network "$REDE" "${LIMITES[@]}" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_teste" "$IMAGEM" migrar \
  || falhar "o migrador não aplicou as migrations sem rede"
esperadas=$(find "$RAIZ/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)
aplicadas=$(psql_pg -d sgo_teste -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
[[ "$esperadas" -gt 0 && "$aplicadas" == "$esperadas" ]] \
  || falhar "migrations aplicadas: $aplicadas; esperadas (pastas em prisma/migrations): $esperadas"

echo "3b. semear (#195): sem administrador e sem as variáveis, falha; com elas, cria; de novo, não muda"
semear() {
  docker run --rm --name "$PREFIXO-semear-$RANDOM" --network "$REDE" "${LIMITES[@]}" \
    -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_teste" -e AMBIENTE=producao "$@" "$IMAGEM" semear 2>&1
}
if saida=$(semear); then falhar "a seed passou sem administrador e sem as ADMIN_INICIAL_*"; fi
grep -q 'Administrador inicial: defina' <<< "$saida" || falhar "a seed falhou, mas não pela falta do administrador: $(tail -5 <<< "$saida")"
# Senha só deste teste, montada aqui (um literal "SENHA=valor" parece credencial para o GitGuardian).
senha_teste=$(printf 'Senha%sImagem2026x' Da)
saida=$(semear -e ADMIN_INICIAL_LOGIN=admin.imagem -e ADMIN_INICIAL_EMAIL=admin.imagem@example.org -e "ADMIN_INICIAL_SENHA=$senha_teste") \
  || falhar "a seed com as ADMIN_INICIAL_* falhou: $(tail -5 <<< "$saida")"
[[ "$(psql_pg -d sgo_teste -c "SELECT count(*) FROM usuario WHERE login = 'admin.imagem'")" == 1 ]] || falhar "a seed não criou o administrador inicial"
saida=$(semear) || falhar "a segunda seed, com o administrador já ativo, falhou: $(tail -5 <<< "$saida")"
[[ "$(psql_pg -d sgo_teste -c "SELECT count(*) FROM usuario")" == 1 ]] || falhar "a segunda seed mudou os usuários"

echo "4. migrar com migration quebrada → falha pela migration (P3018), não por outro motivo"
if saida=$(docker run --rm --name "$PREFIXO-quebrada" --network "$REDE" "${LIMITES[@]}" -v "$MIGRATION_QUEBRADA" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_shadow" "$IMAGEM" migrar 2>&1); then
  falhar "a migration quebrada passou"
fi
grep -q 'P3018' <<< "$saida" || falhar "a migração falhou, mas não pela migration quebrada: $(tail -5 <<< "$saida")"

echo "5. app com migration quebrada → sai pela migration; o servidor nunca inicia nem fica saudável"
docker run -d --name "$PREFIXO-app-ruim" --network "$REDE" "${LIMITES[@]}" -v "$MIGRATION_QUEBRADA" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_dev" -e DATABASE_URL="$URL_APP/sgo_dev" "$IMAGEM" app > /dev/null
saida=$(timeout 180 docker wait "$PREFIXO-app-ruim") || falhar "o app com migration quebrada não terminou em 180 s"
[[ "$saida" != 0 ]] || falhar "o app subiu com a migration quebrada (código 0)"
log_ruim=$(docker logs "$PREFIXO-app-ruim" 2>&1)
grep -q 'P3018' <<< "$log_ruim" || falhar "o app saiu, mas não pela migration quebrada"
# O Next.js standalone escreve "Ready in" ao abrir a porta: não pode aparecer.
! grep -q 'Ready in' <<< "$log_ruim" || falhar "o servidor Next.js chegou a abrir a porta com a migration quebrada"
[[ "$(saude "$PREFIXO-app-ruim")" != healthy ]] || falhar "o contêiner com migration quebrada ficou saudável"

echo "6. app com as migrations boas → healthcheck da imagem saudável e /login 200"
docker run -d --name "$PREFIXO-app" --network "$REDE" "${LIMITES[@]}" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_teste" -e DATABASE_URL="$URL_APP/sgo_teste" \
  -e URL_PUBLICA="http://127.0.0.1:3000" "$IMAGEM" app > /dev/null
estado=$(esperar_saude "$PREFIXO-app")
[[ "$estado" == healthy ]] || falhar "healthcheck da imagem: $estado"
[[ "$(http_login "$PREFIXO-app")" == 200 ]] || falhar "/login não respondeu 200"
# Mantém viva a prova negativa do passo 5: o texto que ela procura existe no servidor que sobe.
grep -q 'Ready in' <<< "$(docker logs "$PREFIXO-app" 2>&1)" || falhar "o log do servidor não tem mais \"Ready in\" (ajuste o passo 5)"

echo "7. O servidor roda como node, sem a credencial do migrador, e não lê o ambiente do PID 1"
# O Next.js standalone troca o título do processo (e o /proc/<pid>/cmdline) para "next-server (v…)".
SERVIDOR='next-server|server\.js'
uid=$(docker top "$PREFIXO-app" -eo pid,uid,args | PADRAO="$SERVIDOR" awk '$0 ~ ENVIRON["PADRAO"] && !/awk/ { print $2; exit }')
[[ "$uid" == 1000 ]] || falhar "o servidor roda com uid '$uid' (esperado 1000, o usuário node)"
sem_credencial_do_migrador "$PREFIXO-app" "$SERVIDOR"
if docker exec -u node "$PREFIXO-app" cat /proc/1/environ > /dev/null 2>&1; then
  falhar "o usuário node lê o ambiente do PID 1 (onde está a MIGRATE_DATABASE_URL)"
fi

echo "8. worker: publica o outbox, roda como node sem a credencial do migrador e para no SIGTERM"
docker run -d --name "$PREFIXO-worker" --network "$REDE" "${LIMITES[@]}" \
  -e MIGRATE_DATABASE_URL="$URL_MIGRATOR/sgo_teste" -e DATABASE_URL="$URL_APP/sgo_teste" \
  -e FILA_DATABASE_URL="$URL_FILA/sgo_teste" "${ENV_WORKER[@]}" "$IMAGEM" worker > /dev/null
id_msg=$(psql_pg -d sgo_teste -c "INSERT INTO outbox_mensagem (tipo, dados) VALUES ('teste.eco', '{\"prova\": 1}') RETURNING id")
publicada=f
for _ in $(seq 1 30); do
  publicada=$(psql_pg -d sgo_teste -c "SELECT publicado_em IS NOT NULL FROM outbox_mensagem WHERE id = '$id_msg'")
  [[ "$publicada" == t ]] && break
  sleep 2
done
[[ "$publicada" == t ]] || falhar "o worker não publicou o outbox em 60 s: $(docker logs "$PREFIXO-worker" 2>&1 | tail -5)"
[[ "$(psql_pg -d sgo_teste -c "SELECT count(*) FROM pgboss.job WHERE id = '$id_msg'")" == 1 ]] \
  || falhar "a mensagem do outbox foi marcada, mas o job não está no pg-boss"
estado=$(esperar_saude "$PREFIXO-worker")
[[ "$estado" == healthy ]] || falhar "healthcheck do worker: $estado"
# O trabalhador de e-mail (US-025) está registrado: aparece na lista do log de partida.
grep -q 'worker pronto.*email\.enviar' <<< "$(docker logs "$PREFIXO-worker" 2>&1 | tr -d '\n')" \
  || falhar "o worker partiu sem o trabalhador email.enviar: $(docker logs "$PREFIXO-worker" 2>&1 | grep 'worker pronto')"
WORKER='worker/index\.mjs'
uid=$(docker top "$PREFIXO-worker" -eo pid,uid,args | PADRAO="$WORKER" awk '$0 ~ ENVIRON["PADRAO"] && !/awk/ { print $2; exit }')
[[ "$uid" == 1000 ]] || falhar "o worker roda com uid '$uid' (esperado 1000, o usuário node)"
sem_credencial_do_migrador "$PREFIXO-worker" "$WORKER"
if docker exec -u node "$PREFIXO-worker" cat /proc/1/environ > /dev/null 2>&1; then
  falhar "no worker, o usuário node lê o ambiente do PID 1"
fi
docker run --rm --name "$PREFIXO-mapa" --network none "${LIMITES[@]}" --entrypoint test "$IMAGEM" -f /app/worker/index.mjs.map \
  || falhar "a imagem não tem o source map do worker"
# 10 s: o stop_grace_period padrão do Docker e do Swarm.
docker stop -t 10 "$PREFIXO-worker" > /dev/null
[[ "$(docker inspect -f '{{.State.ExitCode}}' "$PREFIXO-worker")" == 0 ]] \
  || falhar "o worker não saiu com 0 no SIGTERM: $(docker logs "$PREFIXO-worker" 2>&1 | tail -5)"
grep -q 'SIGTERM recebido, encerrando' <<< "$(docker logs "$PREFIXO-worker" 2>&1)" \
  || falhar "o worker parou, mas não pelo encerramento ordenado do SIGTERM"

# Sem AMBIENTE, o worker da imagem não parte (R25).
saida=$(docker run --rm --name "$PREFIXO-sem-ambiente" --network "$REDE" "${LIMITES[@]}" \
  -e DATABASE_URL="$URL_APP/sgo_teste" -e FILA_DATABASE_URL="$URL_FILA/sgo_teste" -e URL_PUBLICA=http://127.0.0.1:3000 \
  "$IMAGEM" worker 2>&1) && falhar "o worker partiu sem AMBIENTE"
grep -q 'AMBIENTE ausente ou inválido' <<< "$saida" || falhar "o worker sem AMBIENTE saiu, mas não por ele: $(tail -3 <<< "$saida")"

echo "9. healthcheck não fica verde à toa: sem servidor, e com o worker sem conseguir publicar"
if docker run --rm --name "$PREFIXO-saude" --network none "${LIMITES[@]}" --entrypoint /app/docker/saude.sh "$IMAGEM"; then
  falhar "o saude.sh deu saudável sem servidor e sem worker"
fi
# Banco sem as migrations (só o schema das filas): o worker que sobe antes do app falha no outbox,
# nunca fica saudável e sai sozinho depois das falhas seguidas.
psql_pg -c "CREATE DATABASE sgo_sem_schema OWNER sgo_migrator"
psql_pg -d sgo_sem_schema -c "CREATE SCHEMA pgboss AUTHORIZATION sgo_fila"
docker run -d --name "$PREFIXO-worker-cedo" --network "$REDE" "${LIMITES[@]}" \
  -e DATABASE_URL="$URL_APP/sgo_sem_schema" -e FILA_DATABASE_URL="$URL_FILA/sgo_sem_schema" "${ENV_WORKER[@]}" \
  "$IMAGEM" worker > /dev/null
saida=$(timeout 150 docker wait "$PREFIXO-worker-cedo") || falhar "o worker sem schema não saiu em 150 s"
[[ "$saida" == 1 ]] || falhar "o worker sem schema saiu com $saida (esperado 1)"
grep -q 'falhas seguidas no outbox, encerrando' <<< "$(docker logs "$PREFIXO-worker-cedo" 2>&1)" \
  || falhar "o worker sem schema saiu, mas não pelas falhas seguidas do outbox"
[[ "$(saude "$PREFIXO-worker-cedo")" != healthy ]] || falhar "o worker sem schema chegou a ficar saudável"

echo "Imagem aprovada."
