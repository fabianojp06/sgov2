import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

// Os componentes cliente do orc recebem ações e dados por props e só importam o index do ger:
// empacotados, não podem alcançar código de servidor nem o próprio orc fora de ui/ e domain/.
const PROIBIDOS = /node_modules\/(pg|pg-boss|pg-pool|@prisma|prisma|nodemailer|exceljs|argon2|@node-rs|server-only)\//;

describe('bundle do navegador dos componentes cliente do orc', () => {
  it('form-exercicio, form-receita, form-importacao, form-pacote e form-posicao não alcançam código de servidor', async () => {
    const r = await build({
      entryPoints: ['src/modules/orc/ui/form-exercicio.tsx', 'src/modules/orc/ui/form-receita.tsx', 'src/modules/orc/ui/form-importacao.tsx', 'src/modules/orc/ui/form-pacote.tsx', 'src/modules/orc/ui/form-posicao.tsx'],
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      outdir: 'saida-bundle-orc',
      write: false,
      metafile: true,
      logLevel: 'silent',
      tsconfig: 'tsconfig.json',
      jsx: 'automatic',
    });
    const entradas = Object.keys(r.metafile.inputs);
    expect(entradas.filter((e) => PROIBIDOS.test(e))).toEqual([]);
    expect(entradas.filter((e) => /^src\/modules\/(orc|cad|adm)\/(application|infrastructure|index|servidor)/.test(e))).toEqual([]);
    expect(entradas.some((e) => e.startsWith('src/generated/'))).toBe(false);
  }, 60_000);
});
