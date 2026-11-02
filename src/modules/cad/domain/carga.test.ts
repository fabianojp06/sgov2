import { describe, expect, it } from 'vitest';
import { planejarCarga, type Atual } from './carga';

// Planejamento da recarga (plano do P4, R5; Task 4a, Step 2).
const a = (classificacao: string, codigoReduzido: string | null, extra: Partial<Atual> = {}): Atual => ({
  classificacao,
  codigoReduzido,
  tipo: codigoReduzido === null ? 'SINTETICA' : 'ANALITICA',
  descricao: `Conta ${classificacao}`,
  ativo: true,
  ...extra,
});
const atuais = [a('4.1.1.1', null), a('4.1.1.1.001', '900'), a('4.1.1.1.003', '920')];

describe('planejarCarga (R5)', () => {
  it('mesma lista → tudo inalterado', () => {
    expect(planejarCarga(atuais, atuais)).toEqual({
      incluir: [],
      alterarDescricao: [],
      reativar: [],
      inativar: [],
      inalteradas: 3,
      avisos: [],
      erros: [],
    });
  });

  it('mesma classificação com nova descrição → alterarDescricao', () => {
    const r = planejarCarga(atuais, [atuais[0]!, { ...atuais[1]!, descricao: 'Salários e ordenados' }, atuais[2]!]);
    expect(r.alterarDescricao).toEqual([{ ...atuais[1]!, descricao: 'Salários e ordenados' }]);
    expect(r.inalteradas).toBe(2);
  });

  const vazio = { incluir: [], alterarDescricao: [], reativar: [], inativar: [], avisos: [] };

  it('mesma classificação com outro reduzido → erro na linha, com o texto da R5, e nada mais', () => {
    const r = planejarCarga(atuais, [atuais[0]!, { ...atuais[1]!, codigoReduzido: '901', linha: 6 }, atuais[2]!]);
    expect(r).toEqual({
      ...vazio,
      inalteradas: 2,
      erros: [
        {
          linha: 6,
          coluna: 'Conta Reduzida',
          mensagem: 'A carga não muda a estrutura de um registro existente (D7): 4.1.1.1.001 já existe com o reduzido 900/tipo ANALITICA.',
        },
      ],
    });
  });

  it('mesma classificação com outro tipo → erro na linha, e nada mais', () => {
    const r = planejarCarga(atuais, [{ ...atuais[0]!, tipo: 'ANALITICA', linha: 5 }, atuais[1]!, atuais[2]!]);
    expect(r).toEqual({
      ...vazio,
      inalteradas: 2,
      erros: [{ linha: 5, coluna: 'Tipo', mensagem: expect.stringContaining('4.1.1.1 já existe com o reduzido (nenhum)/tipo SINTETICA') }],
    });
  });

  it('reduzido de uma ativa que também continua no arquivo → erro na linha (não estoura o índice no merge)', () => {
    const r = planejarCarga(atuais, [...atuais, a('4.1.1.1.010', '900', { linha: 9 })]);
    expect(r.incluir).toEqual([]);
    expect(r.erros).toEqual([{ linha: 9, coluna: 'Conta Reduzida', mensagem: 'O reduzido 900 já pertence a 4.1.1.1.001, que continua no arquivo.' }]);
  });

  it('reduzido 900 movido para classificação nova → inativa a antiga, inclui a nova e avisa', () => {
    const movida = a('4.1.1.1.010', '900', { linha: 7 });
    const r = planejarCarga(atuais, [atuais[0]!, movida, atuais[2]!]);
    expect(r.inativar).toEqual(['4.1.1.1.001']);
    expect(r.incluir).toEqual([movida]);
    expect(r.avisos).toEqual([
      { linha: 7, coluna: 'Classificação', mensagem: 'O reduzido 900 passou de 4.1.1.1.001 para 4.1.1.1.010: a antiga foi inativada.' },
    ]);
    expect(r.erros).toEqual([]);
  });

  it('ausente → inativar; inativa ausente continua como está', () => {
    const r = planejarCarga([...atuais, a('4.1.1.1.005', '940', { ativo: false })], [atuais[0]!, atuais[1]!]);
    expect(r.inativar).toEqual(['4.1.1.1.003']);
  });

  it('inativa que volta → reativar, com a descrição da planilha', () => {
    const inativa = a('4.1.1.1.005', '940', { ativo: false });
    const r = planejarCarga([...atuais, inativa], [...atuais, { ...inativa, ativo: true, descricao: '13 Salário' }]);
    expect(r.reativar).toEqual([{ ...inativa, ativo: true, descricao: '13 Salário' }]);
    expect(r.inalteradas).toBe(3);
  });

  it('classificação nova → incluir', () => {
    const nova = a('4.1.1.1.007', '960');
    expect(planejarCarga(atuais, [...atuais, nova]).incluir).toEqual([nova]);
  });
});
