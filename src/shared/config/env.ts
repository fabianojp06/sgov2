import { z } from 'zod';

// Variáveis de ambiente do núcleo (spec §11.5). A aplicação conecta com sgo_app (DATABASE_URL);
// as migrations rodam com sgo_migrator (MIGRATE_DATABASE_URL); o shadow só existe no dev local.
const HOSTS_DEV = new Set(['127.0.0.1', 'localhost']);
const PORTAS_DEV = new Set(['55432', '56432']);

const urlPostgres = z.string().regex(/^postgresql:\/\//, 'deve começar com postgresql://');

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: urlPostgres,
  MIGRATE_DATABASE_URL: urlPostgres.optional(),
  SHADOW_DATABASE_URL: urlPostgres.optional(),
});

export type Env = z.infer<typeof esquema>;

export function validarShadow(databaseUrl: string, shadowUrl: string | undefined): void {
  if (shadowUrl === undefined) return;
  if (shadowUrl === databaseUrl) throw new Error('shadow igual ao banco principal');
  const shadow = new URL(shadowUrl);
  if (!HOSTS_DEV.has(shadow.hostname) || !PORTAS_DEV.has(shadow.port)) {
    throw new Error('shadow fora do dev local (spec §11.5)');
  }
  if (!shadow.pathname.replace(/^\//, '').endsWith('_shadow')) {
    throw new Error('o banco shadow deve terminar em _shadow');
  }
}

export function lerEnv(fonte: Readonly<Record<string, string | undefined>> = process.env): Env {
  const resultado = esquema.safeParse(fonte);
  if (!resultado.success) {
    const problemas = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Variáveis de ambiente inválidas: ${problemas.join('; ')}`);
  }
  const env = resultado.data;
  validarShadow(env.MIGRATE_DATABASE_URL ?? env.DATABASE_URL, env.SHADOW_DATABASE_URL);
  return env;
}
