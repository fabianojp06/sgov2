// Bundle da seed para a imagem (#195): o prisma/seed.ts num arquivo só, como o worker, porque a
// imagem não leva o tsx (devDependency). Uso: node docker/seed/build.mjs <arquivo de saída>
// (a imagem usa /app/seed/seed.mjs). O @node-rs/argon2 fica de fora: o binário nativo vem do
// /app/node_modules do standalone (passo 1b do testar-imagem.sh).
import { build } from 'esbuild';

const [saida] = process.argv.slice(2);
if (!saida) {
  console.error('Uso: node docker/seed/build.mjs <arquivo de saída>');
  process.exit(64);
}

await build({
  entryPoints: ['prisma/seed.ts'],
  outfile: saida,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  tsconfig: 'tsconfig.json',
  jsx: 'automatic',
  external: ['@node-rs/argon2'],
  // Dependências CommonJS com require() de módulos do Node dentro de um bundle ESM.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
