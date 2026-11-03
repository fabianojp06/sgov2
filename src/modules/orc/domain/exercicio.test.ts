import { describe, expect, it } from 'vitest';
import { anoPadrao, editavel, exercicioOrigemDaCopia, transicionar, type EventoCiclo, type SituacaoExercicio } from './exercicio';

// Ciclo de vida da §6.2 (plano do P6, Task 3).
describe('transicionar', () => {
  it.each<[SituacaoExercicio, EventoCiclo, SituacaoExercicio]>([
    ['RASCUNHO', 'AVANCAR', 'EM_ELABORACAO'],
    ['EM_ELABORACAO', 'ENVIAR', 'EM_APROVACAO'],
    ['EM_APROVACAO', 'APROVAR', 'OFICIALIZADO'],
    ['EM_APROVACAO', 'REJEITAR', 'EM_ELABORACAO'],
  ])('%s + %s → %s', (de, evento, para) => expect(transicionar(de, evento)).toEqual({ ok: true, valor: para }));

  it.each<[SituacaoExercicio, EventoCiclo, string]>([
    ['RASCUNHO', 'ENVIAR', 'Rascunho'],
    ['EM_ELABORACAO', 'AVANCAR', 'Em Elaboração'],
    ['EM_ELABORACAO', 'APROVAR', 'Em Elaboração'],
    ['OFICIALIZADO', 'REJEITAR', 'Oficializado'],
  ])('%s + %s: erro com a situação', (de, evento, rotulo) =>
    expect(transicionar(de, evento)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: `Este exercício não pode ser alterado na situação ${rotulo}.` }],
    }),
  );
});

describe('editavel', () => {
  it('só Rascunho e Em Elaboração', () => {
    expect(['RASCUNHO', 'EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO'].map((s) => editavel(s as SituacaoExercicio))).toEqual([true, true, false, false]);
  });
});

describe('anoPadrao e exercicioOrigemDaCopia (R18)', () => {
  const hoje = new Date('2026-11-02T12:00:00Z');
  it('maior existente + 1; sem nenhum, o ano seguinte ao de hoje', () => {
    expect(anoPadrao([2026, 2027], hoje)).toBe(2028);
    expect(anoPadrao([], hoje)).toBe(2027);
  });
  it('origem da cópia: o maior ano menor que o novo', () => {
    expect(exercicioOrigemDaCopia([2025, 2027], 2028)).toBe(2027);
    expect(exercicioOrigemDaCopia([2025, 2027], 2026)).toBe(2025);
    expect(exercicioOrigemDaCopia([2027], 2027)).toBeNull();
    expect(exercicioOrigemDaCopia([], 2027)).toBeNull();
  });
});
