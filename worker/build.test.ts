import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// O bundle do worker (worker/build.mjs) builda: um import que puxe módulo nativo quebraria o
// RUN node worker/build.mjs da imagem (revisão 12.12 da Task 4c do P4).
const pasta = mkdtempSync(join(tmpdir(), 'sgo-worker-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('bundle do worker', () => {
  it('builda, sem o argon2', () => {
    const saida = join(pasta, 'index.mjs');
    execFileSync(process.execPath, ['worker/build.mjs', saida], { stdio: 'pipe' });
    const codigo = readFileSync(saida, 'utf8');
    // O worker nunca gera nem confere senha: a seed do cad usa o adm/servidor.ts, sem login nem
    // senha. Um import que volte a alcançar o @node-rs/argon2 (módulo nativo) reprova aqui.
    expect(codigo).not.toMatch(/argon2/i);
  }, 60_000);
});
