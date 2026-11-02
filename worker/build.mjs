// Bundle do worker para a imagem de produção (P3, Tarefa 4, Step 10): um arquivo só, com as
// dependências dentro, porque a imagem não leva node_modules além do que o Next.js standalone
// rastreia. Uso: node worker/build.mjs <arquivo de saída> [metafile.json]  (fora do repositório;
// a imagem usa /opt/worker/index.mjs no estágio de build). O metafile serve ao worker/bundle.test.ts.
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const [saida, metafile] = process.argv.slice(2);
if (!saida) {
  console.error('Uso: node worker/build.mjs <arquivo de saída> [metafile.json]');
  process.exit(64);
}

const resultado = await build({
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
  metafile: Boolean(metafile),
});
if (metafile) writeFileSync(metafile, JSON.stringify(resultado.metafile));
