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

// O worker importa o servidor.ts do cad, que reexporta as seeds; a seed do cad usa o index.ts do adm,
// que alcança o @node-rs/argon2 (módulo nativo, sem lugar no bundle). O worker nunca gera nem confere
// senha: o pacote vira um stub que lança erro se for chamado. Sai quando o adm tiver um servidor.ts
// sem login nem senha (issue para a frente A).
const semArgon2 = {
  name: 'sem-argon2',
  setup(b) {
    b.onResolve({ filter: /^@node-rs\/argon2$/ }, () => ({ path: 'argon2', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents:
        "const erro = () => { throw new Error('[WORKER_SEM_ARGON2] o worker não gera nem confere senha'); };" +
        'export const hash = erro; export const verify = erro;',
      loader: 'js',
    }));
  },
};

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
  plugins: [semArgon2],
});
if (metafile) writeFileSync(metafile, JSON.stringify(resultado.metafile));
