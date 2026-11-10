import { ativar, consultarEstadoSistema, desativar, listarAtivacoes, TelaSistema } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Ativação e Desativação do Sistema (US-036, UC02.01).
export default async function Sistema({ searchParams }: { searchParams: Promise<{ aviso?: string | string[] }> }) {
  const ctx = await exigirPagina('adm.sistema', 'consultar');
  const [estado, ativacoes, { aviso }] = await Promise.all([consultarEstadoSistema(ctx), listarAtivacoes(ctx), searchParams]);
  return (
    <TelaSistema
      estado={estado}
      ativacoes={ativacoes}
      podeAlterar={ctx.permissoes.has('adm.sistema:alterar')}
      aviso={typeof aviso === 'string' ? aviso : undefined}
      ativar={ativar}
      desativar={desativar}
    />
  );
}
