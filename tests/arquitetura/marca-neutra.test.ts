import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encontrarMarcaVedada } from '@/shared/config/marca';

// Marca neutra (spec §6.7, US-012): a sigla da instituição não aparece no sistema.
// Este teste fica em tests/, fora das pastas varridas, e por isso pode citar a sigla.
const raiz = process.cwd();
const PASTAS = ['src', 'prisma', 'worker'];
const IGNORAR = new Set(['node_modules', 'generated', '.next']);

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    if (IGNORAR.has(nome)) return [];
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? listar(caminho) : [caminho];
  });
}

describe('marca neutra', () => {
  it('encontrarMarcaVedada acha todas as ocorrências, sem diferenciar maiúsculas', () => {
    expect(encontrarMarcaVedada('Provisão p/plano CTCEA e ctcea')).toEqual(['CTCEA', 'ctcea']);
    expect(encontrarMarcaVedada('Provisão da instituição')).toEqual([]);
  });

  it('src/, prisma/ e worker/ não contêm a marca vedada', () => {
    const comMarca = PASTAS.map((p) => join(raiz, p))
      .filter((p) => existsSync(p))
      .flatMap(listar)
      .filter((arquivo) => encontrarMarcaVedada(readFileSync(arquivo, 'utf8')).length > 0)
      .map((arquivo) => relative(raiz, arquivo));
    expect(comMarca, `Arquivos com a marca vedada (spec §6.7): ${comMarca.join(', ')}`).toEqual([]);
  });
});
