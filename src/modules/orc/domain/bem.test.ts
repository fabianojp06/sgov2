import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { agruparPorConta, totalDoBem, validarBem } from './bem';
import { MENSAGENS_ORC as M } from './mensagens';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const vigencia = { inicio: d('2027-03-15'), fim: d('2028-02-10') };
const bom = { conta: '4.1.2.1.001', descricao: 'Notebook', data: '2027-05-10', quantidade: '3', valorUnitario: '1.234,56' };
const campos = (r: { ok: boolean; erros?: readonly { campo: string; mensagem: string }[] }) => (r.ok ? [] : r.erros!.map((e) => e.campo));
const bem = (conta: string, quantidade: number, valor: string) => ({ conta, quantidade, valorUnitario: Dinheiro.de(valor) });

describe('validarBem (REQ0290, RN0157, D-P22-5)', () => {
  it('aceita o bem completo; total = quantidade × unitário', () => {
    const r = validarBem(bom, vigencia);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toMatchObject({ conta: '4.1.2.1.001', descricao: 'Notebook', quantidade: 3, data: d('2027-05-10') });
    expect(totalDoBem(r.valor).paraString()).toBe('3703.68');
  });

  it('recusa os obrigatórios vazios com a mensagem geral e cada campo', () => {
    const r = validarBem({}, vigencia);
    expect(!r.ok && r.erros[0]).toEqual({ campo: '_', mensagem: M.BEM_OBRIGATORIOS });
    expect(campos(r)).toEqual(['_', 'conta', 'descricao', 'data', 'quantidade', 'valorUnitario']);
  });

  it('quantidade inteira de 1 a 999.999; descrição até 200; valor ≥ 0', () => {
    expect(campos(validarBem({ ...bom, quantidade: '0' }, vigencia))).toEqual(['quantidade']);
    expect(campos(validarBem({ ...bom, quantidade: '1000000' }, vigencia))).toEqual(['quantidade']);
    expect(campos(validarBem({ ...bom, quantidade: '1,5' }, vigencia))).toEqual(['quantidade']);
    expect(campos(validarBem({ ...bom, quantidade: '999999' }, vigencia))).toEqual([]);
    expect(campos(validarBem({ ...bom, descricao: 'x'.repeat(201) }, vigencia))).toEqual(['descricao']);
    expect(campos(validarBem({ ...bom, valorUnitario: '-1,00' }, vigencia))).toEqual(['valorUnitario']);
    expect(campos(validarBem({ ...bom, valorUnitario: '0' }, vigencia))).toEqual([]);
  });

  it('data inválida ou fora da vigência (os dois limites valem)', () => {
    expect(campos(validarBem({ ...bom, data: '2027-02-30' }, vigencia))).toEqual(['data']);
    expect(validarBem({ ...bom, data: '2027-03-14' }, vigencia)).toEqual({ ok: false, erros: [{ campo: 'data', mensagem: M.BEM_DATA_FORA_DA_VIGENCIA('15/03/2027', '10/02/2028') }] });
    expect(campos(validarBem({ ...bom, data: '2028-02-11' }, vigencia))).toEqual(['data']);
    expect(campos(validarBem({ ...bom, data: '2027-03-15' }, vigencia))).toEqual([]);
    expect(campos(validarBem({ ...bom, data: '2028-02-10' }, vigencia))).toEqual([]);
  });

  it('recusa o total que passa do limite de NUMERIC(15,2)', () => {
    expect(validarBem({ ...bom, quantidade: '999999', valorUnitario: '99.999.999.999,99' }, vigencia)).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.BEM_CUSTO_FORA_DO_LIMITE }] });
  });
});

describe('agruparPorConta (RN0415, RN0417, RN0383)', () => {
  const bens = [bem('4.1.2.10.001', 1, '50.00'), bem('4.1.2.9.001', 2, '10.00'), bem('4.1.2.9.001', 1, '0.00'), bem('4.1.2.9.002', 5, '0.00')];

  it('grupos em ordem crescente de classificação, com o subtotal e o total geral', () => {
    const r = agruparPorConta(bens, true);
    expect(r.grupos.map((g) => [g.conta, g.itens.length, g.subtotal.paraString()])).toEqual([
      ['4.1.2.9.001', 2, '20.00'],
      ['4.1.2.9.002', 1, '0.00'],
      ['4.1.2.10.001', 1, '50.00'],
    ]);
    expect(r.total.paraString()).toBe('70.00');
  });

  it('sem os zerados, somem o item zero e a conta zero; o total não muda (Review Focus 3)', () => {
    const r = agruparPorConta(bens, false);
    expect(r.grupos.map((g) => [g.conta, g.itens.length])).toEqual([
      ['4.1.2.9.001', 1],
      ['4.1.2.10.001', 1],
    ]);
    expect(r.total.paraString()).toBe('70.00');
  });
});
