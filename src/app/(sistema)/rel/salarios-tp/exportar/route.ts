import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { exportarPessoalTp, PORTA_PESSOAL } from '@/modules/rel';
import { definirRota } from '@/shared/authz';

// Download do relatório "Salários dos empregados do TP" (US-098): ?tp=…&de=…&ate=…&cargo=…&meta=…&categoria=…&formato=xlsx|csv|pdf. É um GET
// que grava a EXPORTACAO no Histórico: só o próprio sistema (same-origin) ou o endereço digitado exportam.
export const GET = definirRota({ funcionalidade: 'rel.salarios_tp', acao: 'exportar' }, async (req, ctx) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const url = new URL(req.url);
  const formato = url.searchParams.get('formato');
  if (!ehFormatoArquivo(formato)) return respostaDeErro(400, 'formato', 'Formato inválido.');
  const p = (n: string) => url.searchParams.get(n) ?? '';
  const filtros = { tp: p('tp'), de: p('de'), ate: p('ate'), cargo: p('cargo'), meta: p('meta'), categoria: p('categoria') };
  const r = await exportarPessoalTp(ctx, 'salarios', filtros, formato, PORTA_PESSOAL);
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  return respostaDeArquivo(r.valor.nome, formato, r.valor.bytes);
});
