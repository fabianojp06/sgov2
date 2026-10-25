import { describe, expect, it, vi } from 'vitest';
import { sairDoSistema } from './sair-cliente';

function armazenamento(chaves: string[]) {
  const dados = new Map(chaves.map((c) => [c, 'x']));
  return {
    get length() {
      return dados.size;
    },
    key: (i: number) => [...dados.keys()][i] ?? null,
    removeItem: (c: string) => void dados.delete(c),
    chaves: () => [...dados.keys()],
  };
}

describe('sairDoSistema (UC01.04, RNF0010)', () => {
  it.each([
    ['204', async () => new Response(null, { status: 204 })],
    ['401', async () => new Response(null, { status: 401 })],
    ['500', async () => new Response(null, { status: 500 })],
    ['erro de rede', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('com %s: limpa o armazenamento e sempre vai para /login?saiu=1', async (_caso, resposta) => {
    const fetchFalso = vi.fn(resposta);
    const location = { replace: vi.fn() };
    const a = armazenamento(['sgo:filtro', 'sgo:grade', 'outro']);
    await sairDoSistema(fetchFalso, location, a);
    expect(fetchFalso).toHaveBeenCalledWith('/aut/sair', { method: 'POST', credentials: 'same-origin' });
    expect(location.replace).toHaveBeenCalledWith('/login?saiu=1');
    expect(a.chaves()).toEqual(['outro']);
  });
});
