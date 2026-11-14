import { origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { exportarPdfRelatorio } from '@/modules/rel';
import { definirRota } from '@/shared/authz';

// PDF do relatório executivo (US-103). É um GET que grava a EXPORTACAO no Histórico: como na conferência
// da carga, só o próprio sistema (same-origin) ou o endereço digitado (none) exportam; o resto recebe 403.
export const GET = definirRota({ funcionalidade: 'rel.relatorio_executivo', acao: 'exportar' }, async (req, ctx, rota) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const { id } = (await rota?.params) as { id: string };
  const r = await exportarPdfRelatorio(ctx, id);
  if (!r.ok) return respostaDeErro(404, '_', 'Relatório não encontrado.');
  return respostaDeArquivo(r.valor.nome, 'pdf', r.valor.bytes);
});
