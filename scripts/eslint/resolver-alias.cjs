// Resolvedor de reserva para o eslint-plugin-boundaries: traduz o alias `@/` para `src/`
// mesmo quando o arquivo ainda não existe. Assim a fronteira é checada pelo caminho
// (os testes de arquitetura usam caminhos fictícios) e um import de módulo ainda não
// criado também é classificado. Arquivos inexistentes são apontados pelo `tsc`.
const fs = require('node:fs');
const path = require('node:path');

const EXTENSOES = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

exports.interfaceVersion = 2;

exports.resolve = function resolve(fonte, _arquivo, opcoes) {
  if (!fonte.startsWith('@/')) return { found: false };
  const raiz = (opcoes && opcoes.raiz) || process.cwd();
  const base = path.join(raiz, 'src', fonte.slice(2));
  const candidatos = [
    base,
    ...EXTENSOES.map((e) => base + e),
    ...EXTENSOES.map((e) => path.join(base, 'index' + e)),
  ];
  const existente = candidatos.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (existente) return { found: true, path: existente };
  // Inexistente: pasta de módulo/shared sem subcaminho vira o index.ts; o resto vira <base>.ts.
  const relativo = fonte.slice(2).split('/');
  const ehRaizDeElemento =
    (relativo[0] === 'modules' || relativo[0] === 'shared') && relativo.length === 2;
  return { found: true, path: ehRaizDeElemento ? path.join(base, 'index.ts') : base + '.ts' };
};
