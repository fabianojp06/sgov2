#!/usr/bin/env bats
# O migrador da imagem (docker/migrador) usa as mesmas versões de prisma e zod do projeto.

@test "prisma e zod do migrador iguais aos do package-lock.json do projeto" {
  raiz="$BATS_TEST_DIRNAME/../.."
  for pacote in prisma zod; do
    projeto=$(jq -r ".packages[\"node_modules/$pacote\"].version" "$raiz/package-lock.json")
    migrador=$(jq -r ".packages[\"node_modules/$pacote\"].version" "$raiz/docker/migrador/package-lock.json")
    echo "$pacote: projeto=$projeto migrador=$migrador"
    [ "$projeto" != null ] && [ "$projeto" = "$migrador" ]
  done
}
