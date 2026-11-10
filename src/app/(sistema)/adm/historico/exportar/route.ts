import { avisoDaRecusa, consultaDaUrl, exportarHistorico, lerFiltroHistorico } from '@/modules/adm';
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
  // O Exportar é um link: a recusa e o agendamento voltam à tela com o aviso, em vez de um JSON cru.
  // Location relativo: atrás do proxy, o host da requisição pode ser o interno.
  const voltar = (extra: Record<string, string>) =>
    new Response(null, { status: 303, headers: { Location: `/adm/historico?${consultaDaUrl(valores, extra)}`, 'Cache-Control': 'no-store' } });
  if (!r.ok) return voltar({ aviso: avisoDaRecusa(r.erros) });
  // Acima de 5.000 linhas, o pedido foi para o worker (US-024): a tela aponta para Minhas exportações.
  if (r.valor.tipo === 'agendada') return voltar({ aviso: 'exportacao-agendada', pedido: r.valor.pedidoId });
  return new Response(r.valor.bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${r.valor.nome}"`,
      'Cache-Control': 'no-store',
    },
  });
});
