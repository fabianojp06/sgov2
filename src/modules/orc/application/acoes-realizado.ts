'use server';

import { z } from 'zod';
import { LIMITES_PADRAO } from '@/modules/ger/servidor';
import { definirAcao } from '@/shared/authz';
import { falha, ok } from '@/shared/kernel';
import { valorParaTela } from '../domain/valor-tela';
import { carregarRealizado, fecharCompetencia, MENSAGENS_CARGA, reprocessarPendencias } from './realizado';

// Ações do realizado (US-085, parte 1; plano do P32, Task 3). O tamanho é conferido antes de ler o arquivo para a
// memória; a resposta leva só dados serializáveis.
const entradaCarga = z.preprocess(
  (v) => (v instanceof FormData ? { propostaId: v.get('propostaId'), arquivo: v.get('arquivo') } : v),
  z.object({ propostaId: z.string(), arquivo: z.instanceof(File, { error: 'Escolha o arquivo.' }) }),
);

export const carregarRealizadoAcao = definirAcao({ funcionalidade: 'orc.realizado', acao: 'executar', entrada: entradaCarga }, async (e, ctx) => {
  if (e.arquivo.size > LIMITES_PADRAO.bytes) return falha([{ campo: 'arquivo', mensagem: MENSAGENS_CARGA.ARQUIVO_GRANDE }]);
  const conteudo = new Uint8Array(await e.arquivo.arrayBuffer());
  const r = await carregarRealizado(ctx, { propostaId: e.propostaId, arquivo: { nome: e.arquivo.name, conteudo } });
  if (!r.ok) return r;
  const v = r.valor;
  const partes = [
    `Realizado do TP ${v.numero} carregado: ${v.linhas} linha(s), total R$ ${valorParaTela(v.total)}.`,
    v.substituidas.length > 0 ? `Competências substituídas: ${v.substituidas.join(', ')}.` : '',
    v.fechadas.length > 0 ? `Competências fechadas, sem mudança: ${v.fechadas.join(', ')}; ${v.ajustes} ajuste(s) lançado(s) no mês aberto seguinte.` : '',
    v.pendencias.quantidade > 0 ? `${v.pendencias.quantidade} valor(es) sem conta correspondente no SGO (R$ ${valorParaTela(v.pendencias.valor)}) ficaram como pendência.` : '',
  ];
  return ok({ mensagem: partes.filter(Boolean).join(' ') });
});

const entradaFechamento = z.preprocess(
  (v) => (v instanceof FormData ? { competencia: v.get('competencia') } : v),
  z.object({ competencia: z.string() }),
);

export const fecharCompetenciaAcao = definirAcao({ funcionalidade: 'orc.realizado', acao: 'aprovar', entrada: entradaFechamento }, async (e, ctx) => {
  const r = await fecharCompetencia(ctx, e);
  return r.ok ? ok({ mensagem: `Competência ${r.valor.competencia} fechada.` }) : r;
});

const entradaReprocessar = z.preprocess(
  (v) => (v instanceof FormData ? { propostaId: v.get('propostaId') } : v),
  z.object({ propostaId: z.string() }),
);

export const reprocessarPendenciasAcao = definirAcao({ funcionalidade: 'orc.realizado', acao: 'executar', entrada: entradaReprocessar }, async (e, ctx) => {
  const r = await reprocessarPendencias(ctx, e);
  if (!r.ok) return r;
  const v = r.valor;
  return ok({
    mensagem:
      v.resolvidas === 0
        ? `Nenhuma pendência do TP ${v.numero} tem conta analítica no plano de contas ainda.`
        : `${v.resolvidas} pendência(s) do TP ${v.numero} resolvida(s)${v.ajustes > 0 ? `, ${v.ajustes} como ajuste de mês fechado` : ''}; ${v.restantes} continua(m) pendente(s).`,
  });
});
