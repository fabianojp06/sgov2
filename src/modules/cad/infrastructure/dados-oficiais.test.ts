import { describe, expect, it } from 'vitest';
import * as cadServidor from '@/modules/cad/servidor';
import { ambienteDaSeed } from './seed-referencia';

// Seeds pelo servidor.ts (E-N3) e a regra de AMBIENTE da seed (R25). A igualdade entre a planilha
// de especificacao/ e o JSON oficial está no plano-contas-oficial.test.ts (Task 4a).
describe('seeds do cad', () => {
  it('saem pelo servidor.ts', () => {
    expect(cadServidor.seedCad.nome).toBe('cad');
    expect(cadServidor.seedDadosReferenciaCad.nome).toBe('cad (dados de referência)');
  });

  it.each([
    [{ NODE_ENV: 'production' }, /AMBIENTE_AUSENTE/],
    [{ NODE_ENV: 'production', AMBIENTE: 'prod' }, /AMBIENTE_INVALIDO/],
    [{ NODE_ENV: 'production', AMBIENTE: '  ' }, /AMBIENTE_AUSENTE/],
    [{ NODE_ENV: 'development', AMBIENTE: 'xyz' }, /AMBIENTE_INVALIDO/],
  ])('%j → erro', (env, erro) => {
    expect(() => ambienteDaSeed(env as NodeJS.ProcessEnv)).toThrow(erro);
    expect(() => ambienteDaSeed(env as NodeJS.ProcessEnv)).toThrow('AMBIENTE ausente ou inválido (use dev, hml ou producao)');
  });

  it.each([
    [{ NODE_ENV: 'production', AMBIENTE: 'producao' }, 'producao'],
    [{ NODE_ENV: 'production', AMBIENTE: 'hml' }, 'hml'],
    [{ NODE_ENV: 'development' }, 'dev'],
    [{}, 'dev'],
    [{ AMBIENTE: 'dev' }, 'dev'],
    [{ NODE_ENV: 'production', AMBIENTE: ' hml ' }, 'hml'],
  ])('%j → %s', (env, esperado) => {
    expect(ambienteDaSeed(env as NodeJS.ProcessEnv)).toBe(esperado);
  });
});
