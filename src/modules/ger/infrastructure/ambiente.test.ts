import { describe, expect, it } from 'vitest';
import { lerAmbiente } from './ambiente';

describe('lerAmbiente', () => {
  it.each(['dev', 'hml', 'producao'])('aceita %s', (AMBIENTE) => {
    expect(lerAmbiente({ AMBIENTE, NODE_ENV: 'production' })).toBe(AMBIENTE);
  });

  it('fora da imagem, a ausência conta como dev', () => {
    expect(lerAmbiente({})).toBe('dev');
    expect(lerAmbiente({ NODE_ENV: 'development' })).toBe('dev');
  });

  it.each([{ NODE_ENV: 'production' }, { NODE_ENV: 'production', AMBIENTE: ' ' }, { NODE_ENV: 'production', AMBIENTE: 'teste' }, { AMBIENTE: 'prod' }])(
    '%j → erro citando só o nome da variável',
    (fonte) => {
      expect(() => lerAmbiente(fonte)).toThrow('AMBIENTE ausente ou inválido (use dev, hml ou producao)');
    },
  );
});
