import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { exportarViagensTp, PORTA_REALIZADO } from '@/modules/rel';
import { definirRota } from '@/shared/authz';

// Download do demonstrativo de despesas com viagens do TP (US-097): ?tp=…&de=…&ate=…&texto=…&zerados=sim&formato=xlsx|csv|pdf.
// É um GET que grava a EXPORTACAO no Histórico: só o próprio sistema (same-origin) ou o endereço digitado exportam.
export const GET = definirRota({ funcionalidade: 'rel.viagens_tp', acao: 'exportar' }, async (req, ctx) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const url = new URL(req.url);
  const formato = url.searchParams.get('formato');
  if (!ehFormatoArquivo(formato)) return respostaDeErro(400, 'formato', 'Formato inválido.');
  const p = (n: string) => url.searchParams.get(n) ?? '';
  const filtros = { tp: p('tp'), de: p('de'), ate: p('ate'), texto: p('texto'), zerados: p('zerados') };
  const r = await exportarViagensTp(ctx, filtros, formato, PORTA_REALIZADO);
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  return respostaDeArquivo(r.valor.nome, formato, r.valor.bytes);
});
