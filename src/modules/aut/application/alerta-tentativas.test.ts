import type { PrismaClient } from '@/generated/prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdministradorParaAlerta } from '@/modules/adm';
import { emailFalso } from '@/modules/ger';
import { lerEnvAcesso } from '@/shared/config';
import { ErroDominio } from '@/shared/kernel';
import { notificarAlertaTentativas, type AlertaTentativas } from './alerta-tentativas';

// Alerta ao Administrador por e-mail (US-027, REQ0040): um e-mail por administrador, pela outbox,
// numa transação própria depois do commit do login; falha só vai ao log, mascarada.
const AGORA = new Date('2026-11-11T12:00:00.000Z');
const ALERTA: AlertaTentativas = { usuarioId: 'u-1', nome: 'Carla Souza', login: 'carla', tentativas: 3, bloqueado: false };
const ADMS: AdministradorParaAlerta[] = [
  { id: 'a-1', nome: 'Ana Admin', email: 'ana@exemplo.org' },
  { id: 'a-2', nome: 'Beto Admin', email: 'beto@exemplo.org' },
];
const transacoes = { total: 0 };
const cliente = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => (transacoes.total++, fn({})) } as unknown as PrismaClient;

afterEach(() => {
  vi.restoreAllMocks();
  transacoes.total = 0;
});

describe('notificarAlertaTentativas', () => {
  it('no limiar: um e-mail por administrador, com os dados do modelo, numa transação', async () => {
    const email = emailFalso<'usuario.alerta_tentativas'>();
    await notificarAlertaTentativas(ALERTA, AGORA, { cliente, enviarEmail: email.enviarEmail, listarAdministradores: async () => ADMS });
    expect(transacoes.total).toBe(1);
    expect(email.enviados).toEqual([
      {
        modelo: 'usuario.alerta_tentativas',
        destinatario: { email: 'ana@exemplo.org', nome: 'Ana Admin' },
        dados: {
          nomeAdministrador: 'Ana Admin',
          nomeUsuario: 'Carla Souza',
          login: 'carla',
          tentativas: 3,
          bloqueado: false,
          dataHora: '11/11/2026, 09:00',
          urlAcesso: `${lerEnvAcesso().urlPublica}/adm/usuarios`,
        },
      },
      expect.objectContaining({ destinatario: { email: 'beto@exemplo.org', nome: 'Beto Admin' }, dados: expect.objectContaining({ nomeAdministrador: 'Beto Admin' }) }),
    ]);
  });

  it('no bloqueio: bloqueado = true e o número de tentativas do bloqueio', async () => {
    const email = emailFalso<'usuario.alerta_tentativas'>();
    await notificarAlertaTentativas({ ...ALERTA, tentativas: 5, bloqueado: true }, AGORA, {
      cliente,
      enviarEmail: email.enviarEmail,
      listarAdministradores: async () => ADMS.slice(0, 1),
    });
    expect(email.enviados.map((e) => [e.dados.tentativas, e.dados.bloqueado])).toEqual([[5, true]]);
  });

  it('sem administrador com e-mail: nenhum envio e um aviso no log, sem login nem nome', async () => {
    const email = emailFalso<'usuario.alerta_tentativas'>();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notificarAlertaTentativas(ALERTA, AGORA, { cliente, enviarEmail: email.enviarEmail, listarAdministradores: async () => [] });
    expect(email.enviados).toEqual([]);
    expect(aviso).toHaveBeenCalledWith('[LOGIN_ALERTA_SEM_DESTINATARIO]', { usuarioId: 'u-1' });
    expect(JSON.stringify(aviso.mock.calls)).not.toMatch(/carla|Carla/);
  });

  it('destinatário inválido: pula esse administrador, envia aos outros e registra o erro mascarado', async () => {
    const email = emailFalso<'usuario.alerta_tentativas'>();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adms = [{ id: 'a-0', nome: 'Zé', email: 'ze.sem.dominio' }, ...ADMS];
    await notificarAlertaTentativas(ALERTA, AGORA, { cliente, enviarEmail: email.enviarEmail, listarAdministradores: async () => adms });
    expect(email.enviados.map((e) => e.destinatario.email)).toEqual(['ana@exemplo.org', 'beto@exemplo.org']);
    expect(erro).toHaveBeenCalledWith('[LOGIN_ALERTA_EMAIL_FALHA]', {
      usuarioId: 'u-1',
      administradorId: 'a-0',
      codigo: 'email.destinatario_invalido',
      detalhes: { email: 'ze***(14)' },
    });
    expect(JSON.stringify(erro.mock.calls)).not.toMatch(/ze.sem.dominio|carla/);
  });

  it('erro inesperado (banco, outbox): não lança; o log leva só o nome e o código', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const falha = Object.assign(new Error('falhou com carla e ana@exemplo.org'), { code: 'P2010' });
    await expect(
      notificarAlertaTentativas(ALERTA, AGORA, {
        cliente,
        enviarEmail: async () => {
          throw falha;
        },
        listarAdministradores: async () => ADMS,
      }),
    ).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalledWith('[LOGIN_ALERTA_EMAIL_FALHA]', { usuarioId: 'u-1', nome: 'Error', codigo: 'P2010' });
    expect(JSON.stringify(erro.mock.calls)).not.toMatch(/carla|ana@/);
  });

  it('erro de domínio sem ser de destinatário também não lança', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await notificarAlertaTentativas(ALERTA, AGORA, {
      cliente,
      enviarEmail: async () => {
        throw new ErroDominio('email.dados_invalidos', 'Dados do e-mail inválidos.', { campo: 'urlAcesso' });
      },
      listarAdministradores: async () => ADMS.slice(0, 1),
    });
    expect(erro).toHaveBeenCalledWith('[LOGIN_ALERTA_EMAIL_FALHA]', {
      usuarioId: 'u-1',
      administradorId: 'a-1',
      codigo: 'email.dados_invalidos',
      detalhes: { campo: 'urlAcesso' },
    });
  });
});
