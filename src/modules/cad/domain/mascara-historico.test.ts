import { describe, expect, it } from 'vitest';
import { mascararHistoricoCad, VALOR_MASCARADO } from './mascara-historico';

// Formas reais do Histórico do cad: alterarCargo, alterarBeneficiosCargo, a cópia dos benefícios do
// ano (depois agrupado por cargo), a regravação dos envelopes e a tabela salarial.
const alteracaoCargo = {
  mercadoMinimo: '5000.00',
  mercadoMaximo: '7000.00',
  fonteAtiva: 'MINIMO',
  adicionalTipo: null,
  nomeMercado: 'Analista',
};
const beneficios = [
  { codigo: 'VA', ativo: true, valorManual: '850.00', origem: 'MANUAL' },
  { codigo: 'VT', ativo: true, valorManual: null, origem: 'MESTRE' },
];
const copiaDoAno = { C1: [{ codigo: 'VA', ativo: true, valorManual: '900.00' }], C2: [{ codigo: 'VA', ativo: false, valorManual: null }] };
const envelopes = { salarioRealCifrado: 'v1:k1:aaa:bbb:ccc', funcaoGratificadaCifrada: null, salarioDefinidoCifrado: 'v1:k1:x:y:z' };

describe('mascararHistoricoCad (R24, D-P8-10)', () => {
  it('sem cad.salarios: mascara mercado, valor manual e envelopes em qualquer profundidade', () => {
    expect(mascararHistoricoCad('cad.cargos', alteracaoCargo, false)).toEqual({
      dados: { ...alteracaoCargo, mercadoMinimo: VALOR_MASCARADO, mercadoMaximo: VALOR_MASCARADO },
      mascarado: true,
      contemSalario: true,
    });
    expect(mascararHistoricoCad('cad.cargos', beneficios, false).dados).toEqual([
      { codigo: 'VA', ativo: true, valorManual: VALOR_MASCARADO, origem: 'MANUAL' },
      { codigo: 'VT', ativo: true, valorManual: null, origem: 'MESTRE' },
    ]);
    expect(mascararHistoricoCad('cad.cargos', copiaDoAno, false).dados).toEqual({
      C1: [{ codigo: 'VA', ativo: true, valorManual: VALOR_MASCARADO }],
      C2: [{ codigo: 'VA', ativo: false, valorManual: null }],
    });
    expect(mascararHistoricoCad('cad.cargos', envelopes, false).dados).toEqual({
      salarioRealCifrado: VALOR_MASCARADO,
      funcaoGratificadaCifrada: null,
      salarioDefinidoCifrado: VALOR_MASCARADO,
    });
  });

  it('nulo continua nulo e não marca como mascarado; nada de salário, nada mascarado', () => {
    expect(mascararHistoricoCad('cad.cargos', { valorManual: null, mercadoMinimo: null }, false)).toEqual({
      dados: { valorManual: null, mercadoMinimo: null },
      mascarado: false,
      contemSalario: false,
    });
    expect(mascararHistoricoCad('cad.cargos', { ativo: false }, false)).toEqual({ dados: { ativo: false }, mascarado: false, contemSalario: false });
    expect(mascararHistoricoCad('cad.cargos', null, false)).toEqual({ dados: null, mascarado: false, contemSalario: false });
  });

  it('com cad.salarios: os dados como estão (a mesma referência) e contemSalario para auditar a consulta', () => {
    const r = mascararHistoricoCad('cad.cargos', alteracaoCargo, true);
    expect(r).toEqual({ dados: alteracaoCargo, mascarado: false, contemSalario: true });
    expect(r.dados).toBe(alteracaoCargo);
    expect(mascararHistoricoCad('cad.cargos', { ativo: true }, true).contemSalario).toBe(false);
  });

  it('o delta do Histórico ({ de, para } e listas em valor) também é mascarado', () => {
    // Formas do calcularDelta (src/shared/audit/delta.ts): campo a campo, ou { valor } para listas.
    const delta = { mercadoMinimo: { de: '5000.00', para: '5500.00' }, fonteAtiva: { de: 'MINIMO', para: 'MAXIMO' } };
    expect(mascararHistoricoCad('cad.cargos', delta, false).dados).toEqual({ mercadoMinimo: VALOR_MASCARADO, fonteAtiva: { de: 'MINIMO', para: 'MAXIMO' } });
    const deltaLista = { valor: { de: [{ codigo: 'VA', valorManual: '850.00' }], para: [{ codigo: 'VA', valorManual: null }] } };
    expect(mascararHistoricoCad('cad.cargos', deltaLista, false)).toEqual({
      dados: { valor: { de: [{ codigo: 'VA', valorManual: VALOR_MASCARADO }], para: [{ codigo: 'VA', valorManual: null }] } },
      mascarado: true,
      contemSalario: true,
    });
  });

  it('funcionalidades sem salário não mascaram (a tabela salarial mostra mínimo e máximo na tela)', () => {
    const faixa = { minimo: '3000.00', maximo: '4000.00', mercadoMinimo: '1.00' };
    expect(mascararHistoricoCad('cad.tabela_salarial', faixa, false)).toEqual({ dados: faixa, mascarado: false, contemSalario: false });
    expect(mascararHistoricoCad('cad.salario_minimo', { salarioMinimo: '1518.00' }, false).mascarado).toBe(false);
    expect(mascararHistoricoCad('orc.orcamento', { valorManual: '1.00' }, false).mascarado).toBe(false);
  });

  it('não altera o objeto recebido', () => {
    const original = structuredClone(beneficios);
    mascararHistoricoCad('cad.cargos', beneficios, false);
    expect(beneficios).toEqual(original);
  });
});
