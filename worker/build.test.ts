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
  it('builda, sem o argon2 nativo e com o stub no lugar', () => {
    const saida = join(pasta, 'index.mjs');
    execFileSync(process.execPath, ['worker/build.mjs', saida], { stdio: 'pipe' });
    const codigo = readFileSync(saida, 'utf8');
    expect(codigo).toContain('[WORKER_SEM_ARGON2]');
    expect(codigo).not.toMatch(/argon2-linux|\.node['"]/);
  }, 60_000);
});
