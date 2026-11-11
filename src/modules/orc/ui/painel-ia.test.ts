import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConteudoPainelIA, estadoDaResposta, PainelIA, RespostaPainelIA, type EstadoPainelIA } from './painel-ia';

// Painel da ajuda da IA (plano do P14): as partes puras, sem DOM.
const conteudo = (estado: EstadoPainelIA<string>) =>
  renderToStaticMarkup(createElement(ConteudoPainelIA<string>, { estado, children: (v: string) => createElement('blockquote', null, v) }));

describe('painel da IA', () => {
  it('a resposta pronta leva o selo "Gerado com IA – revisar" antes do conteúdo', () => {
    const h = renderToStaticMarkup(createElement(RespostaPainelIA, null, createElement('p', null, 'Texto sugerido')));
    expect(h).toBe('<p><strong>Gerado com IA – revisar</strong></p><p>Texto sugerido</p>');
    expect(conteudo({ tipo: 'PRONTA', valor: 'Sugestão' })).toBe('<p><strong>Gerado com IA – revisar</strong></p><blockquote>Sugestão</blockquote>');
  });

  it('erro da ação: as mensagens juntas, sem o selo', () => {
    const estado = estadoDaResposta<string>({ ok: false, erros: [{ campo: '_', mensagem: 'A IA está desligada para esta função.' }, { campo: 'cc', mensagem: 'CC fora do seu escopo.' }] });
    expect(estado).toEqual({ tipo: 'ERRO', mensagem: 'A IA está desligada para esta função. CC fora do seu escopo.' });
    const h = conteudo(estado);
    expect(h).toBe('<p>A IA está desligada para esta função. CC fora do seu escopo.</p>');
    expect(h).not.toContain('Gerado com IA');
  });

  it('consultando: o aviso de espera; ocioso: nada', () => {
    expect(conteudo({ tipo: 'CONSULTANDO' })).toBe('<p>Consultando a IA…</p>');
    expect(conteudo({ tipo: 'OCIOSO' })).toBe('');
    expect(estadoDaResposta({ ok: true, valor: 'x' })).toEqual({ tipo: 'PRONTA', valor: 'x' });
  });

  it('o painel: botão que não envia o formulário, aviso e a região viva (role="status")', () => {
    const h = renderToStaticMarkup(
      createElement(PainelIA<string>, { id: 'p', titulo: 'Ajuda', rotuloBotao: 'Pedir ajuda', aviso: 'Sem nomes.', pedir: async () => ({ ok: true as const, valor: '' }), children: () => null }),
    );
    expect(h).toContain('<button type="button" aria-disabled="false">Pedir ajuda</button>');
    expect(h).toContain('<p role="note">Sem nomes.</p>');
    expect(h).toContain('<div role="status" aria-live="polite"></div>');
    expect(h).not.toContain('disabled=""');
  });
});
