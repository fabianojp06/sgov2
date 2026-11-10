import { exportarCentrosCusto } from '@/modules/cad';
import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeAgendamento, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { definirRota } from '@/shared/authz';

// Download da listagem (US-024): ?formato=xlsx|csv&inativos=1 e os filtros da grade (busca, tipo),
// validados pelas definições da tela. Só do próprio sistema (origem).
export const GET = definirRota({ funcionalidade: 'cad.centros_custo', acao: 'exportar' }, async (req, ctx) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const url = new URL(req.url);
  const formato = url.searchParams.get('formato');
  if (!ehFormatoArquivo(formato)) return respostaDeErro(400, 'formato', 'Formato inválido.');
  const r = await exportarCentrosCusto(ctx, { formato, incluirInativos: url.searchParams.get('inativos') === '1', filtros: Object.fromEntries(url.searchParams) });
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  // Acima de 5.000 linhas, o pedido vai para o worker e a pessoa, para Minhas exportações.
  if (r.valor.tipo === 'agendada') return respostaDeAgendamento(r.valor.pedidoId);
  return respostaDeArquivo(r.valor.nome, formato, r.valor.bytes);
});
