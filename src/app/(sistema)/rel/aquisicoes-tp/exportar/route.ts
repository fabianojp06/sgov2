import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { exportarAquisicoesTp, PORTA_REALIZADO } from '@/modules/rel';
import { definirRota } from '@/shared/authz';

// Download do demonstrativo de aquisições do TP (US-097): ?tp=…&de=…&ate=…&conta=…&descricao=…&zerados=sim&formato=xlsx|csv|pdf.
// É um GET que grava a EXPORTACAO no Histórico: só o próprio sistema (same-origin) ou o endereço digitado exportam.
export const GET = definirRota({ funcionalidade: 'rel.aquisicoes_tp', acao: 'exportar' }, async (req, ctx) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const url = new URL(req.url);
  const formato = url.searchParams.get('formato');
  if (!ehFormatoArquivo(formato)) return respostaDeErro(400, 'formato', 'Formato inválido.');
  const p = (n: string) => url.searchParams.get(n) ?? '';
  const filtros = { tp: p('tp'), de: p('de'), ate: p('ate'), conta: p('conta'), descricao: p('descricao'), zerados: p('zerados') };
  const r = await exportarAquisicoesTp(ctx, filtros, formato, PORTA_REALIZADO);
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  return respostaDeArquivo(r.valor.nome, formato, r.valor.bytes);
});
