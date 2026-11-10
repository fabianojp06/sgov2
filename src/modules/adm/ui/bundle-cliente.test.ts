import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

// Os componentes cliente do adm recebem ações e dados por props e só importam o index do ger (feito
// para o navegador): empacotados, não podem alcançar código de servidor (Prisma, pg, Argon2,
// nodemailer) nem o próprio adm fora de ui/.
const PROIBIDOS = /node_modules\/(pg|pg-boss|pg-pool|@prisma|prisma|nodemailer|exceljs|argon2|@node-rs|server-only)\//;

describe('bundle do navegador dos componentes cliente do adm', () => {
  it('form-usuario e form-alcada não alcançam código de servidor', async () => {
    const r = await build({
      entryPoints: ['src/modules/adm/ui/form-usuario.tsx', 'src/modules/adm/ui/form-alcada.tsx'],
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      outdir: 'saida-bundle-adm',
      write: false,
      metafile: true,
      logLevel: 'silent',
      tsconfig: 'tsconfig.json',
      jsx: 'automatic',
    });
    const entradas = Object.keys(r.metafile.inputs);
    expect(entradas.filter((e) => PROIBIDOS.test(e))).toEqual([]);
    expect(entradas.filter((e) => /^src\/modules\/adm\/(application|infrastructure|index)/.test(e))).toEqual([]);
    expect(entradas.some((e) => e.startsWith('src/generated/'))).toBe(false);
  }, 60_000);
});
