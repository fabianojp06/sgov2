import { describe, expect, it } from 'vitest';
import { opcoesDeJob } from './pgboss';

describe('opcoesDeJob (US-010)', () => {
  it('padrão: 5 novas tentativas, espera de 30 s e backoff', () => {
    expect(opcoesDeJob()).toEqual({ retryLimit: 5, retryDelay: 30, retryBackoff: true });
  });

  it('tentativas conta o total; a chave única vira o id do job', () => {
    expect(opcoesDeJob({ tentativas: 1, chaveUnica: '6a7c1d2e-3f40-4b51-8c62-7d83e94fa0b2' })).toEqual({
      retryLimit: 0,
      retryDelay: 30,
      retryBackoff: true,
      id: '6a7c1d2e-3f40-4b51-8c62-7d83e94fa0b2',
    });
  });

  it.each([{ tentativas: 0 }, { tentativas: 1.5 }, { chaveUnica: 'nao-uuid' }])('recusa %j', (o) => {
    expect(() => opcoesDeJob(o)).toThrow();
  });
});
