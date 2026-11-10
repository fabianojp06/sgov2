import { origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { baixarExportacao } from '@/modules/rel';
import { definirRota } from '@/shared/authz';

// Download de uma exportação feita em segundo plano (US-024): só o dono, enquanto tiver o exportar da
// listagem de origem. Só do próprio sistema (origem).
export const GET = definirRota({ funcionalidade: 'rel.exportacoes', acao: 'consultar' }, async (req, ctx, rota) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const { id } = (await rota?.params) as { id: string };
  const arquivo = await baixarExportacao(ctx, id);
  if (!arquivo) return respostaDeErro(404, '_', 'Exportação não encontrada.');
  return respostaDeArquivo(arquivo.nome, arquivo.formato, arquivo.bytes);
});
