import { describe, expect, it } from 'vitest';
import {
  conferirTextos,
  dataEmBrasilia,
  listaGravada,
  MAXIMO_ITENS_RELATORIO,
  MAXIMO_RESUMO_RELATORIO,
  mensagemRelatorio,
  mesAnterior,
  mesEmBrasilia,
  validarMes,
  validarTextos,
} from './relatorio-executivo';

describe('relatório executivo (US-103): mês e textos', () => {
  it('mês AAAA-MM até o mês atual', () => {
    expect(validarMes('2027-03', '2027-05')).toEqual({ ok: true, valor: '2027-03' });
    expect(validarMes('2027-05', '2027-05').ok).toBe(true);
    expect(validarMes('2027-06', '2027-05')).toMatchObject({ ok: false, erros: [{ campo: 'mes' }] });
    for (const ruim of ['2027-13', '27-01', '', null, 202701]) expect(validarMes(ruim, '2027-05').ok).toBe(false);
    // Só o mês atual ou o anterior (os indicadores são a posição de agora).
    expect(validarMes('2027-03', '2027-05', mesAnterior('2027-05'))).toMatchObject({ ok: false, erros: [{ campo: 'mes' }] });
    expect(validarMes('2027-04', '2027-05', mesAnterior('2027-05')).ok).toBe(true);
    expect(mesAnterior('2027-01')).toBe('2026-12');
  });

  it('mês e data em Brasília: 31/12 às 22h (UTC já em janeiro) ainda é dezembro', () => {
    const virada = new Date('2028-01-01T01:00:00Z');
    expect(mesEmBrasilia(virada)).toBe('2027-12');
    expect(dataEmBrasilia(virada)).toBe('31/12/2027');
  });

  it('textos editados: resumo obrigatório e com teto; listas uma por linha, sem vazias, com teto de itens e de tamanho', () => {
    expect(validarTextos({ resumo: '  Mês estável. ', riscos: 'Risco A\n\n  Risco B  ', recomendacoes: '' })).toEqual({
      ok: true,
      valor: { resumo: 'Mês estável.', riscos: ['Risco A', 'Risco B'], recomendacoes: [] },
    });
    expect(validarTextos({ resumo: ' ', riscos: '', recomendacoes: '' })).toMatchObject({ ok: false, erros: [{ campo: 'resumo' }] });
    expect(validarTextos({ resumo: 'x'.repeat(MAXIMO_RESUMO_RELATORIO + 1), riscos: '', recomendacoes: '' })).toMatchObject({ ok: false });
    const muitos = Array.from({ length: MAXIMO_ITENS_RELATORIO + 1 }, (_, i) => `item ${i}`).join('\n');
    expect(validarTextos({ resumo: 'R.', riscos: muitos, recomendacoes: 'y'.repeat(501) })).toMatchObject({
      ok: false,
      erros: [{ campo: 'riscos' }, { campo: 'recomendacoes' }],
    });
    expect(validarTextos({ resumo: 1, riscos: null, recomendacoes: undefined })).toMatchObject({ ok: false, erros: [{ campo: 'resumo' }] });
  });

  it('saída da IA normalizada; JSON gravado lido de volta; a mensagem leva só os dados', () => {
    const muitos = Array.from({ length: 12 }, (_, i) => `r${i}`);
    expect(conferirTextos({ resumo: ' R. ', riscos: [' ', ...muitos], recomendacoes: [] })).toEqual({ resumo: 'R.', riscos: muitos.slice(0, MAXIMO_ITENS_RELATORIO), recomendacoes: [] });
    expect(listaGravada(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(listaGravada({ x: 1 })).toEqual([]);
    expect(mensagemRelatorio({ mes: '2027-05', admCentral: null, tps: [], tpsOmitidos: 0 })).toContain('"mes":"2027-05"');
  });
});
