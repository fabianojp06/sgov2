import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormTrocaSenha } from './form-troca-senha';

const trocar = async () => ({ ok: true as const });

describe('FormTrocaSenha (UC02.19)', () => {
  it('obrigatória: login desabilitado, sem senha atual', () => {
    const html = renderToString(createElement(FormTrocaSenha, { login: 'ana', obrigatoria: true, trocar }));
    expect(html).toMatch(/id="login"[^>]*disabled/);
    expect(html).not.toContain('Senha atual');
    expect(html).toContain('Nova senha');
    expect(html).toContain('Repetir senha');
  });
  it('voluntária: pede a senha atual (D-P5-3)', () =>
    expect(renderToString(createElement(FormTrocaSenha, { login: 'ana', obrigatoria: false, trocar }))).toContain('Senha atual'));
  it('confirmação com Sim e Não', () => {
    const html = renderToString(createElement(FormTrocaSenha, { login: 'ana', obrigatoria: true, trocar, confirmando: true }));
    expect(html).toContain('Deseja confirmar a alteração da senha?');
    expect(html).toContain('Sim');
    expect(html).toContain('Não');
  });
  it('nada no armazenamento do navegador', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(new URL('./form-troca-senha.tsx', import.meta.url), 'utf8')).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
