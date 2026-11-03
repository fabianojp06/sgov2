import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const caminho = vi.hoisted(() => ({ atual: '/inicio' }));
vi.mock('next/navigation', () => ({ usePathname: () => caminho.atual }));

const { default: ErroRaiz } = await import('./error');
const { default: ErroGeral } = await import('./global-error');

const props = { error: new Error('x'), reset: () => {}, retry: () => {} };

describe('fronteiras de erro da raiz', () => {
  it('error.tsx: texto de página em português no alerta, Tentar novamente e Sair', () => {
    caminho.atual = '/inicio';
    const html = renderToString(createElement(ErroRaiz, props));
    expect(html).toContain('<p role="alert">Não foi possível exibir esta página. Tente novamente ou contate o Administrador.</p>');
    expect(html).toContain('>Tentar novamente</button>');
    expect(html).toContain('>Sair</button>');
  });

  it('error.tsx no /login e na raiz: sem o Sair (não há sessão)', () => {
    for (const p of ['/login', '/']) {
      caminho.atual = p;
      const html = renderToString(createElement(ErroRaiz, props));
      expect(html).toContain('>Tentar novamente</button>');
      expect(html).not.toContain('>Sair</button>');
    }
  });

  it('global-error.tsx: documento próprio em pt-BR, com título, o texto e o Tentar novamente', () => {
    const html = renderToString(createElement(ErroGeral, props));
    expect(html).toMatch(/^<html lang="pt-BR">/);
    expect(html).toContain('<title>SGO 2.0</title>');
    expect(html).toContain('<p role="alert">O sistema não pôde ser exibido. Tente novamente em instantes.</p>');
    expect(html).toContain('>Tentar novamente</button>');
  });
});
