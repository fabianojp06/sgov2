import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ atual: { status: 'ok', banco: 'ok', worker: 'ok' } as Record<string, string> }));
vi.mock('@/modules/int', () => ({ verificarSaude: async () => estado.atual }));
const { GET } = await import('./route');

// Endpoint de saúde (US-017): 200 com tudo ok, 503 com falha, nunca em cache.
describe('GET /int/saude', () => {
  it('tudo ok: 200', async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ status: 'ok', banco: 'ok', worker: 'ok' });
  });

  it('worker parado: 503 com o componente', async () => {
    estado.atual = { status: 'falha', banco: 'ok', worker: 'parado' };
    const r = await GET();
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ status: 'falha', banco: 'ok', worker: 'parado' });
  });
});
