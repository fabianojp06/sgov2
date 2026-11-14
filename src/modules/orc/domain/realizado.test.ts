import { describe, expect, it } from 'vitest';
import { competenciaDeLancamento, lerCompetencia, validarArquivoRealizado, type LinhaArquivo } from './realizado';

const linha = (numero: number, conta: string | null, competencia: string | null, valor: string | null): LinhaArquivo => ({
  numero,
  celulas: { Conta: conta, 'Competência': competencia, Valor: valor },
});
const vigencia = new Set(['2026-05', '2026-06', '2026-07']);

describe('lerCompetencia (D-P32-1)', () => {
  it('aceita AAAA-MM, MM/AAAA e a célula de data; recusa o resto', () => {
    expect(lerCompetencia('2026-05')).toBe('2026-05');
    expect(lerCompetencia('05/2026')).toBe('2026-05');
    expect(lerCompetencia('2026-05-17')).toBe('2026-05');
    expect(lerCompetencia('2026-13')).toBeNull();
    expect(lerCompetencia('Mai/26')).toBeNull();
    expect(lerCompetencia(null)).toBeNull();
  });
});

describe('validarArquivoRealizado', () => {
  it('soma conta × competência repetida e ignora linha em branco', () => {
    const r = validarArquivoRealizado([linha(6, '4.1.1.1.001', '2026-05', '100.10'), linha(7, null, null, null), linha(8, '4.1.1.1.001', '05/2026', '-0.10')], vigencia);
    expect(r.ok && r.valor.map((v) => [v.conta, v.competencia, v.valor.paraString()])).toEqual([['4.1.1.1.001', '2026-05', '100.00']]);
  });

  it('erro em qualquer linha reprova o arquivo inteiro, com a linha e a coluna (D-P32-2)', () => {
    const r = validarArquivoRealizado(
      [linha(6, '4.1.1.1.001', '2026-05', '1.5'), linha(7, '', '2026-05', '1'), linha(8, '4.1', '2026-12', '1'), linha(9, '4.1', '2026-06', '1,5'), linha(10, '4.1', '2026-06', null)],
      vigencia,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.map((e) => e.campo)).toEqual(['_', 'linhas.7.Conta', 'linhas.8.Competência', 'linhas.9.Valor', 'linhas.10.Valor']);
    expect(r.erros[2]!.mensagem).toBe('Linha 8: Competência fora da vigência do TP.');
  });

  it('arquivo sem linhas é recusado', () => {
    const r = validarArquivoRealizado([linha(6, null, null, null)], vigencia);
    expect(!r.ok && r.erros[0]!.mensagem).toBe('O arquivo não tem nenhuma linha de realizado.');
  });
});

describe('competenciaDeLancamento (RN_OXR_006)', () => {
  it('a primeira competência aberta depois da origem, virando o ano', () => {
    expect(competenciaDeLancamento('2022-05', new Set(['2022-05']))).toBe('2022-06');
    expect(competenciaDeLancamento('2022-11', new Set(['2022-11', '2022-12']))).toBe('2023-01');
  });
});
