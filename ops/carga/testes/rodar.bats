#!/usr/bin/env bats
# Validações do rodar.sh (plano do P7, Task 3, D-P7-1): destino, teto de usuários e duração. O node
# e o docker são dublês: nenhum login nem carga de verdade.
bats_require_minimum_version 1.5.0

setup() {
  T="$(mktemp -d)"
  # O docker dublê faz os dois papéis: o login (imagem do Playwright) devolve o cookie; o k6 registra.
  cat > "$T/docker" <<SH
#!/bin/sh
case "\$*" in
  *mcr.microsoft.com/playwright*) echo "\$@" > "$T/login.args"; env > "$T/login.env"; echo "sgo_sessao=abc=def" ;;
  *) echo "\$@" > "$T/docker.args"; env > "$T/docker.env"; cat > /dev/null ;;
esac
SH
  chmod +x "$T/docker"
  export PATH="$T:$PATH" SGO_LOCK="$T/lock"
  unset SGO_VUS SGO_DURACAO SGO_HOST_HML SGO_JANELA_PO
  SCRIPT="$BATS_TEST_DIRNAME/../rodar.sh"
}
teardown() { rm -rf "$T"; }

@test "dev local: roda o k6 limitado, com a sessão só no ambiente" {
  SGO_BASE=http://127.0.0.1:3200 SGO_SENHA=segredo run "$SCRIPT"
  [ "$status" -eq 0 ]
  grep -q -- '--memory 256m --cpus 1' "$T/docker.args"
  grep -q 'grafana/k6:1.0.0@sha256:' "$T/docker.args"
  run ! grep -q 'abc' "$T/docker.args"
  grep -qx 'SGO_SESSAO=abc=def' "$T/docker.env"
  grep -qx 'SGO_COOKIE=sgo_sessao' "$T/docker.env"
  grep -qx 'SGO_VUS=20' "$T/docker.env"
  run ! grep -q 'SGO_SENHA' "$T/docker.env"
  # O login roda no contêiner do Playwright, com o repositório só para leitura e a senha por nome.
  grep -q -- '-v [^ ]*:/repo:ro' "$T/login.args"
  grep -q -- '-e SGO_SENHA ' "$T/login.args"
  run ! grep -q 'segredo' "$T/login.args"
}

@test "destinos recusados: barra no fim, http remoto, IP e localhost em https" {
  for base in http://127.0.0.1:3200/ http://10.0.0.5:3000 https://127.0.0.1:3000 https://172.18.0.4 https://localhost https://hml.exemplo.org/login; do
    SGO_BASE="$base" run "$SCRIPT"
    [ "$status" -eq 2 ]
    [ ! -e "$T/docker.args" ]
  done
}

@test "https só com o host de hml informado e a janela do PO" {
  SGO_BASE=https://prod.exemplo.org SGO_HOST_HML=hml.exemplo.org SGO_JANELA_PO=sim run "$SCRIPT"
  [ "$status" -eq 2 ]
  SGO_BASE=https://hml.exemplo.org SGO_HOST_HML=hml.exemplo.org run "$SCRIPT"
  [ "$status" -eq 2 ]
  [ ! -e "$T/docker.args" ]
  SGO_BASE=https://hml.exemplo.org SGO_HOST_HML=hml.exemplo.org SGO_JANELA_PO=sim run "$SCRIPT"
  [ "$status" -eq 0 ]
}

@test "teto da D-P7-1: de 1 a 20 usuários e no máximo 25 min" {
  for v in 0 21 500 abc -1; do
    SGO_BASE=http://127.0.0.1:3200 SGO_VUS="$v" run "$SCRIPT"
    [ "$status" -eq 2 ]
  done
  for d in 26m 1501s 0s 2h abc; do
    SGO_BASE=http://127.0.0.1:3200 SGO_DURACAO="$d" run "$SCRIPT"
    [ "$status" -eq 2 ]
  done
  SGO_BASE=http://127.0.0.1:3200 SGO_VUS=20 SGO_DURACAO=25m run "$SCRIPT"
  [ "$status" -eq 0 ]
  grep -q 'run --quiet --include-system-env-vars -' "$T/docker.args"
}
