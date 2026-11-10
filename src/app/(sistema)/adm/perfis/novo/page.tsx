import { cadastrarPerfil, FormPerfil, gradePermissoes } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Cadastrar Perfil (US-037; UC02.25): a grade começa sem nada marcado (RN0058).
export default async function NovoPerfil() {
  const ctx = await exigirPagina('adm.perfis', 'incluir');
  const grade = await gradePermissoes(ctx, null);
  return (
    <div>
      <h1>Cadastrar Perfil</h1>
      <FormPerfil grade={grade} salvar={cadastrarPerfil} />
    </div>
  );
}
