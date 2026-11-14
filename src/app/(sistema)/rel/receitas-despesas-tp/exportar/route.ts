import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { exportarReceitasDespesasTp, PORTA_REALIZADO } from '@/modules/rel';
import { definirRota } from '@/shared/authz';

// Download do demonstrativo de receitas e despesas do TP (US-096 parte 2): ?tp=…&de=…&ate=…&zerados=sim&formato=xlsx|csv|pdf. É um GET
// que grava a EXPORTACAO no Histórico: só o próprio sistema (same-origin) ou o endereço digitado exportam.
export const GET = definirRota({ funcionalidade: 'rel.receitas_despesas_tp', acao: 'exportar' }, async (req, ctx) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const url = new URL(req.url);
  const formato = url.searchParams.get('formato');
  if (!ehFormatoArquivo(formato)) return respostaDeErro(400, 'formato', 'Formato inválido.');
  const filtros = { tp: url.searchParams.get('tp') ?? '', de: url.searchParams.get('de') ?? '', ate: url.searchParams.get('ate') ?? '', zerados: url.searchParams.get('zerados') ?? '' };
  const r = await exportarReceitasDespesasTp(ctx, filtros, formato, PORTA_REALIZADO);
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  return respostaDeArquivo(r.valor.nome, formato, r.valor.bytes);
});
