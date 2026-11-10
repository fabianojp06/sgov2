import { ListaAlcadas, listarAlcadas } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Alçadas de Aprovação (US-042, §11.4).
export default async function Alcadas({ searchParams }: { searchParams: Promise<{ aviso?: string | string[] }> }) {
  const ctx = await exigirPagina('adm.alcadas', 'consultar');
  const [alcadas, { aviso }] = await Promise.all([listarAlcadas(ctx), searchParams]);
  return (
    <ListaAlcadas
      alcadas={alcadas}
      podeIncluir={ctx.permissoes.has('adm.alcadas:incluir')}
      podeAlterar={ctx.permissoes.has('adm.alcadas:alterar')}
      aviso={typeof aviso === 'string' ? aviso : undefined}
    />
  );
}
