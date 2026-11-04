import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormExercicio } from './form-exercicio';
import { ListaExercicios, textoAviso } from './lista-exercicios';
import { SeletorExercicio } from './seletor-exercicio';

// Telas de exercício (US-055; plano do P6, Task 3).
const acao = async () => ({ ok: true as const, valor: undefined });
const exercicios = [
  { id: 'e2', ano: 2027, situacao: 'RASCUNHO', rotuloSituacao: 'Rascunho', versao: 3 },
  { id: 'e1', ano: 2026, situacao: 'OFICIALIZADO', rotuloSituacao: 'Oficializado', versao: 9 },
];
const lista = (p: Partial<Parameters<typeof ListaExercicios>[0]> = {}) =>
  renderToString(createElement(ListaExercicios, { exercicios, podeIncluir: true, podeAlterar: true, avancar: acao, ...p }));

describe('ListaExercicios', () => {
  it('ano e situação em tabela; Avançar só no Rascunho e com alterar; Novo só com incluir', () => {
    const h = lista();
    expect(h).toMatch(/<th scope="col">Ano<\/th>/);
    expect(h).toContain('Rascunho');
    expect(h).toContain('Avançar 2027 para Em Elaboração');
    expect(h).not.toContain('Avançar 2026');
    expect(h).toContain('href="/orc/exercicios/novo"');
    expect(lista({ podeAlterar: false })).not.toContain('Avançar');
    expect(lista({ podeIncluir: false })).not.toContain('href="/orc/exercicios/novo"');
  });

  it('lista vazia e aviso como status', () => {
    expect(lista({ exercicios: [] })).toContain('Nenhum exercício cadastrado.');
    expect(lista({ aviso: 'Exercício criado.' })).toMatch(/<p role="status">Exercício criado\.<\/p>/);
  });
});

describe('textoAviso', () => {
  it('códigos conhecidos; desconhecido some; contagem de puladas na cópia (D-P6-5)', () => {
    expect(textoAviso('criado', 0)).toBe('Exercício criado.');
    expect(textoAviso('copiado', 0)).toBe('Exercício criado copiando o anterior.');
    expect(textoAviso('copiado', 2)).toBe('Exercício criado copiando o anterior. 2 lançamento(s) não foram copiados porque o CC ou a conta estão inativos.');
    expect(textoAviso('avancado', 0)).toBe('Exercício em elaboração.');
    expect(textoAviso('<script>', 0)).toBeUndefined();
    expect(textoAviso(undefined, 0)).toBeUndefined();
  });
});

describe('SeletorExercicio', () => {
  it('um link por ano com a situação; o atual com aria-current; sem exercícios, nada', () => {
    const h = renderToString(createElement(SeletorExercicio, { exercicios, anoAtual: 2027, rota: '/orc/orcamento' }));
    expect(h).toContain('aria-label="Exercício"');
    expect(h).toMatch(/<a href="\/orc\/orcamento\?ano=2027" aria-current="page">2027 \(Rascunho\)<\/a>/);
    expect(h).toMatch(/<a href="\/orc\/orcamento\?ano=2026">2026 \(Oficializado\)<\/a>/);
    expect(renderToString(createElement(SeletorExercicio, { exercicios: [], anoAtual: null, rota: '/x' }))).toBe('');
  });
});

describe('FormExercicio', () => {
  it('ano com o padrão e as duas formas, Em branco marcada', () => {
    const h = renderToString(createElement(FormExercicio, { anoPadrao: 2028, criar: acao }));
    const tag = (re: RegExp) => h.match(re)?.[0] ?? '';
    expect(tag(/<input id="exercicio-ano"[^>]*>/)).toMatch(/name="ano"/);
    expect(tag(/<input id="exercicio-ano"[^>]*>/)).toMatch(/value="2028"/);
    expect(tag(/<input[^>]*value="EM_BRANCO"[^>]*>/)).toContain('checked=""');
    expect(tag(/<input[^>]*value="COPIA"[^>]*>/)).not.toContain('checked');
  });
});
