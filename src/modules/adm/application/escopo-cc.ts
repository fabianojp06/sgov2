import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';

// CC raiz de escopo do usuário (C25), lido pelo orc. null = sem escopo (vê a Adm. Central inteira).
// Usuário inexistente é erro, nunca "sem escopo": o escopo falha fechado (R16 do plano do P6).
export async function obterEscopoCentroCusto(tx: TxCliente, usuarioId: string): Promise<string | null> {
  const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { ccEscopo: true } });
  if (!u) throw new ErroDominio('adm.usuario_inexistente', 'Usuário não encontrado.');
  return u.ccEscopo;
}
