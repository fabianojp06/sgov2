import { notFound } from 'next/navigation';
import { FormPerfil, gradePermissoes, obterPerfil, salvarPerfil } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Alterar Perfil (US-037; UC02.26): dados, status e permissões.
export default async function AlterarPerfil({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirPagina('adm.perfis', 'alterar');
  const { id } = await params;
  const perfil = await obterPerfil(ctx, id);
  if (!perfil) notFound();
  const grade = await gradePermissoes(ctx, perfil.codigo);
  return (
    <div>
      <h1>Alterar Perfil</h1>
      <FormPerfil perfil={perfil} grade={grade} salvar={salvarPerfil} />
    </div>
  );
}
