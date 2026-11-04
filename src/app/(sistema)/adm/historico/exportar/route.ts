import { consultaDaUrl, exportarHistorico, lerFiltroHistorico } from '@/modules/adm';
import { definirRota } from '@/shared/authz';

// Download do Histórico em XLSX (US-040), com os filtros da tela na URL. É um GET que grava no
// Histórico (EXPORTACAO): o definirRota não confere a origem em GET, e o cookie Lax vai numa
// navegação vinda de outro site. Por isso só o próprio sistema (same-origin) ou o endereço digitado
// (none) exportam; o resto recebe 403 (o mesmo padrão da conferência de carga do rel).
export const GET = definirRota({ funcionalidade: 'adm.historico', acao: 'exportar' }, async (req, ctx) => {
  const site = req.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') {
    return Response.json({ erros: [{ campo: '_', mensagem: 'Requisição recusada: origem inválida.' }] }, { status: 403 });
  }
  const url = new URL(req.url);
  const { filtro, valores } = lerFiltroHistorico(Object.fromEntries(url.searchParams), new Date());
  const r = await exportarHistorico(ctx, filtro);
  // O Exportar é um link: a recusa volta à tela com o aviso, em vez de um JSON cru.
  if (!r.ok) return Response.redirect(new URL(`/adm/historico?${consultaDaUrl(valores, { aviso: 'exportacao-recusada' })}`, url), 303);
  return new Response(r.valor.bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${r.valor.nome}"`,
      'Cache-Control': 'no-store',
    },
  });
});
