import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { MENSAGENS_ORC as M } from './mensagens';
import { campoCelula, campoConta, competenciasDaVigencia, converterTexto, percentualDoValor, replicarLinha, validarGrade, valorDoPercentual } from './rateio';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const competencias = ['2027-01', '2027-02', '2027-03'];
const base = Dinheiro.de('10000.00');
const ctxTp = { competencias, base, tipoProposta: 'TERMO_PARCERIA' as const };
const campos = (r: { ok: boolean; erros?: readonly { campo: string; mensagem: string }[] }) => (r.ok ? [] : r.erros!.map((e) => e.campo));
const grade = (extra: Record<string, string> = {}) => ({ contaSintetica: '4.1', modo: 'VALOR', [campoConta(0)]: '4.3.1.1.001', ...extra });

describe('competenciasDaVigencia (REQ_RAT_001)', () => {
  it('os meses da vigência, de dezembro para janeiro', () => {
    expect(competenciasDaVigencia(d('2026-11-15'), d('2027-02-10'))).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('validarGrade (RN_RAT_01 a 07, E1, E2)', () => {
  it('modo valor: a vazia não é declarada; o zero digitado é (C1, RN_WA01_002); o total é a soma', () => {
    const r = validarGrade(grade({ [campoCelula(0, '2027-01')]: '1.000,00', [campoCelula(0, '2027-02')]: '', [campoCelula(0, '2027-03')]: '0' }), ctxTp);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.celulas.map((c) => [c.conta, c.competencia, c.valor.paraString(), c.percentual])).toEqual([
      ['4.3.1.1.001', '2027-01', '1000.00', null],
      ['4.3.1.1.001', '2027-03', '0.00', null],
    ]);
    expect(r.valor.total.paraString()).toBe('1000.00');
    expect(r.valor.aliquotaIss).toBeNull();
  });

  it('modo percentual: % da base com Half-Even, e o % guardado', () => {
    const r = validarGrade(grade({ modo: 'PERCENTUAL', [campoCelula(0, '2027-01')]: '1,23455' }), { ...ctxTp, base: Dinheiro.de('100.00') });
    expect(campos(r)).toEqual([campoCelula(0, '2027-01')]);
    const ok = validarGrade(grade({ modo: 'PERCENTUAL', [campoCelula(0, '2027-01')]: '1,2345' }), { ...ctxTp, base: Dinheiro.de('100.00') });
    expect(ok.ok && [ok.valor.celulas[0]!.valor.paraString(), ok.valor.celulas[0]!.percentual?.paraString()]).toEqual(['1.23', '1.2345']);
    expect(campos(validarGrade(grade({ modo: 'PERCENTUAL', [campoCelula(0, '2027-01')]: '100,01' }), ctxTp))).toEqual([campoCelula(0, '2027-01')]);
    // O % que dá menos de um centavo é recusado (revisão 12.12).
    expect(validarGrade(grade({ modo: 'PERCENTUAL', [campoCelula(0, '2027-01')]: '0,0001' }), { ...ctxTp, base: Dinheiro.de('100.00') })).toEqual({
      ok: false,
      erros: [{ campo: campoCelula(0, '2027-01'), mensagem: M.RATEIO_PERCENTUAL_PEQUENO }],
    });
  });

  it('E1: a soma não passa da base, com os dois valores na mensagem', () => {
    const r = validarGrade(grade({ [campoCelula(0, '2027-01')]: '6.000,00', [campoConta(1)]: '4.3.1.1.002', [campoCelula(1, '2027-02')]: '4.000,01' }), ctxTp);
    expect(r).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.RATEIO_ESTOURO('R$ 10.000,01', 'R$ 10.000,00') }] });
    expect(validarGrade(grade({ [campoCelula(0, '2027-01')]: '10.000,00' }), ctxTp).ok).toBe(true);
    // Sem ver o pessoal, a mensagem não traz a base (revisão 12.12).
    expect(validarGrade(grade({ [campoCelula(0, '2027-01')]: '10.000,01' }), { ...ctxTp, baseVisivel: false })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.RATEIO_ESTOURO_RESTRITO('R$ 10.000,01') }] });
  });

  it('E2: no Contrato, a alíquota vai de 2,00% a 5,00% (inclusivos); no TP, é ignorada', () => {
    const contrato = { ...ctxTp, tipoProposta: 'CONTRATO' as const };
    expect(campos(validarGrade(grade(), contrato))).toEqual(['aliquotaIss']);
    expect(campos(validarGrade(grade({ aliquotaIss: '1,99' }), contrato))).toEqual(['aliquotaIss']);
    expect(campos(validarGrade(grade({ aliquotaIss: '5,01' }), contrato))).toEqual(['aliquotaIss']);
    const dois = validarGrade(grade({ aliquotaIss: '2' }), contrato);
    expect(dois.ok && dois.valor.aliquotaIss?.paraString()).toBe('2.0000');
    expect(validarGrade(grade({ aliquotaIss: '5,00' }), contrato).ok).toBe(true);
    const tp = validarGrade(grade({ aliquotaIss: '9' }), ctxTp);
    expect(tp.ok && tp.valor.aliquotaIss).toBeNull();
  });

  it('obrigatórios, conta repetida, linha sem conta e mais de 20 linhas', () => {
    expect(campos(validarGrade({}, ctxTp))).toEqual(['contaSintetica', 'modo']);
    expect(campos(validarGrade(grade({ [campoConta(1)]: '4.3.1.1.001' }), ctxTp))).toEqual([campoConta(1)]);
    expect(campos(validarGrade(grade({ [campoCelula(2, '2027-01')]: '5,00' }), ctxTp))).toEqual([campoConta(2)]);
    const muitas = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [campoConta(i), `4.3.1.1.${String(i).padStart(3, '0')}`]));
    expect(validarGrade({ contaSintetica: '4.1', modo: 'VALOR', ...muitas }, ctxTp)).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.RATEIO_LINHAS_DEMAIS(20) }] });
  });
});

describe('conversão e replicar (REQ_RAT_002, RN_RAT_03, Review Focus 2)', () => {
  it('% ↔ R$ pela base, Half-Even', () => {
    const b = Dinheiro.de('3.00');
    expect(converterTexto('33,3333', 'PERCENTUAL', 'VALOR', b)).toBe('1,00');
    expect(converterTexto('1,00', 'VALOR', 'PERCENTUAL', b)).toBe('33,3333');
    expect(converterTexto('x', 'VALOR', 'PERCENTUAL', b)).toBe('x');
    expect(converterTexto('', 'VALOR', 'PERCENTUAL', b)).toBe('');
    expect(valorDoPercentual(Dinheiro.de('0.05'), percentualDoValor(Dinheiro.de('0.05'), Dinheiro.de('0.05'))).paraString()).toBe('0.05');
  });

  it('a conversão de três terços não passa da base', () => {
    const b = Dinheiro.de('100.00');
    const terco = converterTexto('33,33', 'VALOR', 'PERCENTUAL', b);
    const g = validarGrade(
      { contaSintetica: '4.1', modo: 'PERCENTUAL', [campoConta(0)]: '4.3.1.1.001', ...Object.fromEntries(competencias.map((c) => [campoCelula(0, c), terco])) },
      { ...ctxTp, base: b },
    );
    expect(g.ok && g.valor.total.paraString()).toBe('99.99');
  });

  it('replicar: o primeiro preenchido vai às vazias seguintes', () => {
    expect(replicarLinha([null, 5, null, 7, null])).toEqual([null, 5, 5, 7, 7].map((v, i) => (i === 4 ? 5 : v)));
    expect(replicarLinha([null, null])).toEqual([null, null]);
  });
});
