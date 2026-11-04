import { randomBytes } from 'node:crypto';
import type { MotivoAusenciaSessao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { gerarSessaoUid } from '../domain/sessao';
import { hashDoToken } from './token';

// Emite a sessão única do usuário (RN0519): apaga as anteriores e cria uma nova, com token
// aleatório de 256 bits e só o SHA-256 no banco. Usada pelo login e pela troca de senha (que
// rotaciona o token, porque a sessão muda de "só troca de senha" para o acesso completo).
// No login (motivoAnteriores = 'NOVO_ACESSO'), cada sessão apagada deixa a marca da US-028, com o
// prazo dela; as marcas anteriores do usuário e as vencidas saem. A troca de senha passa null.
export async function emitirSessao(
  tx: TxCliente,
  e: {
    usuarioId: string;
    acessoVersao: number;
    trocaSenhaPendente: boolean;
    ip: string | null;
    agora: Date;
    maximoHoras: number;
    motivoAnteriores: MotivoAusenciaSessao | null;
  },
): Promise<{ token: string; expiraEm: Date; sessaoUid: string; anteriores: number }> {
  if (e.motivoAnteriores) {
    await tx.sessaoEncerrada.deleteMany({ where: { OR: [{ usuarioId: e.usuarioId }, { expiraEm: { lte: e.agora } }] } });
    const vivas = await tx.sessaoUsuario.findMany({ where: { usuarioId: e.usuarioId }, select: { tokenHash: true, expiraEm: true } });
    if (vivas.length > 0) {
      await tx.sessaoEncerrada.createMany({
        data: vivas.map((v) => ({ tokenHash: v.tokenHash, usuarioId: e.usuarioId, motivo: e.motivoAnteriores!, encerradaEm: e.agora, expiraEm: v.expiraEm })),
      });
    }
  }
  const anteriores = await tx.sessaoUsuario.deleteMany({ where: { usuarioId: e.usuarioId } });
  const token = randomBytes(32).toString('base64url');
  const sessaoUid = gerarSessaoUid(e.agora, e.ip, e.usuarioId);
  const expiraEm = new Date(e.agora.getTime() + e.maximoHoras * 60 * 60 * 1000);
  await tx.sessaoUsuario.create({
    data: {
      usuarioId: e.usuarioId,
      tokenHash: hashDoToken(token),
      sessaoUid,
      ip: e.ip,
      criadaEm: e.agora,
      ultimoAcessoEm: e.agora,
      expiraEm,
      acessoVersao: e.acessoVersao,
      trocaSenhaPendente: e.trocaSenhaPendente,
    },
  });
  return { token, expiraEm, sessaoUid, anteriores: anteriores.count };
}
