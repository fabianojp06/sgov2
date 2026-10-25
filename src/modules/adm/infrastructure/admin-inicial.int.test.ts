import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { conferirSenha } from './senha-argon2';
import { criarSeedAdministradorInicial } from './admin-inicial';
import { seedAdm } from './seed';

// Administrador inicial e break-glass (R6 do plano do P5).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let cliente: ReturnType<typeof criarPrisma>;

const AGORA = new Date('2026-11-11T12:00:00Z');
// Valor gerado em tempo de execução: nada com cara de credencial literal no teste (GitGuardian).
const senhaForte = `Forte${'9'.repeat(6)}${Date.now()}`.slice(0, 20);
const env = (login: string, senha = senhaForte) => ({
  ADMIN_INICIAL_LOGIN: login,
  ADMIN_INICIAL_EMAIL: `${login.trim().toLowerCase()}@exemplo.org`,
  ADMIN_INICIAL_SENHA: senha,
});
const rodar = (e: Record<string, string | undefined>) =>
  executarSeeds(cliente, [criarSeedAdministradorInicial(e, () => AGORA)]);

const administradores = () =>
  cliente.usuario.findMany({ where: { perfis: { some: { perfil: { codigo: 'ADMINISTRADOR' } } } }, orderBy: { criadoEm: 'asc' } });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  cliente = criarPrisma(banco.urlMigrator);
  await executarSeeds(cliente, [seedAdm]);
});

afterAll(async () => {
  try {
    await cliente?.$disconnect();
  } finally {
    await banco?.parar();
  }
});

beforeEach(() => vi.restoreAllMocks());

describe('seedAdministradorInicial', () => {
  it('banco sem usuário e sem nenhuma variável: falha citando ADMIN_INICIAL_LOGIN', async () => {
    await expect(rodar({})).rejects.toThrow(
      expect.objectContaining({ cause: expect.objectContaining({ message: expect.stringContaining('ADMIN_INICIAL_LOGIN') }) }),
    );
  });

  it('banco sem usuário e sem variáveis: falha citando o nome, nunca o valor', async () => {
    await expect(rodar({ ADMIN_INICIAL_LOGIN: 'admin' })).rejects.toThrow(
      expect.objectContaining({ cause: expect.objectContaining({ message: expect.stringContaining('ADMIN_INICIAL_EMAIL') }) }),
    );
  });

  it('senha fraca (15 caracteres): falha sem mostrar a senha', async () => {
    const fraca = senhaForte.slice(0, 15);
    const erro = await rodar(env('admin', fraca)).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(JSON.stringify({ m: (erro as Error).message, c: String((erro as Error).cause) })).not.toContain(fraca);
    expect(await cliente.usuario.count()).toBe(0);
  });

  it('cria com login normalizado, troca obrigatória, validade de 7 dias e Histórico', async () => {
    await rodar(env(' Admin '));
    const [admin] = await administradores();
    expect(admin).toMatchObject({ login: 'Admin', loginNormalizado: 'admin', ativo: true, bloqueado: false });
    expect(admin?.trocaSenhaObrigatoria).toBe(true);
    expect(admin?.senhaExpiraEm?.toISOString()).toBe('2026-11-18T12:00:00.000Z');
    expect(await conferirSenha(admin?.senhaHash ?? '', senhaForte)).toBe(true);
    const h = await cliente.historicoOperacao.findFirst({ where: { registroId: admin?.id ?? '' } });
    expect(h).toMatchObject({ tipoOperacao: 'SISTEMA', funcionalidade: 'adm.seed' });
    expect(JSON.stringify(h, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(senhaForte);
  });

  it('com administrador ativo, não faz nada', async () => {
    const antes = await cliente.historicoOperacao.count();
    await rodar(env('outro'));
    expect(await administradores()).toHaveLength(1);
    expect(await cliente.historicoOperacao.count()).toBe(antes);
  });

  it('com usuários, sem administrador ativo e sem variáveis: não falha e avisa', async () => {
    await cliente.usuario.updateMany({ data: { bloqueado: true } });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await rodar({});
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('[ADMIN_INICIAL_AUSENTE]'));
  });

  it('administrador bloqueado e variáveis com o mesmo login: não falha e avisa o conflito', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await rodar(env('ADMIN'));
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('[ADMIN_INICIAL_CONFLITO]'));
    expect(await administradores()).toHaveLength(1);
  });

  it('administrador bloqueado e variáveis com outro login: cria outro (break-glass), auditado', async () => {
    await rodar(env('socorro'));
    const lista = await administradores();
    expect(lista.map((u) => u.loginNormalizado)).toEqual(['admin', 'socorro']);
    const socorro = lista[1];
    expect(await cliente.historicoOperacao.count({ where: { registroId: socorro?.id ?? '' } })).toBe(1);
  });

  it('perfil ADMINISTRADOR inativo: falha com mensagem clara', async () => {
    await cliente.usuario.updateMany({ data: { bloqueado: true } });
    await cliente.perfil.update({ where: { codigo: 'ADMINISTRADOR' }, data: { ativo: false } });
    try {
      await expect(rodar(env('terceiro'))).rejects.toThrow(
        expect.objectContaining({ cause: expect.objectContaining({ message: expect.stringContaining('perfil ADMINISTRADOR inativo') }) }),
      );
    } finally {
      await cliente.perfil.update({ where: { codigo: 'ADMINISTRADOR' }, data: { ativo: true } });
    }
  });

  it('duas seeds simultâneas criam um administrador só, sem erro', async () => {
    await cliente.usuario.updateMany({ data: { bloqueado: true } });
    const erros: unknown[] = [];
    await Promise.all([rodar(env('paralelo')), rodar(env('paralelo'))].map((p) => p.catch((e: unknown) => erros.push(e))));
    expect(erros).toEqual([]);
    expect(await cliente.usuario.count({ where: { loginNormalizado: 'paralelo' } })).toBe(1);
  });
});
