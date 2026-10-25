import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BotaoSair } from './botao-sair';

describe('BotaoSair (RN0028)', () => {
  it('fechado: só o botão Sair', () => {
    const html = renderToString(createElement(BotaoSair));
    expect(html).toContain('Sair');
    expect(html).not.toContain('Deseja realmente sair?');
  });
  it('aberto: confirmação com Sim e Não', () => {
    const html = renderToString(createElement(BotaoSair, { aberto: true }));
    expect(html).toContain('Deseja realmente sair?');
    expect(html).toContain('Sim');
    expect(html).toContain('Não');
  });
});
