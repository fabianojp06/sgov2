import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AvisoDesativacao, consultarAviso, ROTA_AVISO } from './aviso-desativacao';

// Aviso da desativação na casca (D-P9-4): a consulta à rota trata 401 e a resposta que não é JSON
// (o proxy redirecionou para o login) recarregando a página; erro do servidor ou da rede é ignorado.
const resposta = (corpo: string, init: ResponseInit & { redirected?: boolean } = {}) => {
  const r = new Response(corpo, init);
  if (init.redirected) Object.defineProperty(r, 'redirected', { value: true });
  return r;
};
const comFetch = (r: Response | Error) => (async (url: RequestInfo | URL) => {
  expect(url).toBe(ROTA_AVISO);
  if (r instanceof Error) throw r;
  return r;
}) as typeof fetch;
const json = { headers: { 'content-type': 'application/json' } };

describe('consultarAviso', () => {
  it('JSON com segundos → os segundos; com null → null', async () => {
    expect(await consultarAviso(comFetch(resposta('{"segundos":120}', json)))).toEqual({ segundos: 120 });
    expect(await consultarAviso(comFetch(resposta('{"segundos":null}', json)))).toEqual({ segundos: null });
  });

  it('401 (sessão caiu) → recarregar', async () =>
    expect(await consultarAviso(comFetch(resposta('{"erros":[]}', { status: 401, ...json })))).toBe('recarregar'));

  it('HTML depois de redirecionar (sem cookie) → recarregar', async () =>
    expect(await consultarAviso(comFetch(resposta('<html></html>', { headers: { 'content-type': 'text/html' }, redirected: true })))).toBe('recarregar'));

  it('500 ou rede fora → ignorar', async () => {
    expect(await consultarAviso(comFetch(resposta('{"erros":[]}', { status: 500, ...json })))).toBe('ignorar');
    expect(await consultarAviso(comFetch(new TypeError('rede')))).toBe('ignorar');
  });
});

describe('AvisoDesativacao', () => {
  it('com segundos, mostra o aviso do UC02.01 2.7; sem, nada', () => {
    expect(renderToString(createElement(AvisoDesativacao, { segundos: 240 }))).toContain(
      'O sistema será desativado em 4 minutos. Por favor, salve seus trabalhos correntes.',
    );
    expect(renderToString(createElement(AvisoDesativacao, { segundos: null }))).not.toContain('será desativado');
  });
});
