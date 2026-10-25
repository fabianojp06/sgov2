import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guarda obrigatória (US-008, spec §11): toda Server Action é criada com definirAcao e todo
// Route Handler com definirRota. A verificação é textual e deliberadamente conservadora.
const raiz = process.cwd();
const METODOS = 'GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS';

function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const ehUseServer = (texto: string) => /^\s*['"]use server['"]\s*;?/.test(semComentarios(texto));

export function problemasDeAcao(texto: string): string[] {
  const codigo = semComentarios(texto);
  const problemas: string[] = [];
  const diretivas = codigo.match(/['"]use server['"]/g) ?? [];
  const noTopo = ehUseServer(codigo);
  if (diretivas.length > (noTopo ? 1 : 0)) problemas.push("'use server' fora do topo do arquivo (Server Action inline)");
  if (!noTopo) return problemas;
  if (/export\s+(default\b|async\s+function|function\b|\{|\*)/.test(codigo)) {
    problemas.push('exportação que não é const criada com definirAcao');
  }
  for (const m of codigo.matchAll(/export\s+(?:const|let|var)\s+(\w+)[^=]*=\s*(\S+)/g)) {
    if (!/^definirAcao[<(]/.test(m[2] ?? '')) problemas.push(`${m[1]} não usa definirAcao`);
  }
  return problemas;
}

export function problemasDeRota(texto: string): string[] {
  const codigo = semComentarios(texto);
  const problemas: string[] = [];
  if (new RegExp(`export\\s+(async\\s+)?function\\s+(${METODOS})\\b`).test(codigo)) {
    problemas.push('handler declarado como function, sem definirRota');
  }
  if (/export\s*\{|export\s+\*/.test(codigo)) problemas.push('reexportação de handler (use definirRota no próprio arquivo)');
  for (const m of codigo.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+(${METODOS})\\b[^=]*=\\s*(\\S+)`, 'g'))) {
    if (!/^definirRota[<(]/.test(m[2] ?? '')) problemas.push(`${m[1]} não usa definirRota`);
  }
  return problemas;
}

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    if (nome === 'node_modules' || nome === 'generated') return [];
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? listar(caminho) : [caminho];
  });
}

const fixture = (nome: string) => readFileSync(join(raiz, 'tests/arquitetura/fixtures/guarda', nome), 'utf8');

describe('guarda obrigatória: verificação contra fixtures', () => {
  it('ação sem guarda é reprovada', () => {
    expect(problemasDeAcao(fixture('acao-sem-guarda.ts'))).not.toEqual([]);
  });
  it('ação com definirAcao passa', () => expect(problemasDeAcao(fixture('acao-com-guarda.ts'))).toEqual([]));
  it('Server Action inline é reprovada', () => {
    expect(problemasDeAcao(fixture('acao-inline.tsx'))).toEqual([
      "'use server' fora do topo do arquivo (Server Action inline)",
    ]);
  });
  it('rota sem guarda é reprovada', () => expect(problemasDeRota(fixture('route-sem-guarda.ts'))).not.toEqual([]));
  it('rota com definirRota passa', () => expect(problemasDeRota(fixture('route-com-guarda.ts'))).toEqual([]));

  it.each([
    ["'use server';\nexport const a = outraCoisa(1);", 'a não usa definirAcao'],
    ["'use server';\nexport const b = 1;", 'b não usa definirAcao'],
    ["'use server';\nexport default async function x() {}", 'exportação que não é const criada com definirAcao'],
    ["'use server';\nconst c = 1;\nexport { c };", 'exportação que não é const criada com definirAcao'],
  ])('ação: %j → %s', (codigo, problema) => expect(problemasDeAcao(codigo)).toContain(problema));

  it.each([
    ['export const POST = async () => new Response();', 'POST não usa definirRota'],
    ["export { GET } from './outro';", 'reexportação de handler (use definirRota no próprio arquivo)'],
  ])('rota: %j → %s', (codigo, problema) => expect(problemasDeRota(codigo)).toContain(problema));
});

describe('guarda obrigatória: varredura de src/', () => {
  const arquivos = listar(join(raiz, 'src')).filter((a) => /\.(ts|tsx)$/.test(a));

  it('toda Server Action usa definirAcao', () => {
    const falhas = arquivos.flatMap((a) =>
      problemasDeAcao(readFileSync(a, 'utf8')).map((p) => `${relative(raiz, a)}: ${p}`),
    );
    expect(falhas).toEqual([]);
  });

  it('todo Route Handler usa definirRota', () => {
    const falhas = arquivos
      .filter((a) => /^route\.(ts|tsx)$/.test(a.split('/').pop() ?? ''))
      .flatMap((a) => problemasDeRota(readFileSync(a, 'utf8')).map((p) => `${relative(raiz, a)}: ${p}`));
    expect(falhas).toEqual([]);
  });
});
