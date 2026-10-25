import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/authz/configuracao', () => ({ configurarProvedorContexto: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('registrarAutenticacao', () => {
  it('em produção sem CONFIAR_PROXY, avisa uma vez', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('URL_PUBLICA', 'https://sgo.exemplo.org');
    vi.stubEnv('CONFIAR_PROXY', '');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registrarAutenticacao } = await import('./registrar');
    registrarAutenticacao();
    registrarAutenticacao();
    expect(aviso.mock.calls.filter((c) => String(c[0]).includes('[CONFIAR_PROXY_AUSENTE]'))).toHaveLength(1);
  });

  it('com URL_PUBLICA inválida em produção, falha cedo', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('URL_PUBLICA', 'http://sgo.exemplo.org');
    const { registrarAutenticacao } = await import('./registrar');
    expect(() => registrarAutenticacao()).toThrow(/https/);
  });
});
