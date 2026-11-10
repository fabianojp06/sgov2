import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

// Os componentes cliente do adm recebem ações e dados por props e só importam o index do ger (feito
// para o navegador): empacotados, não podem alcançar código de servidor (Prisma, pg, Argon2,
// nodemailer) nem o próprio adm fora de ui/.
const PROIBIDOS = /node_modules\/(pg|pg-boss|pg-pool|@prisma|prisma|nodemailer|exceljs|argon2|@node-rs|server-only)\//;

describe('bundle do navegador dos componentes cliente do adm', () => {
  it('form-usuario, form-alcada, form-perfil, lista-perfis, botao-imprimir, desativar-sistema e tela-notificacoes não alcançam código de servidor', async () => {
    const r = await build({
      entryPoints: ['src/modules/adm/ui/form-usuario.tsx', 'src/modules/adm/ui/form-alcada.tsx', 'src/modules/adm/ui/form-perfil.tsx', 'src/modules/adm/ui/lista-perfis.tsx', 'src/modules/adm/ui/botao-imprimir.tsx', 'src/modules/adm/ui/desativar-sistema.tsx', 'src/modules/adm/ui/tela-notificacoes.tsx'],
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

  // O index do ger (frente B) ainda leva o kernel ao bundle de qualquer tela cliente; o que este teste
  // garante é que o adm não acrescenta caminho próprio até ele: a tela usa só os textos puros.
  it('tela-notificacoes leva só os textos das notificações: nenhum arquivo do adm importa o kernel nem o domínio com ele', async () => {
    const r = await build({
      entryPoints: ['src/modules/adm/ui/tela-notificacoes.tsx'],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      metafile: true,
      logLevel: 'silent',
      tsconfig: 'tsconfig.json',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'next'],
    });
    const entradas = Object.keys(r.metafile.inputs);
    expect(entradas).toContain('src/modules/adm/domain/notificacao-textos.ts');
    expect(entradas).not.toContain('src/modules/adm/domain/notificacao.ts');
    const admParaKernel = Object.entries(r.metafile.inputs)
      .filter(([arquivo]) => arquivo.startsWith('src/modules/adm/'))
      .flatMap(([arquivo, i]) => i.imports.filter((imp) => imp.path.startsWith('src/shared/kernel/')).map(() => arquivo));
    expect(admParaKernel).toEqual([]);
  }, 60_000);

  // US-037: o formulário de perfil usa só os textos puros (perfil-textos.ts), nunca o domínio com o Zod
  // e o kernel (perfil.ts).
  it('form-perfil leva só os textos do perfil, não o domínio com a validação', async () => {
    const r = await build({
      entryPoints: ['src/modules/adm/ui/form-perfil.tsx'],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      metafile: true,
      logLevel: 'silent',
      tsconfig: 'tsconfig.json',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'next'],
    });
    const entradas = Object.keys(r.metafile.inputs);
    expect(entradas).toContain('src/modules/adm/domain/perfil-textos.ts');
    expect(entradas).not.toContain('src/modules/adm/domain/perfil.ts');
    expect(entradas).not.toContain('src/modules/adm/domain/perfis.ts');
  }, 60_000);
});
