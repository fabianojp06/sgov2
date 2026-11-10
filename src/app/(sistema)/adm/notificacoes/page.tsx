import { adicionarNotificacao, listarNotificacoes, listarOpcoesNotificacao, removerNotificacao, TelaNotificacoes } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Notificações de Desempenho (US-041; EP085 UC02.20, grupo "Desempenho").
export default async function Notificacoes({ searchParams }: { searchParams: Promise<{ aviso?: string | string[] }> }) {
  const ctx = await exigirPagina('adm.notificacoes', 'consultar');
  const podeIncluir = ctx.permissoes.has('adm.notificacoes:incluir');
  const [linhas, opcoes, { aviso }] = await Promise.all([
    listarNotificacoes(ctx),
    podeIncluir ? listarOpcoesNotificacao(ctx) : Promise.resolve({ contas: [], usuarios: [] }),
    searchParams,
  ]);
  return (
    <TelaNotificacoes
      linhas={linhas}
      contas={opcoes.contas}
      usuarios={opcoes.usuarios}
      podeIncluir={podeIncluir}
      podeExcluir={ctx.permissoes.has('adm.notificacoes:excluir')}
      aviso={typeof aviso === 'string' ? aviso : undefined}
      adicionar={adicionarNotificacao}
      excluir={removerNotificacao}
    />
  );
}
