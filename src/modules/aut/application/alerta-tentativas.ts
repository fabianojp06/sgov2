import type { PrismaClient } from '@/generated/prisma/client';
import { listarAdministradoresParaAlerta } from '@/modules/adm';
import { enviarEmail } from '@/modules/ger';
import { lerEnvAcesso } from '@/shared/config';
import { prisma } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { formatarDataHoraAlerta } from '../domain/alerta-tentativas';

// O alerta de tentativas malsucedidas: no limiar ou no bloqueio (UC01.05, REQ0040).
export type AlertaTentativas = { usuarioId: string; nome: string; login: string; tentativas: number; bloqueado: boolean };

export type DepsAlertaTentativas = {
  cliente: PrismaClient;
  enviarEmail: typeof enviarEmail;
  listarAdministradores: typeof listarAdministradoresParaAlerta;
};

// Avisa os administradores por e-mail (US-027): um e-mail para cada um, pelo outbox, numa transação
// curta e própria, depois do commit do login. Nunca lança: uma falha vai só ao log, sem o login, o
// nome nem o e-mail em claro (o ErroDominio do e-mail já traz o endereço mascarado).
// Destinatário inválido pula só aquele administrador; outro erro desfaz a transação, e ninguém recebe.
// Prazos curtos (revisão 12.12 do #380): com o pool cheio, o login responde em vez de esperar o padrão
// do Prisma (2 s + 5 s), e o alerta perdido fica no log. Risco aceito: a resposta do limiar e do
// bloqueio leva essa transação a mais, e só para login existente; não revela nada novo, porque o
// bloqueio já tem mensagem própria (BLOQUEADO).
const PRAZOS_ALERTA = { maxWait: 500, timeout: 2000 } as const;

export async function notificarAlertaTentativas(alerta: AlertaTentativas, agora: Date, deps: Partial<DepsAlertaTentativas> = {}): Promise<void> {
  const cliente = deps.cliente ?? prisma;
  const enviar = deps.enviarEmail ?? enviarEmail;
  const listar = deps.listarAdministradores ?? listarAdministradoresParaAlerta;
  const { usuarioId } = alerta;
  try {
    await cliente.$transaction(async (tx) => {
      const administradores = await listar(tx);
      if (administradores.length === 0) {
        console.warn('[LOGIN_ALERTA_SEM_DESTINATARIO]', { usuarioId });
        return;
      }
      const dataHora = formatarDataHoraAlerta(agora);
      const urlAcesso = `${lerEnvAcesso().urlPublica}/adm/usuarios`;
      for (const a of administradores) {
        try {
          await enviar(tx, 'usuario.alerta_tentativas', { email: a.email, nome: a.nome }, {
            nomeAdministrador: a.nome,
            nomeUsuario: alerta.nome,
            login: alerta.login,
            tentativas: alerta.tentativas,
            bloqueado: alerta.bloqueado,
            dataHora,
            urlAcesso,
          });
        } catch (erro) {
          if (!(erro instanceof ErroDominio)) throw erro;
          console.error('[LOGIN_ALERTA_EMAIL_FALHA]', { usuarioId, administradorId: a.id, codigo: erro.codigo, detalhes: erro.detalhes });
        }
      }
    }, PRAZOS_ALERTA);
  } catch (erro) {
    console.error('[LOGIN_ALERTA_EMAIL_FALHA]', {
      usuarioId,
      nome: erro instanceof Error ? erro.name : typeof erro,
      codigo: (erro as { code?: unknown } | null)?.code ?? null,
    });
  }
}
