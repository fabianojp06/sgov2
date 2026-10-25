# Imagem do SGO (US-013, plano do P3, Tarefa 4): app Next.js standalone, worker (bundle do
# esbuild, Step 10) e migrador. A mesma imagem sobe o app (CMD app) ou o worker (CMD worker). Build:
#   docker build -f docker/app.Dockerfile -t sgo:local .
# O BuildKit lê o docker/app.Dockerfile.dockerignore (ignore específico deste Dockerfile).

# node:22.23-bookworm-slim, fixada por digest.
ARG NODE_IMAGE=node:22.23-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
# O Prisma escolhe o binário do schema engine pela versão do OpenSSL, e a imagem slim não o traz.
# Fica na base para o npm ci do migrador baixar a mesma variante (debian-openssl-3.0.x) que roda
# no estágio final: sem isso, o migrate deploy tenta baixar o binário certo na hora, sem rede.
# tini como PID 1: repassa o SIGTERM do Easypanel e recolhe processos filhos (a migração roda
# antes do servidor, sob o bash do entrypoint).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl tini \
 && rm -rf /var/lib/apt/lists/*

# Dependências completas do projeto. O postinstall (prisma generate) precisa do schema,
# do prisma.config.ts e do env.ts que ele importa.
FROM base AS deps
WORKDIR /src
ENV NODE_OPTIONS=--max-old-space-size=1536
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY src/shared/config ./src/shared/config
RUN npm ci --no-audit --no-fund

# Build de produção (output: 'standalone' no next.config.ts).
FROM deps AS build
COPY . .
RUN npm run build
# Worker num arquivo só, com as dependências dentro: a imagem final não tem node_modules
# além do que o Next.js standalone rastreia.
RUN node worker/build.mjs /opt/worker/index.mjs

# Migrador autossuficiente: só prisma e zod, com lockfile próprio, sem as devDependencies do
# projeto. Contorna a issue #165 (o postinstall quebra um npm ci --omit=dev).
FROM base AS migrador
WORKDIR /opt/migrador
COPY docker/migrador/package.json docker/migrador/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src/shared/config/env.ts ./src/shared/config/env.ts

FROM base AS final
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# Arquivos do root, só leitura para o node: o processo não reescreve o próprio código, o
# entrypoint nem as migrations. O Next.js grava só no cache.
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /opt/worker /app/worker
COPY --from=migrador /opt/migrador /opt/migrador
COPY docker/entrypoint.sh docker/saude.sh /app/docker/
# Sem USER node: o tini e o entrypoint rodam como root, e o servidor desce para o node com
# setpriv no exec (entrypoint.sh). O ambiente do PID 1 fica fora do alcance do app.
RUN mkdir -p /app/.next/cache && chown node:node /app/.next/cache
EXPOSE 3000
# A migração roda antes do servidor: o start-period cobre uma migration demorada. No worker,
# o saude.sh responde pelo processo vivo.
HEALTHCHECK --start-period=120s --interval=10s --timeout=5s --retries=3 \
  CMD ["/app/docker/saude.sh"]
# -g: o SIGTERM vai para o grupo de processos, inclusive o prisma da migração.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/docker/entrypoint.sh"]
CMD ["app"]
