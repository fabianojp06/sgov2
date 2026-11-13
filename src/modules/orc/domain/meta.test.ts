import { describe, expect, it } from 'vitest';
import { MENSAGENS_ORC as M } from './mensagens';
import { metaExigida, validarMeta } from './meta';

// Meta da proposta de TP (US-067; plano do P19, Task 1): RN0106, RN0139, D-P19-3 e D-P19-7.
const valida = { numero: 'M1', nome: 'Meta de exemplo', valor: '1.234,56', status: 'ATIVO', observacao: '' };

const erros = (bruto: Record<string, unknown>, modo: 'incluir' | 'alterar' = 'incluir') => {
  const r = validarMeta(bruto, modo);
  return r.ok ? [] : r.erros;
};

describe('validarMeta', () => {
  it('meta válida: valor da tela vira Dinheiro, textos cortados e observação vazia vira nula', () => {
    const r = validarMeta({ ...valida, numero: ' M1 ', nome: ' Meta ' }, 'incluir');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toMatchObject({ numero: 'M1', nome: 'Meta', status: 'ATIVO', observacao: null });
    expect(r.valor.valor.paraString()).toBe('1234.56');
    expect(validarMeta({ ...valida, valor: '1234,5' }, 'incluir')).toMatchObject({ ok: true });
    expect(validarMeta({ ...valida, valor: '0' }, 'incluir')).toMatchObject({ ok: true });
  });

  it('E1 do UC03.15: a mensagem geral uma vez e cada campo vazio marcado', () => {
    expect(erros({ status: '' })).toEqual([
      { campo: '_', mensagem: M.META_OBRIGATORIOS },
      { campo: 'numero', mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO },
      { campo: 'nome', mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO },
      { campo: 'valor', mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO },
      { campo: 'status', mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO },
    ]);
  });

  it('no modo alterar, o número não é lido nem exigido', () => {
    expect(validarMeta({ ...valida, numero: undefined }, 'alterar')).toMatchObject({ ok: true });
    expect(erros({ ...valida, numero: 'x'.repeat(21) }, 'alterar')).toEqual([]);
  });

  it('limites de tamanho', () => {
    expect(erros({ ...valida, numero: 'x'.repeat(21) })).toEqual([{ campo: 'numero', mensagem: M.META_NUMERO_LONGO(20) }]);
    expect(erros({ ...valida, nome: 'x'.repeat(201) })).toEqual([{ campo: 'nome', mensagem: M.META_NOME_LONGO(200) }]);
    expect(erros({ ...valida, observacao: 'x'.repeat(1001) })).toEqual([{ campo: 'observacao', mensagem: M.META_OBSERVACAO_LONGA(1000) }]);
    expect(erros({ ...valida, numero: 'x'.repeat(20), nome: 'x'.repeat(200), observacao: 'x'.repeat(1000) })).toEqual([]);
  });

  it('RN0106: status só Ativo ou Inativo', () => {
    expect(erros({ ...valida, status: 'ativo' })).toEqual([{ campo: 'status', mensagem: M.META_STATUS_INVALIDO }]);
    expect(erros({ ...valida, status: 'INATIVO' })).toEqual([]);
  });

  it.each(['-1,00', '1,234', '1.00', '1234.567', 'abc', '99999999999999,00'])('valor inválido: %s', (valor) => {
    expect(erros({ ...valida, valor })).toEqual([{ campo: 'valor', mensagem: M.META_VALOR_INVALIDO }]);
  });
});

describe('metaExigida (RN_VIA_04, D-P19-7)', () => {
  it('só a proposta de categoria Meta exige meta nas despesas', () => {
    expect(metaExigida('META')).toBe(true);
    expect(metaExigida('CONSOLIDADA')).toBe(false);
  });
});
