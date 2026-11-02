import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Spec §5 (RNF0002 do EP084): estado de tela nunca vai para o localStorage. Percorre a AST de
// src/**/*.{ts,tsx} (sem os testes); comentários e strings não contam.
function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome !== 'generated') arquivos(caminho, acc);
    } else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

function usos(nome: string, codigo: string): number {
  const fonte = ts.createSourceFile(nome, codigo, ts.ScriptTarget.Latest, true);
  let n = 0;
  const visitar = (no: ts.Node) => {
    if (ts.isIdentifier(no) && no.text === 'localStorage') n++;
    // window['localStorage'] e afins.
    if (ts.isElementAccessExpression(no) && ts.isStringLiteralLike(no.argumentExpression) && no.argumentExpression.text === 'localStorage') n++;
    // Desestruturação e chave literal ou computada: { 'localStorage': x } = window, { ['localStorage']: x }.
    const chave = ts.isBindingElement(no) ? no.propertyName : ts.isPropertyAssignment(no) ? no.name : undefined;
    if (chave) {
      const nome = chave;
      const texto = ts.isStringLiteralLike(nome)
        ? nome.text
        : ts.isComputedPropertyName(nome) && ts.isStringLiteralLike(nome.expression)
          ? nome.expression.text
          : undefined;
      if (texto === 'localStorage') n++;
    }
    // Reflect.get(window, 'localStorage').
    if (ts.isCallExpression(no) && no.arguments.some((a) => ts.isStringLiteralLike(a) && a.text === 'localStorage') && /Reflect\.get$/.test(no.expression.getText())) n++;
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return n;
}

describe('sem localStorage', () => {
  it('nenhum arquivo de src/ usa localStorage', () => {
    const raiz = join(process.cwd(), 'src');
    const com = arquivos(raiz)
      .filter((f) => usos(f, readFileSync(f, 'utf8')) > 0)
      .map((f) => f.slice(raiz.length + 1));
    expect(com).toEqual([]);
  });

  it('o detector pega identificador e acesso por string, e ignora comentário e string solta', () => {
    const tmp = (codigo: string) => usos('x.tsx', codigo);
    expect(tmp('localStorage.setItem("a", "b")')).toBe(1);
    expect(tmp('window["localStorage"].clear()')).toBe(1);
    expect(tmp('// localStorage aqui\nconst s = "localStorage";')).toBe(0);
    for (const uso of [
      'globalThis.localStorage.getItem("a")',
      'self.localStorage.clear()',
      'window?.localStorage.clear()',
      'const { localStorage } = window;',
      'const { localStorage: ls } = window;',
      'const { "localStorage": ls } = window;',
      'const { ["localStorage"]: ls } = window;',
      'Reflect.get(window, "localStorage")',
    ]) {
      expect(tmp(uso), uso).toBeGreaterThan(0);
    }
  });
});
