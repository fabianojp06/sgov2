import { describe, expect, it } from 'vitest';
import { lerEnv, validarShadow } from './env';

const dev = 'postgresql://sgo_migrator:x@127.0.0.1:55432/sgo_dev';

describe('validarShadow (spec §11.5)', () => {
  it('recusa shadow igual ao banco principal', () => {
    expect(() => validarShadow(dev, dev)).toThrow('shadow igual ao banco principal');
  });

  it('recusa shadow fora do dev local', () => {
    expect(() =>
      validarShadow('postgresql://u:x@127.0.0.1:55432/sgo_dev', 'postgresql://u:x@sgo-prod_db:5432/sgo_shadow'),
    ).toThrow('shadow fora do dev local');
  });

  it('recusa shadow que não termina em _shadow', () => {
    expect(() => validarShadow(dev, 'postgresql://u:x@127.0.0.1:55432/sgo_dev')).toThrow(
      'o banco shadow deve terminar em _shadow',
    );
  });

  it('aceita o shadow do dev local', () => {
    expect(() => validarShadow(dev, 'postgresql://u:x@127.0.0.1:55432/sgo_shadow')).not.toThrow();
  });

  it('aceita a ausência de shadow', () => {
    expect(() => validarShadow(dev, undefined)).not.toThrow();
  });
});

describe('lerEnv', () => {
  it('exige DATABASE_URL', () => {
    expect(() => lerEnv({})).toThrow('DATABASE_URL');
  });

  it('lê as URLs e valida o shadow', () => {
    const env = lerEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://sgo_app:x@127.0.0.1:55432/sgo_dev',
      MIGRATE_DATABASE_URL: dev,
      SHADOW_DATABASE_URL: 'postgresql://sgo_migrator:x@127.0.0.1:55432/sgo_shadow',
    });
    expect(env.DATABASE_URL).toContain('sgo_app');
    expect(env.SHADOW_DATABASE_URL).toContain('sgo_shadow');
  });

  it('recusa URL que não é postgresql://', () => {
    expect(() => lerEnv({ DATABASE_URL: 'mysql://u:x@127.0.0.1/db' })).toThrow('DATABASE_URL');
  });
});
