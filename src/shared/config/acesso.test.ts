import { describe, expect, it } from 'vitest';
import { lerEnvAcesso } from './acesso';

describe('lerEnvAcesso (URL_PUBLICA, CONFIAR_PROXY)', () => {
  it('padrão de dev: http em loopback, sem proxy confiável', () =>
    expect(lerEnvAcesso({ NODE_ENV: 'development' })).toEqual({
      urlPublica: 'http://127.0.0.1:3100',
      seguro: false,
      confiarProxy: false,
    }));

  it('https liga o Secure e o prefixo __Host-', () =>
    expect(lerEnvAcesso({ NODE_ENV: 'production', URL_PUBLICA: 'https://sgo.exemplo.org' })).toMatchObject({
      urlPublica: 'https://sgo.exemplo.org',
      seguro: true,
    }));

  it('em produção, http fora de loopback é recusado', () =>
    expect(() => lerEnvAcesso({ NODE_ENV: 'production', URL_PUBLICA: 'http://sgo.exemplo' })).toThrow(/https/));

  it('em produção, http em loopback é aceito (E2E)', () =>
    expect(lerEnvAcesso({ NODE_ENV: 'production', URL_PUBLICA: 'http://127.0.0.1:3190' })).toMatchObject({ seguro: false }));

  it('em produção, URL_PUBLICA é obrigatória', () => expect(() => lerEnvAcesso({ NODE_ENV: 'production' })).toThrow(/URL_PUBLICA/));

  it('URL com caminho é recusada (os links somam /login)', () =>
    expect(() => lerEnvAcesso({ URL_PUBLICA: 'https://x.org/sgo' })).toThrow(/origem/));

  it('CONFIAR_PROXY=1 liga; outro valor é recusado', () => {
    expect(lerEnvAcesso({ CONFIAR_PROXY: '1' }).confiarProxy).toBe(true);
    expect(() => lerEnvAcesso({ CONFIAR_PROXY: 'sim' })).toThrow(/CONFIAR_PROXY/);
  });
});
