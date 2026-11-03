import type { TxCliente } from '@/shared/db';

// Nova senha escolhida pelo próprio usuário (UC02.19): deixa de ser temporária. Não muda a versão do
// cadastro, como o reset: o formulário aberto do Administrador continua valendo. Com um reset ao
// mesmo tempo, vale o último a gravar, e o acessoVersao derruba a sessão da troca.
export async function gravarNovaSenha(tx: TxCliente, usuarioId: string, hash: string): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { senhaHash: hash, trocaSenhaObrigatoria: false, senhaExpiraEm: null },
  });
}
