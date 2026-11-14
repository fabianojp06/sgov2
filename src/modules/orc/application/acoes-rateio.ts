'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { entradaBruta } from './entrada-exercicio';
import { excluirRateio, replicarRateio, salvarRateio } from './rateio';

// Ações da tela de Rateio/ISS (US-073; plano do P24, Task 2). Depois do sucesso, voltam à grade da proposta com o
// aviso (o texto sai das mensagens do orc). Salvar exige incluir ou alterar, conforme a grade exista (no caso de
// uso); a guarda da ação pede consultar e deixa a decisão para ele.
const voltar = (propostaId: unknown, aviso: string, extra = ''): never => redirect(`/orc/rateio?proposta=${encodeURIComponent(String(propostaId ?? ''))}&aviso=${aviso}${extra}`);

export const salvarRateioAcao = definirAcao({ funcionalidade: 'orc.rateio', acao: 'consultar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await salvarRateio(ctx, e);
  if (!r.ok) return r;
  return voltar(e.propostaId, 'salvo');
});

export const replicarRateioAcao = definirAcao({ funcionalidade: 'orc.rateio', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await replicarRateio(ctx, e);
  if (!r.ok) return r;
  return voltar(e.propostaId, 'replicado', `&c=${encodeURIComponent(r.valor.conta)}`);
});

export const excluirRateioAcao = definirAcao({ funcionalidade: 'orc.rateio', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirRateio(ctx, e);
  if (!r.ok) return r;
  return voltar(e.propostaId, 'excluido');
});
