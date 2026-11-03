import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ErroRaiz from './error';
import ErroGeral, { MENSAGEM_ERRO_GERAL } from './global-error';

const props = { error: new Error('x'), reset: () => {}, retry: () => {} };

describe('fronteiras de erro da raiz', () => {
  it('error.tsx: texto de página em português, Tentar novamente e Sair', () => {
    const html = renderToString(createElement(ErroRaiz, props));
    expect(html).toContain('Não foi possível exibir esta página. Tente novamente ou contate o Administrador.');
    expect(html).toContain('>Tentar novamente</button>');
    expect(html).toContain('>Sair</button>');
  });

  it('global-error.tsx: documento próprio em pt-BR, com o texto e o Tentar novamente', () => {
    const html = renderToString(createElement(ErroGeral, props));
    expect(html).toMatch(/^<html lang="pt-BR">/);
    expect(html).toContain(MENSAGEM_ERRO_GERAL);
    expect(html).toContain('>Tentar novamente</button>');
  });
});
