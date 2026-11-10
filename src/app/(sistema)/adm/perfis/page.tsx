import { ListaPerfis, listarPerfis, removerPerfil } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Perfis de Usuário (US-037; UC02.07).
export default async function Perfis({ searchParams }: { searchParams: Promise<{ aviso?: string | string[] }> }) {
  const ctx = await exigirPagina('adm.perfis', 'consultar');
  const [perfis, { aviso }] = await Promise.all([listarPerfis(ctx), searchParams]);
  return (
    <ListaPerfis
      perfis={perfis}
      podeIncluir={ctx.permissoes.has('adm.perfis:incluir')}
      podeAlterar={ctx.permissoes.has('adm.perfis:alterar')}
      podeExcluir={ctx.permissoes.has('adm.perfis:excluir')}
      excluir={removerPerfil}
      aviso={typeof aviso === 'string' ? aviso : undefined}
    />
  );
}
