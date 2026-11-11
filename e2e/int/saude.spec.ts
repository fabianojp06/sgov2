import { expect, test } from '@playwright/test';

// Endpoint de saúde (US-017) pelo caminho real, sem sessão: o proxy libera só /int/saude (#401) e a
// rota responde o estado em JSON, sem redirecionar ao login. No E2E não há worker rodando: o banco
// responde e o worker aparece parado (503), que é o que o monitor externo veria.
test('sem sessão: /int/saude responde o estado, sem redirecionar nem ir para cache', async ({ request }) => {
  const r = await request.get('/int/saude', { maxRedirects: 0 });
  expect([200, 503]).toContain(r.status());
  expect(r.headers()['location']).toBeUndefined();
  expect(r.headers()['cache-control']).toContain('no-store');
  expect(r.headers()['x-content-type-options']).toBe('nosniff');
  const corpo = (await r.json()) as Record<string, unknown>;
  expect(Object.keys(corpo).sort()).toEqual(['banco', 'status', 'worker']);
  expect(corpo['banco']).toBe('ok');
  expect(corpo['status']).toBe(r.status() === 200 ? 'ok' : 'falha');
});

test('só o caminho exato e só GET: outras variantes vão ao login e POST não é aceito', async ({ request }) => {
  // A barra final é normalizada pelo Next (308) para o próprio /int/saude, não para outro caminho.
  const barra = await request.get('/int/saude/', { maxRedirects: 0 });
  expect(barra.status()).toBe(308);
  expect(barra.headers()['location']).toMatch(/\/int\/saude$/);
  for (const rota of ['/int/saude/x', '/INT/SAUDE', '/int/saudex']) {
    const r = await request.get(rota, { maxRedirects: 0 });
    expect(r.status(), rota).toBe(307);
    expect(r.headers()['location'], rota).toMatch(/\/login$/);
  }
  const post = await request.post('/int/saude', { maxRedirects: 0 });
  expect(post.status()).toBe(405);
});
