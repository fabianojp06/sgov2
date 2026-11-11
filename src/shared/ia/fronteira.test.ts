import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// A IA só pela governança (US-019): fora de src/shared/ia, ninguém cria o provedor nem importa os
// arquivos internos; os módulos usam o servicoIA (ou o criarServicoIA nos testes).
const RAIZ = process.cwd();
const PROIBIDO = /criarProvedorIA\b|criarProvedorAnthropic|@\/shared\/ia\/(?!index\b)|@anthropic-ai\/sdk/;

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'generated' ? [] : arquivos(caminho);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [caminho] : [];
  });
}

describe('fronteira da IA', () => {
  it('fora de src/shared/ia, nada cria o provedor nem importa o SDK', () => {
    const violacoes = [...arquivos(join(RAIZ, 'src')), ...arquivos(join(RAIZ, 'worker'))]
      .map((a) => relative(RAIZ, a))
      .filter((a) => !a.startsWith('src/shared/ia/') && PROIBIDO.test(readFileSync(join(RAIZ, a), 'utf8')));
    expect(violacoes).toEqual([]);
  });
});
