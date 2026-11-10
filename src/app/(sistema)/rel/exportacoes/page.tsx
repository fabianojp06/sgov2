import { DIAS_DISPONIVEL, listarMinhasExportacoes, type SituacaoPedido } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Minhas exportações (US-024, RF_IMP_003): a listagem acima de 5.000 linhas é gerada em segundo plano;
// aqui a pessoa acompanha e baixa. ?pedido=<id> vem do redirecionamento da exportação agendada.
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const SITUACAO: Record<SituacaoPedido, string> = { PENDENTE: 'Em geração', PRONTA: 'Pronta', FALHOU: 'Falhou' };

export default async function MinhasExportacoes({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const ctx = await exigirPagina('rel.exportacoes', 'consultar');
  const { pedido } = await searchParams;
  const pedidos = await listarMinhasExportacoes(ctx);
  const recemPedido = pedidos.find((p) => p.id === pedido);
  return (
    <div>
      <h1>Minhas exportações</h1>
      {recemPedido && (
        <p role="status">
          A exportação de {recemPedido.titulo} passa de 5.000 linhas e está sendo gerada em segundo plano. Atualize esta página para
          acompanhar; o arquivo fica disponível aqui.
        </p>
      )}
      <p>Exportações geradas em segundo plano nos últimos {DIAS_DISPONIVEL} dias.</p>
      {pedidos.length === 0 ? (
        <p>Nenhuma exportação em segundo plano.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Pedido em</th>
              <th scope="col">Listagem</th>
              <th scope="col">Formato</th>
              <th scope="col">Situação</th>
              <th scope="col">Registros</th>
              <th scope="col">Arquivo</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr key={p.id}>
                <td>{HORA.format(new Date(p.criadoEm))}</td>
                <td>{p.titulo}</td>
                <td>{p.formato.toUpperCase()}</td>
                <td>{p.situacao === 'FALHOU' && p.erro ? `${SITUACAO[p.situacao]}: ${p.erro}` : SITUACAO[p.situacao]}</td>
                <td>{p.registros ?? ''}</td>
                <td>{p.situacao === 'PRONTA' ? <a href={`/rel/exportacoes/${p.id}`}>Baixar</a> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
