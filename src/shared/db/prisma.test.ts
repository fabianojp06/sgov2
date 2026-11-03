import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Sem DATABASE_URL, instanciar o cliente lança (lerEnv): os acessos abaixo provam que não instanciam.
afterEach(() => vi.unstubAllEnvs());

describe('prisma preguiçoso (#165)', () => {
  it('then, await e o inspect do Node não instanciam o cliente; um membro e o "in" instanciam', async () => {
    vi.stubEnv('DATABASE_URL', '');
    delete (globalThis as { __sgoPrisma?: unknown }).__sgoPrisma; // não depende do isolamento do vitest
    const { prisma } = await import('./prisma');
    expect((prisma as unknown as { then?: unknown }).then).toBeUndefined();
    expect('then' in prisma).toBe(false);
    await expect(Promise.resolve(prisma)).resolves.toBe(prisma);
    expect(inspect(prisma)).toBe('{}');
    expect(() => prisma.usuario).toThrow(/DATABASE_URL/);
    expect(() => 'usuario' in prisma).toThrow(/DATABASE_URL/);
  });
});
