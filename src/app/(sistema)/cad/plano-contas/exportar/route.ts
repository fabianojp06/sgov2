import { exportarPlanoContas } from '@/modules/cad';
import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { definirRota } from '@/shared/authz';

// Download da listagem (US-024): ?formato=xlsx|csv&inativos=1. Só do próprio sistema (origem).
export const GET = definirRota({ funcionalidade: 'cad.plano_contas', acao: 'exportar' }, async (req, ctx) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const url = new URL(req.url);
  const formato = url.searchParams.get('formato');
  if (!ehFormatoArquivo(formato)) return respostaDeErro(400, 'formato', 'Formato inválido.');
  const r = await exportarPlanoContas(ctx, { formato, incluirInativos: url.searchParams.get('inativos') === '1' });
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  return respostaDeArquivo(`plano-de-contas.${formato}`, formato, r.valor);
});
