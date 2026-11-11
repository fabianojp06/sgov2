'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { aprovarExercicio, enviarParaAprovacao, rejeitarExercicio } from './aprovacao';
import { entradaBruta } from './entrada-exercicio';
import { pedirRevisao } from './revisor';

// Ações do envio e da aprovação (US-061). Voltam à tela do exercício com o aviso.
const voltar = (ano: number, aviso: string): never => redirect(`/orc/aprovacao?ano=${ano}&aviso=${aviso}`);

export const enviarAcao = definirAcao({ funcionalidade: 'orc.aprovacao', acao: 'executar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await enviarParaAprovacao(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor.ano, 'enviado');
});

export const aprovarAcao = definirAcao({ funcionalidade: 'orc.aprovacao', acao: 'aprovar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await aprovarExercicio(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor.ano, 'aprovado');
});

export const rejeitarAcao = definirAcao({ funcionalidade: 'orc.aprovacao', acao: 'aprovar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await rejeitarExercicio(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor.ano, 'rejeitado');
});

// Revisor antes do envio (US-064; D-P14-6): grava o pedido e volta à tela, que acompanha a revisão.
export const pedirRevisaoAcao = definirAcao({ funcionalidade: 'orc.aprovacao', acao: 'executar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await pedirRevisao(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor.ano, 'revisao');
});
