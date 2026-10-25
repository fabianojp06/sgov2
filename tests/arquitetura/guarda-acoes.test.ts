import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Guarda obrigatória (US-008, spec §11): toda Server Action é criada com definirAcao e todo
// Route Handler com definirRota. A verificação usa a árvore sintática do TypeScript, não regex:
// comentários, strings, vários declaradores e expressões compostas não escapam.
const raiz = process.cwd();
const METODOS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const EXTENSOES = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

function analisar(texto: string, nome = 'arquivo.tsx'): ts.SourceFile {
  return ts.createSourceFile(nome, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const ehDiretiva = (s: ts.Statement) =>
  ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === 'use server';

const exportado = (s: ts.Statement) =>
  ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const chamada = (e: ts.Expression | undefined, nome: string) =>
  e !== undefined && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === nome;

// Problemas de exportação: só `export const x = <fabrica>(...)`, um declarador por nome.
function exportacoes(arquivo: ts.SourceFile, fabrica: string, filtro: (nome: string) => boolean): string[] {
  const problemas: string[] = [];
  for (const s of arquivo.statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.isTypeOnly) problemas.push(`export { } / export * (use ${fabrica} no próprio arquivo)`);
      continue;
    }
    if (ts.isExportAssignment(s)) {
      problemas.push(`export default sem ${fabrica}`);
      continue;
    }
    if (!exportado(s)) continue;
    if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) continue;
    if (ts.isVariableStatement(s)) {
      const constante = (s.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of s.declarationList.declarations) {
        const nome = ts.isIdentifier(d.name) ? d.name.text : d.name.getText(arquivo);
        if (!ts.isIdentifier(d.name)) problemas.push(`${nome}: exportação por desestruturação`);
        else if (!filtro(nome)) continue;
        else if (!constante) problemas.push(`${nome}: use const`);
        else if (!chamada(d.initializer, fabrica)) problemas.push(`${nome} não usa ${fabrica}`);
      }
      continue;
    }
    const nome = (s as { name?: ts.Identifier }).name?.text ?? 'default';
    if (filtro(nome)) problemas.push(`${nome}: declarado sem ${fabrica}`);
  }
  return problemas;
}

function diretivasInternas(arquivo: ts.SourceFile): number {
  let total = 0;
  const visitar = (n: ts.Node): void => {
    if ((ts.isBlock(n) || ts.isModuleBlock(n)) && n.statements.some(ehDiretiva)) total++;
    ts.forEachChild(n, visitar);
  };
  ts.forEachChild(arquivo, visitar);
  return total;
}

export function problemasDeAcao(texto: string): string[] {
  const arquivo = analisar(texto);
  const problemas: string[] = [];
  if (diretivasInternas(arquivo) > 0) problemas.push("'use server' fora do topo do arquivo (Server Action inline)");
  const prologo = arquivo.statements.findIndex((s) => !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)));
  const topo = arquivo.statements.slice(0, prologo === -1 ? undefined : prologo);
  if (!topo.some(ehDiretiva)) return problemas;
  return [...problemas, ...exportacoes(arquivo, 'definirAcao', () => true)];
}

export function problemasDeRota(texto: string): string[] {
  return exportacoes(analisar(texto), 'definirRota', (nome) => METODOS.has(nome));
}

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    if (nome === 'node_modules' || nome === 'generated') return [];
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? listar(caminho) : [caminho];
  });
}

function varrer(dir: string): string[] {
  return listar(dir)
    .filter((a) => EXTENSOES.test(a))
    .flatMap((a) => {
      const texto = readFileSync(a, 'utf8');
      const rota = /^route\.\w+$/.test(a.split('/').pop() ?? '');
      const problemas = [...problemasDeAcao(texto), ...(rota ? problemasDeRota(texto) : [])];
      return problemas.map((p) => `${relative(raiz, a)}: ${p}`);
    });
}

const FIXTURES = join(raiz, 'tests/arquitetura/fixtures/guarda');
const fixture = (nome: string) => readFileSync(join(FIXTURES, nome), 'utf8');

describe('guarda obrigatória: verificação contra fixtures', () => {
  it('ação sem guarda é reprovada', () => expect(problemasDeAcao(fixture('acao-sem-guarda.ts'))).not.toEqual([]));
  it('ação com definirAcao passa', () => expect(problemasDeAcao(fixture('acao-com-guarda.ts'))).toEqual([]));
  it('Server Action inline é reprovada', () => {
    expect(problemasDeAcao(fixture('acao-inline.tsx'))).toEqual([
      "'use server' fora do topo do arquivo (Server Action inline)",
    ]);
  });
  it('rota sem guarda é reprovada', () => expect(problemasDeRota(fixture('route-sem-guarda.ts'))).not.toEqual([]));
  it('rota com definirRota passa', () => expect(problemasDeRota(fixture('route-com-guarda.ts'))).toEqual([]));

  it('a varredura acha os problemas das fixtures (não passa vazia)', () => {
    const falhas = varrer(FIXTURES);
    expect(falhas.some((f) => f.includes('acao-sem-guarda'))).toBe(true);
    expect(falhas.some((f) => f.includes('acao-inline'))).toBe(true);
  });

  const U = "'use server';\n";
  it.each([
    [`${U}export const a = outraCoisa(1);`, 'a não usa definirAcao'],
    [`${U}export const b = 1;`, 'b não usa definirAcao'],
    [`${U}export default async function x() {}`, 'x: declarado sem definirAcao'],
    [`${U}const c = 1;\nexport { c };`, 'export { } / export * (use definirAcao no próprio arquivo)'],
    [`${U}const c = 1;\nexport{c};`, 'export { } / export * (use definirAcao no próprio arquivo)'],
    [`${U}export const a = definirAcao(1), b = async () => 1;`, 'b não usa definirAcao'],
    [`${U}export const s = definirAcao(1) || outra;`, 's não usa definirAcao'],
    [`${U}export let s = definirAcao(1);`, 's: use const'],
    [`${U}export const { a } = obj;`, '{ a }: exportação por desestruturação'],
    [`${U}export const s = definirAcao;`, 's não usa definirAcao'],
    [`${U}export async function\n  salvar() {}`, 'salvar: declarado sem definirAcao'],
    [`"use server";\nexport const s = 1;`, 's não usa definirAcao'],
    [`/* x */\n'use server';\nexport const s = 1;`, 's não usa definirAcao'],
    [`${U}const t = '/*';\nexport const s = 1;\nconst u = '*/';`, 's não usa definirAcao'],
    [`export const f = async () => { 'use server'; };`, "'use server' fora do topo do arquivo (Server Action inline)"],
  ])('ação: %j → %s', (codigo, problema) => expect(problemasDeAcao(codigo)).toContain(problema));

  it.each([
    [`${U}export const s = definirAcao({}, async () => 1);\nexport type T = string;`],
    [`import x from 'y';\nexport const s = 1;`],
  ])('ação aceita: %j', (codigo) => expect(problemasDeAcao(codigo)).toEqual([]));

  it.each([
    ['export const POST = async () => new Response();', 'POST não usa definirRota'],
    ["export { GET } from './outro';", 'export { } / export * (use definirRota no próprio arquivo)'],
    ['export const GET = definirRota(1), POST = async () => 1;', 'POST não usa definirRota'],
    ['export async function\n  PUT() {}', 'PUT: declarado sem definirRota'],
    ['export let GET = definirRota(1);', 'GET: use const'],
  ])('rota: %j → %s', (codigo, problema) => expect(problemasDeRota(codigo)).toContain(problema));
});

describe('guarda obrigatória: varredura de src/', () => {
  it('varre arquivos de verdade', () => expect(listar(join(raiz, 'src')).filter((a) => EXTENSOES.test(a)).length).toBeGreaterThan(0));

  it('toda Server Action usa definirAcao e todo Route Handler usa definirRota', () => {
    expect(varrer(join(raiz, 'src'))).toEqual([]);
  });

  it('não existe Pages Router (src/pages): ele não passaria pela guarda', () => {
    expect(() => statSync(join(raiz, 'src/pages'))).toThrow();
  });
});
