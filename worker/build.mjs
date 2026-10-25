// Bundle do worker para a imagem de produção (P3, Tarefa 4, Step 10): um arquivo só, com as
// dependências dentro, porque a imagem não leva node_modules além do que o Next.js standalone
// rastreia. Uso: node worker/build.mjs <arquivo de saída>  (fora do repositório; a imagem usa
// /opt/worker/index.mjs no estágio de build).
import { build } from 'esbuild';

const saida = process.argv[2];
if (!saida) {
  console.error('Uso: node worker/build.mjs <arquivo de saída>');
  process.exit(64);
}

await build({
  entryPoints: ['worker/index.ts'],
  outfile: saida,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  tsconfig: 'tsconfig.json',
  sourcemap: 'linked',
  // Só arquivo e linha nas pilhas (--enable-source-maps), sem o código-fonte dentro da imagem.
  sourcesContent: false,
  // Dependências CommonJS com require() de módulos do Node dentro de um bundle ESM.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
