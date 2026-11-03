import { notFound } from 'next/navigation';
import { alterar, desbloquear, FormUsuario, gerarNovaSenha, listarOpcoesUsuario, obterUsuario } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Alterar Usuário (UC02.13).
export default async function AlterarUsuario({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirPagina('adm.usuarios', 'alterar');
  const { id } = await params;
  const [usuario, opcoes] = await Promise.all([obterUsuario(ctx, id), listarOpcoesUsuario(ctx, id)]);
  if (!usuario) notFound();
  return (
    <main>
      <h1>Alterar Usuário</h1>
      <FormUsuario usuario={usuario} opcoes={opcoes} salvar={alterar} resetarSenha={gerarNovaSenha} desbloquear={desbloquear} />
    </main>
  );
}
