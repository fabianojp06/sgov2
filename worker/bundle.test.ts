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

  it.each(PROIBIDOS)('não leva %s', (_nome, padrao) => {
    expect(entradas.filter((e) => padrao.test(e))).toEqual([]);
  });
});
