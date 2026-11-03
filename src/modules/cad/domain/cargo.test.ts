import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import {
  COLUNAS_CARGOS,
  desvioDeMercado,
  MSG_DOIS_ADICIONAIS,
  salarioDaFonte,
  salarioTotal,
  validarCargosRubi,
  validarMercadoCargo,
  type SalariosCargo,
} from './cargo';
import type { LinhaLida } from './plano-contas';

// Domínio dos cargos (plano do P4, Task 12a, Step 1).
const d = (v: string) => Dinheiro.de(v);
const s = (x: Partial<SalariosCargo> = {}): SalariosCargo => ({ minimo: d('6000.00'), maximo: d('9000.00'), funcaoGratificada: d('1200.00'), real: d('7500.00'), definido: d('8000.00'), ...x });
const txt = (x: Dinheiro | null) => x?.paraString() ?? null;

describe('salários do cargo', () => {
  it('salarioTotal (R19): máximo + FG; sem FG, o máximo; sem máximo, null', () => {
    expect(txt(salarioTotal(s()))).toBe('10200.00');
    expect(txt(salarioTotal(s({ funcaoGratificada: null })))).toBe('9000.00');
    expect(salarioTotal(s({ maximo: null }))).toBeNull();
  });

  it('salarioDaFonte: as 5 fontes', () => {
    expect(txt(salarioDaFonte(s(), 'MINIMO'))).toBe('6000.00');
    expect(txt(salarioDaFonte(s(), 'MAXIMO'))).toBe('9000.00');
    expect(txt(salarioDaFonte(s(), 'TOTAL'))).toBe('10200.00');
    expect(txt(salarioDaFonte(s(), 'REAL'))).toBe('7500.00');
    expect(txt(salarioDaFonte(s(), 'DEFINIDO'))).toBe('8000.00');
  });

  it('desvioDeMercado: ABAIXO, DENTRO (nas bordas também) e ACIMA; sem dado, null', () => {
    expect(desvioDeMercado(s({ real: d('5999.99') }))).toBe('ABAIXO');
    expect(desvioDeMercado(s({ real: d('6000.00') }))).toBe('DENTRO');
    expect(desvioDeMercado(s({ real: d('9000.00') }))).toBe('DENTRO');
    expect(desvioDeMercado(s({ real: d('9000.01') }))).toBe('ACIMA');
    expect(desvioDeMercado(s({ real: null }))).toBeNull();
  });
});

describe('validarMercadoCargo', () => {
  const base = { mercadoMinimo: '6000', mercadoMaximo: '9000,50', periculosidade: false, insalubridade: null };
  it('valores com vírgula; um adicional só', () => {
    const r = validarMercadoCargo({ ...base, insalubridade: 'MEDIO' });
    expect(r.ok && { min: r.valor.mercadoMinimo?.paraString(), max: r.valor.mercadoMaximo?.paraString(), ad: r.valor.adicional }).toEqual({
      min: '6000.00',
      max: '9000.50',
      ad: { tipo: 'INSALUBRIDADE', grau: 'MEDIO' },
    });
  });

  it('E5: os dois adicionais', () => {
    expect(validarMercadoCargo({ ...base, periculosidade: true, insalubridade: 'MAXIMO' })).toEqual({ ok: false, erros: [{ campo: 'adicional', mensagem: MSG_DOIS_ADICIONAIS }] });
    expect(MSG_DOIS_ADICIONAIS).toBe('Um cargo pode ter apenas um adicional trabalhista: Periculosidade OU Insalubridade.');
  });

  it('E3: mínimo ≥ máximo, erro nos dois campos', () => {
    const r = validarMercadoCargo({ ...base, mercadoMinimo: '9000.50' });
    expect(r.ok ? [] : r.erros.map((e) => e.campo)).toEqual(['mercadoMinimo', 'mercadoMaximo']);
    expect(validarMercadoCargo({ ...base, mercadoMinimo: 'abc' }).ok).toBe(false);
    expect(validarMercadoCargo({ ...base, mercadoMinimo: null, mercadoMaximo: '' }).ok).toBe(true);
  });
});

describe('validarCargosRubi (R20, layout CAD-CARGOS v1.0)', () => {
  const linha = (numero: number, mudar: Partial<Record<(typeof COLUNAS_CARGOS)[number], string | null>> = {}): LinhaLida => ({
    numero,
    celulas: {
      'Código do Cargo': `C${numero}`,
      Cargo: 'Analista',
      'Cargo Mercado': 'Analista Pleno',
      'Tabela Salarial (código)': 'T1',
      'Tabela Salarial (descrição)': 'Tabela 1',
      'Faixa (código)': 'F2',
      'Faixa (descrição)': 'Faixa 2',
      'Nível (código)': 'N3',
      'Nível (descrição)': 'Nível 3',
      'Salário Real': '7500.00',
      ...mudar,
    },
  });
  const semMarca = (t: string) => ({ texto: t, retirou: false });

  it('as linhas válidas, com o salário em Dinheiro (vazio vira null)', () => {
    const r = validarCargosRubi([linha(2), linha(3, { 'Salário Real': null, 'Cargo Mercado': ' ' })], semMarca);
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.cargos.map((c) => [c.codigo, c.salarioReal?.paraString() ?? null, c.nomeMercado])).toEqual([
      ['C2', '7500.00', 'Analista Pleno'],
      ['C3', null, null],
    ]);
  });

  it('I9: salário inválido cita só a linha e a coluna, nunca o valor', () => {
    for (const valor of ['75OO', '-1', '0', '99999999.00', '7500.001']) {
      const r = validarCargosRubi([linha(2, { 'Salário Real': valor })], semMarca);
      expect(r.ok).toBe(false);
      const erros = r.ok ? [] : r.erros;
      expect(erros).toEqual([{ linha: 2, coluna: 'Salário Real', mensagem: 'Salário inválido: informe um valor maior que zero, com até 2 casas decimais.' }]);
      expect(JSON.stringify(erros)).not.toContain(valor);
    }
  });

  it('código obrigatório, no formato e único; nome oficial obrigatório', () => {
    const r = validarCargosRubi([linha(2), linha(3, { 'Código do Cargo': 'C2' }), linha(4, { 'Código do Cargo': 'com espaço' }), linha(5, { Cargo: '' })], semMarca);
    expect(r.ok ? [] : r.erros.map((e) => `${e.linha}:${e.coluna}`)).toEqual(['2:Código do Cargo', '3:Código do Cargo', '4:Código do Cargo', '5:Cargo']);
  });

  it('planilha vazia → erro', () => {
    expect(validarCargosRubi([], semMarca)).toEqual({ ok: false, erros: [{ linha: 0, mensagem: 'A planilha não tem cargos.' }] });
  });
});
