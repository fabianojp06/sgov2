import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { exportarConferenciaCarga } from '@/modules/rel';
import { definirRota } from '@/shared/authz';

// Download da conferência da carga (plano do P7, Task 2): ?ano=2027&formato=xlsx|csv.
// É um GET que grava no Histórico (EXPORTACAO e, com cad.salarios, CONSULTA): o definirRota não
// confere a origem em GET, e o cookie Lax vai numa navegação vinda de outro site. Por isso só o
// próprio sistema (same-origin) ou o endereço digitado (none) exportam; o resto recebe 403.
export const GET = definirRota({ funcionalidade: 'rel.conferencia_carga', acao: 'exportar' }, async (req, ctx) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const url = new URL(req.url);
  const ano = Number(url.searchParams.get('ano'));
  const formato = url.searchParams.get('formato');
  if (!ehFormatoArquivo(formato)) return respostaDeErro(400, 'formato', 'Formato inválido.');
  const r = await exportarConferenciaCarga(ctx, ano, formato);
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  return respostaDeArquivo(r.valor.nome, formato, r.valor.bytes);
});
