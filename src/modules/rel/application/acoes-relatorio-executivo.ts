'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { alterarTextos, aprovarRelatorio, gerarRascunho } from './relatorio-executivo';

// Ações do relatório executivo mensal (US-103). A guarda confere a permissão; a entrada é validada no caso
// de uso. Gerar chama a IA (tempo limite de 90 s no caso de uso). Aprovar vem da AcaoConfirmada do C3
// (FormData) e volta ao detalhe, que passa a mostrar o aprovado.
const comoObjeto = (v: unknown) => (v instanceof FormData ? Object.fromEntries([...v.keys()].map((k) => [k, v.get(k)])) : v);
const entrada = z.preprocess(comoObjeto, z.record(z.string(), z.unknown()));

export const gerarRascunhoAcao = definirAcao({ funcionalidade: 'rel.relatorio_executivo', acao: 'executar', entrada }, (e, ctx) => gerarRascunho(ctx, e));
export const alterarTextosAcao = definirAcao({ funcionalidade: 'rel.relatorio_executivo', acao: 'alterar', entrada }, (e, ctx) => alterarTextos(ctx, e));
export const aprovarRelatorioAcao = definirAcao({ funcionalidade: 'rel.relatorio_executivo', acao: 'aprovar', entrada }, async (e, ctx) => {
  const r = await aprovarRelatorio(ctx, e);
  if (!r.ok) return r;
  return redirect(`/rel/relatorio-executivo/${String(e.id)}?aviso=aprovado`);
});
