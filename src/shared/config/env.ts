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
  if (!ehDevLocal(shadowUrl)) {
    throw new Error('shadow fora do dev local (spec §11.5)');
  }
  if (!shadow.pathname.replace(/^\//, '').endsWith('_shadow')) {
    throw new Error('o banco shadow deve terminar em _shadow');
  }
}

// O driver e o Prisma honram host, hostaddr e port na query string, que trocariam o destino.
const PARAMETROS_DE_DESTINO = new Set(['host', 'hostaddr', 'port']);

function ehDevLocal(url: string): boolean {
  const { hostname, port, searchParams } = new URL(url);
  const desviaDestino = [...searchParams.keys()].some((chave) => PARAMETROS_DE_DESTINO.has(chave.toLowerCase()));
  return HOSTS_DEV.has(hostname) && PORTAS_DEV.has(port) && !desviaDestino;
}

// Comandos que podem apagar ou recriar o banco (spec §11.5) só rodam contra o dev local.
// Chamado pelo prisma.config.ts com o argv do CLI: cobre qualquer alias de npm, que o
// hook das sessões (que lê só o texto do comando) não enxerga.
const COMANDOS_DESTRUTIVOS = [
  ['migrate', 'dev'],
  ['migrate', 'reset'],
  ['migrate', 'diff'],
  ['db', 'push'],
  ['db', 'execute'], // roda SQL arbitrário contra o banco da config
];

export function validarComandoPrisma(argv: readonly string[], url: string | undefined): void {
  // Ignora "--" e flags entre o comando e o subcomando ("migrate -- dev" também é migrate dev).
  const posicionais = argv.filter((arg) => !arg.startsWith('-'));
  const destrutivo = COMANDOS_DESTRUTIVOS.find(([a, b]) =>
    posicionais.some((arg, i) => arg === a && posicionais[i + 1] === b),
  );
  if (!destrutivo || (url !== undefined && ehDevLocal(url))) return;
  throw new Error(
    `prisma ${destrutivo.join(' ')} só contra o banco de dev local (127.0.0.1:55432 ou 127.0.0.1:56432), spec §11.5`,
  );
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
