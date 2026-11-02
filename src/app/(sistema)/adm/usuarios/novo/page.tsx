import { cadastrar, FormUsuario, listarOpcoesUsuario } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Cadastrar Usuário (UC02.12).
export default async function NovoUsuario() {
  const ctx = await exigirPagina('adm.usuarios', 'incluir');
  const opcoes = await listarOpcoesUsuario(ctx);
  return (
    <main>
      <h1>Cadastrar Usuário</h1>
      <FormUsuario opcoes={opcoes} salvar={cadastrar} />
    </main>
  );
}
