import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

// O aviso da desativação (US-036) é componente cliente do aut montado na casca: empacotado para o
// navegador, não pode alcançar código de servidor (Prisma, pg, Argon2, nodemailer) nem o aut fora de
// ui/ e domain/ (o mesmo padrão do bundle-cliente.test.ts do adm).
const PROIBIDOS = /node_modules\/(pg|pg-boss|pg-pool|@prisma|prisma|nodemailer|exceljs|argon2|@node-rs|server-only)\//;

describe('bundle do navegador dos componentes cliente do aut', () => {
  it('aviso-desativacao não alcança código de servidor', async () => {
    const r = await build({
      entryPoints: ['src/modules/aut/ui/aviso-desativacao.tsx'],
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      outdir: 'saida-bundle-aut',
      write: false,
      metafile: true,
      logLevel: 'silent',
      tsconfig: 'tsconfig.json',
      jsx: 'automatic',
    });
    const entradas = Object.keys(r.metafile.inputs);
    expect(entradas.filter((e) => PROIBIDOS.test(e))).toEqual([]);
    expect(entradas.filter((e) => /^src\/modules\/aut\/(application|infrastructure|index)/.test(e))).toEqual([]);
    expect(entradas.some((e) => e.startsWith('src/generated/'))).toBe(false);
    expect(entradas).toContain('src/modules/aut/ui/aviso-desativacao.tsx');
  }, 60_000);
});
