import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

// O index.ts do ger é importado por componentes cliente (GradeArvore, Formulario): empacotado para
// o navegador, ele não pode alcançar código de servidor, nem por import dinâmico (o empacotador
// cria um chunk para cada um). Plano do P4, Review Focus 10.
const PROIBIDOS = /node_modules\/(pg|pg-boss|pg-pool|@prisma|prisma|nodemailer|exceljs|pdf-lib|@anthropic-ai|smtp-server|server-only)\//;

describe('bundle do navegador do ger', () => {
  it('o index.ts não alcança pg, pg-boss, Prisma, nodemailer, ExcelJS nem módulos do Node', async () => {
    const r = await build({
      entryPoints: ['src/modules/ger/index.ts'],
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      outdir: 'saida-bundle-ger',
      write: false,
      metafile: true,
      logLevel: 'silent',
      tsconfig: 'tsconfig.json',
      jsx: 'automatic',
    });
    const entradas = Object.keys(r.metafile.inputs);
    expect(entradas.filter((e) => PROIBIDOS.test(e))).toEqual([]);
    expect(entradas.some((e) => e.startsWith('src/generated/'))).toBe(false);
  }, 60_000);
});
