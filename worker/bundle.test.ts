import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// O bundle real do worker (worker/build.mjs) não leva código de tela nem de autorização de página
// (plano do P4, R22 e I13): os módulos entram só pelo servidor.ts.
const dir = mkdtempSync(join(tmpdir(), 'sgo-worker-bundle-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PROIBIDOS: [string, RegExp][] = [
  ['react', /node_modules\/react\//],
  ['react-dom', /node_modules\/react-dom\//],
  ['next', /node_modules\/next\//],
  ['server-only', /node_modules\/server-only\//],
  ['@/shared/authz', /^src\/shared\/authz\//],
  ['componentes .tsx', /\.tsx$/],
];

describe('bundle do worker', () => {
  const metafile = join(dir, 'meta.json');
  execFileSync('node', ['worker/build.mjs', join(dir, 'index.mjs'), metafile], { stdio: 'pipe', timeout: 60_000 });
  const entradas = Object.keys((JSON.parse(readFileSync(metafile, 'utf8')) as { inputs: object }).inputs);

  it('leva o trabalhador de e-mail do ger', () => {
    expect(entradas).toContain('src/modules/ger/infrastructure/trabalhador-email.ts');
  });

  // US-024: o trabalhador da exportação assíncrona e os geradores do cad (sem os casos de uso com authz).
  it('leva a exportação assíncrona do ger e os geradores do cad', () => {
    expect(entradas).toContain('src/modules/ger/infrastructure/exportacao-assincrona.ts');
    expect(entradas).toContain('src/modules/cad/application/planilha-estrutura.ts');
    expect(entradas).not.toContain('src/modules/cad/application/exportar-estrutura.ts');
  });

  // US-040 (frente A, #372, pedido na #138): o gerador do Histórico entra; o caso de uso da tela, com
  // authz e server-only, não.
  it('leva o gerador do Histórico do adm, sem o caso de uso da tela', () => {
    expect(entradas).toContain('src/modules/adm/application/planilha-historico.ts');
    expect(entradas).not.toContain('src/modules/adm/application/historico.ts');
  });

  // E-N4: o nome de exibição sai do cad pelo servidor.ts, sem puxar os casos de uso (que exigem permissão).
  it('leva o obterParametroSistema do cad, sem os casos de uso dos parâmetros', () => {
    expect(entradas).toContain('worker/nome-exibicao.ts');
    expect(entradas).toContain('src/modules/cad/infrastructure/parametro-sistema.ts');
    // O saneamento (puro) entra pelo processador de cargas; os casos de uso e as ações, nunca.
    expect(entradas.filter((e) => /^src\/modules\/cad\/application\/(parametros|tela-parametros|acoes-)/.test(e))).toEqual([]);
  });

  it.each(PROIBIDOS)('não leva %s', (_nome, padrao) => {
    expect(entradas.filter((e) => padrao.test(e))).toEqual([]);
  });
});
