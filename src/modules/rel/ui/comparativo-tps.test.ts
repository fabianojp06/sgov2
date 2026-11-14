import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { compararTps, type TpEntrada } from '../domain/comparativo-tps';
import { avisoDosComentarios, ConteudoComentarios, estadoDosComentarios, TEXTOS_COMENTARIOS } from './comparativo-tps';
import { TabelaComparativo, TEXTOS_COMPARATIVO } from './comparativo-tps-tabela';

const d = (v: string) => Dinheiro.de(v);
const tp = (numero: string, pessoal: string, extra: Partial<TpEntrada> = {}): TpEntrada => ({
  numero,
  tipo: 'TERMO_PARCERIA',
  situacao: 'OFICIALIZADO',
  oficial: true,
  vigencia: { inicio: '2027-01', fim: '2027-12' },
  valorGlobal: d('100.00'),
  porCategoria: { pessoal: d(pessoal), viagens: d('0'), bens: d('0'), rateioAdmCentral: d('0'), outros: d('0') },
  metas: [],
  realizado: d('0'),
  ...extra,
});

describe('tela do comparativo entre TPs (US-106)', () => {
  it('a tabela marca fora da curva por texto, mostra "não oficial", omitido e a mediana', () => {
    const c = compararTps([
      ...['50.00', '52.00', '55.00', '53.00', '51.00'].map((p, i) => tp(`TP-${i}`, p)),
      tp('TP-ALTO', '95.00'),
      tp('TP-NOVO', '50.00', { oficial: false }),
      tp('TP-PEQ', '60.00', { postos: 1 }),
    ]);
    const h = renderToStaticMarkup(createElement(TabelaComparativo, { comparativo: c }));
    expect(h).toContain(`95,00%<strong> (${TEXTOS_COMPARATIVO.ACIMA})</strong>`);
    expect(h).toContain(`TP-NOVO ${TEXTOS_COMPARATIVO.NAO_OFICIAL}`);
    expect(h).toContain(`<td>${TEXTOS_COMPARATIVO.OMITIDO}</td>`);
    expect(h).toContain(`<th scope="row">${TEXTOS_COMPARATIVO.MEDIANA}</th>`);
    expect(h).not.toContain('60,00%');
  });

  it('comentários com o selo antes do resumo; a região viva só tem o aviso curto', () => {
    const pronta = { tipo: 'PRONTA' as const, analise: { resumo: 'Portfólio equilibrado.', destaques: [], alertas: ['TP-ALTO acima.'] } };
    const h = renderToStaticMarkup(createElement(ConteudoComentarios, { estado: pronta }));
    expect(h.indexOf(TEXTOS_COMENTARIOS.SELO)).toBeLessThan(h.indexOf('Portfólio equilibrado.'));
    expect(h).toContain('TP-ALTO acima.');
    expect(h).not.toContain(TEXTOS_COMENTARIOS.DESTAQUES);
    expect(avisoDosComentarios(pronta)).toBe(TEXTOS_COMENTARIOS.PRONTA);
    expect(avisoDosComentarios({ tipo: 'CONSULTANDO' })).toBe(TEXTOS_COMENTARIOS.CONSULTANDO);
    expect(renderToStaticMarkup(createElement(ConteudoComentarios, { estado: { tipo: 'OCIOSO' } }))).toBe('');
    expect(estadoDosComentarios({ ok: false, erros: [{ campo: '_', mensagem: 'A.' }] })).toEqual({ tipo: 'ERRO', mensagem: 'A.' });
  });
});
