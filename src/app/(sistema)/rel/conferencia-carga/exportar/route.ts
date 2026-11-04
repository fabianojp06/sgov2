import { exportarConferenciaCarga } from '@/modules/rel';
import { definirRota } from '@/shared/authz';

// Download da conferência da carga (plano do P7, Task 2): ?ano=2027&formato=xlsx|csv.
export const GET = definirRota({ funcionalidade: 'rel.conferencia_carga', acao: 'exportar' }, async (req, ctx) => {
  const url = new URL(req.url);
  const ano = Number(url.searchParams.get('ano'));
  const formato = url.searchParams.get('formato');
  if (formato !== 'xlsx' && formato !== 'csv') return Response.json({ erros: [{ campo: 'formato', mensagem: 'Formato inválido.' }] }, { status: 400 });
  const r = await exportarConferenciaCarga(ctx, ano, formato);
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  return new Response(r.valor.bytes as BodyInit, {
    headers: {
      'Content-Type': r.valor.tipo,
      'Content-Disposition': `attachment; filename="${r.valor.nome}"`,
      'Cache-Control': 'no-store',
    },
  });
});
