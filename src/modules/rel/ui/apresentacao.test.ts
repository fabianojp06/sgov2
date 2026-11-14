import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConteudoRoteiro, TEXTOS_APRESENTACAO } from './apresentacao';

describe('tela do roteiro de apresentação (US-105)', () => {
  it('selo antes dos slides, tópicos, gráfico descrito em texto e notas', () => {
    const h = renderToStaticMarkup(
      createElement(ConteudoRoteiro, {
        gerado: { tema: 'T', roteiro: { slides: [{ titulo: 'Visão', topicos: ['Ponto 1'], grafico: 'ORCAMENTO_TETO', notas: 'Dizer isso.' }, { titulo: 'Fim', topicos: [], grafico: 'NENHUM', notas: '' }] } },
      }),
    );
    expect(h.indexOf(TEXTOS_APRESENTACAO.SELO)).toBeLessThan(h.indexOf('Visão'));
    expect(h).toContain('<li>Ponto 1</li>');
    expect(h).toContain('Gráfico: barras do orçamento da Administração Central contra o teto.');
    expect(h).toContain('Notas do apresentador: Dizer isso.');
    expect(h.match(/Gráfico:/g)).toHaveLength(1);
  });
});
