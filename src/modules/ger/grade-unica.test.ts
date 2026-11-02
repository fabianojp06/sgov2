import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R18: uma Tree Grid só no sistema. Nenhum outro arquivo de src/ monta um role="treegrid".
function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome !== 'generated') arquivos(caminho, acc);
    } else if (/\.(tsx?|jsx?)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

describe('grade única', () => {
  it('só ger/ui/grade-arvore.tsx contém role="treegrid" em src/', () => {
    const raiz = join(process.cwd(), 'src');
    const comTreegrid = arquivos(raiz)
      .filter((f) => /role=["']treegrid["']/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(raiz.length + 1));
    expect(comTreegrid).toEqual(['modules/ger/ui/grade-arvore.tsx']);
  });
});
