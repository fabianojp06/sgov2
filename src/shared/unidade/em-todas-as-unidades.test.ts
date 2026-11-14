import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// O caminho que amplia a RLS para todos os TPs (emTodasAsUnidades, US-101) só pode ser usado pelo Consolidado dos
// TPs (spec §6.7; revisão 12.12 do P31). Um uso novo precisa passar por decisão e entrar nesta lista.
const PERMITIDOS = ['src/modules/orc/application/consolidado.ts', 'src/modules/orc/application/consolidado.int.test.ts'];

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const caminho = join(dir, n);
    if (statSync(caminho).isDirectory()) return n === 'generated' ? [] : arquivos(caminho);
    return /\.(ts|tsx)$/.test(n) ? [caminho] : [];
  });
}

describe('emTodasAsUnidades', () => {
  it('só o Consolidado dos TPs usa o caminho', () => {
    const raiz = process.cwd();
    const usam = arquivos(join(raiz, 'src'))
      .map((f) => relative(raiz, f))
      .filter((f) => !f.startsWith('src/shared/unidade/'))
      .filter((f) => readFileSync(join(raiz, f), 'utf8').includes('emTodasAsUnidades'));
    expect(usam.sort()).toEqual([...PERMITIDOS].sort());
  });
});
