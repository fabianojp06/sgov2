import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A TelaPrincipal já é o <main> da área logada: páginas e telas da frente A dentro dela não abrem outro
// (dois landmarks main confundem o leitor de tela). A casca (tela-principal, erro-carregamento) fica fora.
const RAIZES = ['src/app/(sistema)/aut', 'src/app/(sistema)/adm', 'src/app/(sistema)/orc', 'src/app/(sistema)/apr', 'src/modules/adm/ui', 'src/modules/orc/ui'];
const CASCA = new Set(['tela-principal.tsx', 'erro-carregamento.tsx']);

function arquivos(dir: string): string[] {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return [];
  }
  return entradas.flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx$/.test(nome) && !nome.includes('.test.') && !CASCA.has(nome) ? [caminho] : [];
  });
}

describe('um <main> só na área logada', () => {
  it('páginas e telas da frente A dentro da TelaPrincipal não abrem outro <main>', () => {
    const lista = RAIZES.flatMap(arquivos);
    expect(lista.length).toBeGreaterThan(10);
    expect(lista.filter((f) => /<main[\s>]/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
