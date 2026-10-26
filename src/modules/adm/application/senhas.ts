import type { TxCliente } from '@/shared/db';

// Nova senha escolhida pelo próprio usuário (UC02.19): deixa de ser temporária.
export async function gravarNovaSenha(tx: TxCliente, usuarioId: string, hash: string): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { senhaHash: hash, trocaSenhaObrigatoria: false, senhaExpiraEm: null, versao: { increment: 1 } },
  });
}
