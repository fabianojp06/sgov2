# Imagem do SGO (US-013 parte 2/3, plano do P3, Tarefa 4): app Next.js standalone + migrador.
# O worker entra no Step 10, num PR próprio. Build:
#   docker build -f docker/app.Dockerfile -t sgo:local .
# O BuildKit lê o docker/app.Dockerfile.dockerignore (ignore específico deste Dockerfile).

# node:22.23-bookworm-slim, fixada por digest.
ARG NODE_IMAGE=node:22.23-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
# O Prisma escolhe o binário do schema engine pela versão do OpenSSL, e a imagem slim não o traz.
# Fica na base para o npm ci do migrador baixar a mesma variante (debian-openssl-3.0.x) que roda
# no estágio final: sem isso, o migrate deploy tenta baixar o binário certo na hora, sem rede.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
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
COPY --from=build --chown=node:node /src/.next/standalone ./
COPY --from=build --chown=node:node /src/.next/static ./.next/static
COPY --from=migrador --chown=node:node /opt/migrador /opt/migrador
COPY --chown=node:node docker/entrypoint.sh /app/docker/entrypoint.sh
USER node
EXPOSE 3000
# A migração roda antes do servidor: o start-period cobre uma migration demorada.
HEALTHCHECK --start-period=120s --interval=10s --timeout=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/login').then((r) => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["app"]
