import { origemDeExportacaoValida, respostaDeArquivo, respostaDeErro } from '@/modules/ger';
import { exportarOrcadoRealizado, FORMATOS_OXR, type FormatoOxr } from '@/modules/orc';
import { definirRota } from '@/shared/authz';

// Download do Orçado x Realizado (US-086, parte 2): ?proposta=…&de=…&ate=…&conta=…&zeradas=sim&formato=xlsx|pdf. É um
// GET que grava a EXPORTACAO no Histórico: só o próprio sistema (same-origin) ou o endereço digitado exportam.
export const GET = definirRota({ funcionalidade: 'orc.oxr', acao: 'exportar' }, async (req, ctx) => {
  if (!origemDeExportacaoValida(req)) return respostaDeErro(403, '_', 'Requisição recusada: origem inválida.');
  const url = new URL(req.url);
  const formato = url.searchParams.get('formato');
  if (!FORMATOS_OXR.includes(formato as FormatoOxr)) return respostaDeErro(400, 'formato', 'Formato inválido.');
  const p = (k: string) => url.searchParams.get(k) ?? undefined;
  const r = await exportarOrcadoRealizado(ctx, { proposta: p('proposta') ?? '', de: p('de'), ate: p('ate'), conta: p('conta'), zeradas: p('zeradas') === 'sim' }, formato as FormatoOxr);
  if (!r.ok) return Response.json({ erros: r.erros }, { status: 400 });
  return respostaDeArquivo(r.valor.nome, formato as FormatoOxr, r.valor.bytes);
});
