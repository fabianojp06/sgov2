import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';
import { validarShadow } from './src/shared/config/env';

// Prisma 7 não lê .env sozinho: o dev usa o .env.local (fora do git). Variáveis já
// definidas no ambiente (CI, testes) têm precedência, porque loadEnvFile não sobrescreve.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

// Migrations rodam com sgo_migrator; o shadow só pode ser um banco *_shadow do dev local (spec §11.5).
const url = process.env.MIGRATE_DATABASE_URL || undefined;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL || undefined;
if (url) validarShadow(url, shadowDatabaseUrl);

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: {
    ...(url ? { url } : {}),
    ...(url && shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
