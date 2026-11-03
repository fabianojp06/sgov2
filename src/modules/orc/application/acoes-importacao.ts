'use server';

import { z } from 'zod';
import { LIMITES_PADRAO } from '@/modules/ger/servidor';
import { definirAcao } from '@/shared/authz';
import { falha, ok } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { valorParaTela } from '../domain/valor-tela';
import { importarPlanilha } from './importacao';

// Ação da importação (US-121). O tamanho é conferido antes de ler o arquivo para a memória; a
// resposta leva só dados serializáveis (os totais já formatados para a tela).
const entradaImportacao = z.preprocess(
  (v) => (v instanceof FormData ? { exercicioId: v.get('exercicioId'), arquivo: v.get('arquivo') } : v),
  z.object({ exercicioId: z.string(), arquivo: z.instanceof(File, { error: 'Escolha a planilha.' }) }),
);

export const importarPlanilhaAcao = definirAcao({ funcionalidade: 'orc.importacao', acao: 'executar', entrada: entradaImportacao }, async (e, ctx) => {
  if (e.arquivo.size > LIMITES_PADRAO.bytes) return falha([{ campo: 'arquivo', mensagem: MENSAGENS_ORC.ARQUIVO_GRANDE }]);
  const conteudo = new Uint8Array(await e.arquivo.arrayBuffer());
  const r = await importarPlanilha(ctx, { exercicioId: e.exercicioId, arquivo: { nome: e.arquivo.name, conteudo } });
  if (!r.ok) return r;
  return ok({
    mensagem: r.valor.mensagem,
    porCc: r.valor.resumoPorCc.map((c) => ({ cc: c.cc, posicoes: c.posicoes, pacotes: c.pacotes, total: valorParaTela(c.total) })),
  });
});
