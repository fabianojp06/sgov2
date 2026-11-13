import { describe, expect, it } from 'vitest';
import { cruza, lerCompetencia, mesesDoAno, validarEmpregado, validarQtde } from './empregado';
import { MENSAGENS_ORC as M } from './mensagens';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// Vigência de 15/03/2027 a 10/02/2029: valem as competências de 03/2027 a 02/2029.
const vigencia = { inicio: d('2027-03-15'), fim: d('2029-02-10') };
const bom = { categoria: 'EMPREGADO', nome: 'Ana', cargoId: 'c1', inicio: '2027-03', fim: '2028-06', dependentes: '2' };
const campos = (r: { ok: boolean; erros?: readonly { campo: string; mensagem: string }[] }) => (r.ok ? [] : r.erros!.map((e) => e.campo));

describe('validarEmpregado (D-P20-2, D-P20-3)', () => {
  it('aceita o empregado completo, com as competências no dia 1 em UTC', () => {
    const r = validarEmpregado(bom, vigencia);
    expect(r).toEqual({ ok: true, valor: { categoria: 'EMPREGADO', nome: 'Ana', cargoId: 'c1', dependentes: 2, inicio: d('2027-03-01'), fim: d('2028-06-01') } });
  });

  it('nome vazio é a vaga A CONTRATAR (RN0249) e dependentes vazio é zero', () => {
    const r = validarEmpregado({ ...bom, nome: '  ', dependentes: '' }, vigencia);
    expect(r.ok && r.valor.nome).toBeNull();
    expect(r.ok && r.valor.dependentes).toBe(0);
  });

  it('recusa os obrigatórios vazios com a mensagem geral e o campo (RN0248)', () => {
    const r = validarEmpregado({}, vigencia);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erros[0]).toEqual({ campo: '_', mensagem: M.EMPREGADO_OBRIGATORIOS });
    expect(campos(r)).toEqual(['_', 'categoria', 'cargoId', 'inicio', 'fim']);
  });

  it('recusa categoria fora da lista, nome longo e dependentes fora de 0 a 20', () => {
    expect(campos(validarEmpregado({ ...bom, categoria: 'TERCEIRO' }, vigencia))).toEqual(['categoria']);
    expect(campos(validarEmpregado({ ...bom, nome: 'x'.repeat(121) }, vigencia))).toEqual(['nome']);
    expect(campos(validarEmpregado({ ...bom, nome: 'x'.repeat(120) }, vigencia))).toEqual([]);
    expect(campos(validarEmpregado({ ...bom, dependentes: '21' }, vigencia))).toEqual(['dependentes']);
    expect(campos(validarEmpregado({ ...bom, dependentes: '-1' }, vigencia))).toEqual(['dependentes']);
    expect(campos(validarEmpregado({ ...bom, dependentes: '1.5' }, vigencia))).toEqual(['dependentes']);
  });

  it('recusa competência fora do formato, antes ou depois da vigência e com o início depois do fim', () => {
    expect(campos(validarEmpregado({ ...bom, inicio: '03/2027' }, vigencia))).toEqual(['inicio']);
    expect(campos(validarEmpregado({ ...bom, inicio: '2027-13' }, vigencia))).toEqual(['inicio']);
    const antes = validarEmpregado({ ...bom, inicio: '2027-02' }, vigencia);
    expect(!antes.ok && antes.erros).toEqual([{ campo: 'inicio', mensagem: M.COMPETENCIA_ANTES_DA_VIGENCIA('03/2027') }]);
    const depois = validarEmpregado({ ...bom, fim: '2029-03' }, vigencia);
    expect(!depois.ok && depois.erros).toEqual([{ campo: 'fim', mensagem: M.COMPETENCIA_DEPOIS_DA_VIGENCIA('02/2029') }]);
    expect(campos(validarEmpregado({ ...bom, inicio: '2028-07', fim: '2028-06' }, vigencia))).toEqual(['fim']);
  });

  it('aceita as bordas da vigência e o mesmo mês no início e no fim', () => {
    expect(validarEmpregado({ ...bom, inicio: '2027-03', fim: '2029-02' }, vigencia).ok).toBe(true);
    expect(validarEmpregado({ ...bom, inicio: '2028-01', fim: '2028-01' }, vigencia).ok).toBe(true);
  });
});

describe('validarQtde (D-P20-6)', () => {
  it('aceita período e documento', () => {
    expect(validarQtde({ inicio: '2027-03', fim: '2027-12', documento: ' AP-01 ' }, vigencia)).toEqual({
      ok: true,
      valor: { documento: 'AP-01', inicio: d('2027-03-01'), fim: d('2027-12-01') },
    });
  });

  it('recusa obrigatórios vazios (RN0153), documento longo e período fora da vigência (RN0154)', () => {
    const r = validarQtde({}, vigencia);
    expect(!r.ok && r.erros[0]).toEqual({ campo: '_', mensagem: M.QTDE_OBRIGATORIOS });
    expect(campos(validarQtde({ inicio: '2027-03', fim: '2027-12', documento: 'x'.repeat(51) }, vigencia))).toEqual(['documento']);
    expect(campos(validarQtde({ inicio: '2027-01', fim: '2027-12', documento: 'A' }, vigencia))).toEqual(['inicio']);
  });
});

describe('competências', () => {
  it('lerCompetencia só aceita AAAA-MM', () => {
    expect(lerCompetencia('2027-01')).toEqual(d('2027-01-01'));
    expect(lerCompetencia('2027-1')).toBeNull();
    expect(lerCompetencia('2027-00')).toBeNull();
    expect(lerCompetencia('')).toBeNull();
  });

  it('cruza: um mês em comum basta; períodos vizinhos não se cruzam', () => {
    const p = (a: string, b: string) => ({ inicio: d(`${a}-01`), fim: d(`${b}-01`) });
    expect(cruza(p('2027-01', '2027-06'), p('2027-06', '2027-12'))).toBe(true);
    expect(cruza(p('2027-01', '2027-05'), p('2027-06', '2027-12'))).toBe(false);
    expect(cruza(p('2027-03', '2027-03'), p('2027-01', '2027-12'))).toBe(true);
  });

  it('mesesDoAno recorta o período no ano, na virada e fora dele (D-P20-4)', () => {
    const p = { inicio: d('2027-10-01'), fim: d('2029-02-01') };
    expect(mesesDoAno(p, 2027)).toEqual({ mesInicio: 10, mesSaida: 12 });
    expect(mesesDoAno(p, 2028)).toEqual({ mesInicio: 1, mesSaida: 12 });
    expect(mesesDoAno(p, 2029)).toEqual({ mesInicio: 1, mesSaida: 2 });
    expect(mesesDoAno(p, 2026)).toBeNull();
    expect(mesesDoAno(p, 2030)).toBeNull();
  });
});
