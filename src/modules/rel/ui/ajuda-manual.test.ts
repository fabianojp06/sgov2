import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConteudoAjuda, estadoDaResposta, TEXTOS_AJUDA, type EstadoAjuda } from './ajuda-manual';

const html = (estado: EstadoAjuda) => renderToStaticMarkup(createElement(ConteudoAjuda, { estado }));
const TRECHO = { id: 'T1', local: 'Cadastros › Plano de Contas', nome: 'Plano de Contas', rota: '/cad/plano-contas', texto: 'Consulte o plano. Você pode: consultar.' };

describe('tela da ajuda do manual (US-108)', () => {
  it('resposta com o selo antes, o texto e os trechos do manual com o link da tela', () => {
    const h = html({ tipo: 'PRONTA', valor: { encontrou: true, resposta: 'Vá em Cadastros.', trechos: [TRECHO] } });
    expect(h.indexOf(TEXTOS_AJUDA.SELO)).toBeGreaterThan(-1);
    expect(h.indexOf(TEXTOS_AJUDA.SELO)).toBeLessThan(h.indexOf('Vá em Cadastros.'));
    expect(h).toContain('<a href="/cad/plano-contas">Plano de Contas</a>');
    expect(h).toContain('<blockquote>Consulte o plano. Você pode: consultar.</blockquote>');
  });

  it('não encontrou, consultando e erro', () => {
    expect(html({ tipo: 'PRONTA', valor: { encontrou: false } })).toContain(TEXTOS_AJUDA.NAO_ENCONTROU);
    expect(html({ tipo: 'PRONTA', valor: { encontrou: false } })).not.toContain(TEXTOS_AJUDA.SELO);
    expect(html({ tipo: 'CONSULTANDO' })).toContain(TEXTOS_AJUDA.CONSULTANDO);
    expect(html({ tipo: 'OCIOSO' })).toBe('');
    expect(estadoDaResposta({ ok: false, erros: [{ campo: 'pergunta', mensagem: 'Curta.' }, { campo: '_', mensagem: 'Outra.' }] })).toEqual({ tipo: 'ERRO', mensagem: 'Curta. Outra.' });
  });
});
