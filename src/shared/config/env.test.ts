import { describe, expect, it } from 'vitest';
import { lerEnv, validarComandoPrisma, validarShadow } from './env';

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

describe('validarComandoPrisma (spec §11.5)', () => {
  const remoto = 'postgresql://u:x@10.0.1.5:5432/sgo';
  const local = 'postgresql://u:x@127.0.0.1:55432/sgo_dev';

  it.each([
    [['migrate', 'dev']],
    [['migrate', 'reset', '--force']],
    [['migrate', 'diff']],
    [['db', 'push']],
  ])('recusa %j fora do dev local', (args) => {
    expect(() => validarComandoPrisma(['node', 'prisma', ...args], remoto)).toThrow('só contra o banco de dev local');
  });

  it('recusa comando destrutivo sem URL', () => {
    expect(() => validarComandoPrisma(['node', 'prisma', 'migrate', 'dev'], undefined)).toThrow(
      'só contra o banco de dev local',
    );
  });

  it('aceita comando destrutivo no dev local', () => {
    expect(() => validarComandoPrisma(['node', 'prisma', 'migrate', 'dev'], local)).not.toThrow();
  });

  it.each([[['migrate', 'deploy']], [['generate']], [['db', 'seed']]])('aceita %j em qualquer banco', (args) => {
    expect(() => validarComandoPrisma(['node', 'prisma', ...args], remoto)).not.toThrow();
  });
});

describe('dev local: host, porta e query isolados', () => {
  it.each([
    ['host remoto na porta de dev', 'postgresql://u:x@10.0.1.5:55432/sgo_shadow'],
    ['localhost na porta padrão', 'postgresql://u:x@localhost:5432/sgo_shadow'],
    ['?host= na query', 'postgresql://u:x@127.0.0.1:55432/sgo_shadow?host=sgo-prod_db&port=5432'],
    ['?hostaddr= na query', 'postgresql://u:x@127.0.0.1:55432/sgo_shadow?hostaddr=10.0.1.5'],
  ])('shadow com %s é recusado', (_caso, shadow) => {
    expect(() => validarShadow(dev, shadow)).toThrow('shadow fora do dev local');
  });

  it('shadow que só contém _shadow no meio é recusado', () => {
    expect(() => validarShadow(dev, 'postgresql://u:x@127.0.0.1:55432/sgo_shadow_old')).toThrow(
      'o banco shadow deve terminar em _shadow',
    );
  });

  it('comando destrutivo com ?host= na query é recusado', () => {
    expect(() =>
      validarComandoPrisma(['prisma', 'migrate', 'reset'], 'postgresql://u:x@127.0.0.1:55432/sgo_dev?host=10.0.1.5'),
    ).toThrow('só contra o banco de dev local');
  });

  it('lerEnv recusa shadow fora do dev local', () => {
    expect(() =>
      lerEnv({ DATABASE_URL: dev, SHADOW_DATABASE_URL: 'postgresql://u:x@10.0.1.5:55432/sgo_shadow' }),
    ).toThrow('shadow fora do dev local');
  });
});
