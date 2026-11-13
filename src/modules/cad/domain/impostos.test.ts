import { describe, expect, it } from 'vitest';
import { aliquotaVigente, competenciaDe, incideEm, validarAliquota, validarImposto, type AnoMes } from './impostos';

describe('validarImposto (US-052, RN_TAX_05)', () => {
  it('nome até 20 caracteres, sem os espaços das pontas; incidência conhecida', () => {
    expect(validarImposto({ nome: '  ISS ', incidencia: 'AMBOS' })).toEqual({ ok: true, valor: { nome: 'ISS', incidencia: 'AMBOS' } });
    expect(validarImposto({ nome: 'x'.repeat(21), incidencia: 'CONTRATO' })).toMatchObject({ ok: false, erros: [{ campo: 'nome' }] });
    expect(validarImposto({ nome: ' ', incidencia: 'CONTRATO' })).toMatchObject({ ok: false, erros: [{ campo: 'nome' }] });
    expect(validarImposto({ nome: 'PIS', incidencia: 'FOMENTO' })).toMatchObject({ ok: false, erros: [{ campo: 'incidencia' }] });
  });
});

describe('validarAliquota (RN_TAX_05, E4)', () => {
  const mes = '2026-11' as AnoMes;
  it('competência atual ou futura; 0 a 100% com vírgula ou ponto', () => {
    const r = validarAliquota({ competencia: '2026-11', percentual: '0,65' }, mes);
    expect(r.ok && r.valor.percentual.comoFracao().toString()).toBe('0.0065');
    expect(validarAliquota({ competencia: '2027-01', percentual: '100' }, mes).ok).toBe(true);
    expect(validarAliquota({ competencia: '2027-01', percentual: '0' }, mes).ok).toBe(true);
  });
  it.each([
    ['retroativa', '2026-10', '1', 'competencia', /retroativa/],
    ['competência mal formada', '2026-13', '1', 'competencia', /AAAA-MM/],
    ['negativa', '2027-01', '-1', 'percentual', /entre 0 e 100/],
    ['acima de 100', '2027-01', '100.01', 'percentual', /entre 0 e 100/],
    ['texto', '2027-01', 'x', 'percentual', /4 casas/],
  ])('recusa %s', (_, competencia, percentual, campo, mensagem) => {
    expect(validarAliquota({ competencia, percentual }, mes)).toMatchObject({ ok: false, erros: [{ campo, mensagem: expect.stringMatching(mensagem) }] });
  });
});

describe('aliquotaVigente', () => {
  const hist = [{ competencia: '2026-01' as AnoMes, p: 'a' }, { competencia: '2027-01' as AnoMes, p: 'b' }, { competencia: '2026-07' as AnoMes, p: 'c' }];
  it('a de maior competência até a pedida; antes da primeira, nenhuma', () => {
    expect(aliquotaVigente(hist, '2026-06')?.p).toBe('a');
    expect(aliquotaVigente(hist, '2026-07')?.p).toBe('c');
    expect(aliquotaVigente(hist, '2026-12')?.p).toBe('c');
    expect(aliquotaVigente(hist, '2027-05')?.p).toBe('b');
    expect(aliquotaVigente(hist, '2025-12')).toBeNull();
  });
});

describe('incidência e competência', () => {
  it('AMBOS incide nos dois; o resto só no próprio tipo', () => {
    expect([incideEm('AMBOS', 'CONTRATO'), incideEm('AMBOS', 'TERMO_PARCERIA'), incideEm('CONTRATO', 'TERMO_PARCERIA'), incideEm('TERMO_PARCERIA', 'TERMO_PARCERIA')]).toEqual([true, true, false, true]);
  });
  it('competenciaDe usa o fuso de Brasília (01/12 01:00 UTC ainda é novembro)', () => {
    expect(competenciaDe(new Date('2026-12-01T01:00:00Z'))).toBe('2026-11');
    expect(competenciaDe(new Date('2026-12-01T04:00:00Z'))).toBe('2026-12');
  });
});
