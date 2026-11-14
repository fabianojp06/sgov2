import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConteudoResposta, estadoDaPergunta, TEXTOS_PERGUNTE } from './pergunte-sgo';

describe('tela do Pergunte ao SGO (US-104)', () => {
  it('número com o selo, a fonte e o link; "não sei" sem fonte; erro', () => {
    const h = renderToStaticMarkup(
      createElement(ConteudoResposta, {
        estado: { tipo: 'PRONTA', resposta: { tipo: 'NUMERO', texto: 'O orçamento é R$ 1,00.', valor: '1.00', fonte: 'Orçamento da Administração Central', link: '/orc/orcamento?ano=2027' } },
      }),
    );
    expect(h.indexOf(TEXTOS_PERGUNTE.SELO)).toBeLessThan(h.indexOf('O orçamento é'));
    expect(h).toContain(`${TEXTOS_PERGUNTE.FONTE}: Orçamento da Administração Central`);
    expect(h).toContain('<a href="/orc/orcamento?ano=2027">');
    const n = renderToStaticMarkup(createElement(ConteudoResposta, { estado: { tipo: 'PRONTA', resposta: { tipo: 'NAO_SEI', texto: 'Não sei.' } } }));
    expect(n).not.toContain(TEXTOS_PERGUNTE.FONTE);
    expect(estadoDaPergunta({ ok: false, erros: [{ campo: 'pergunta', mensagem: 'Curta.' }] })).toEqual({ tipo: 'ERRO', mensagem: 'Curta.' });
  });
});
