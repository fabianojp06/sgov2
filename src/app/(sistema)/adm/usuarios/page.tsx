import { ListaUsuarios, listarUsuarios } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Manter Usuários (UC02.11).
export default async function Usuarios({ searchParams }: { searchParams: Promise<{ aviso?: string | string[] }> }) {
  const ctx = await exigirPagina('adm.usuarios', 'consultar');
  const [usuarios, { aviso }] = await Promise.all([listarUsuarios(ctx), searchParams]);
  return (
    <ListaUsuarios usuarios={usuarios} podeIncluir={ctx.permissoes.has('adm.usuarios:incluir')} aviso={typeof aviso === 'string' ? aviso : undefined} />
  );
}
