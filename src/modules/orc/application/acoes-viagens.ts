'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { entradaBruta } from './entrada-exercicio';
import { solicitarValidacaoViagens } from './lote-viagem';
import { alterarTeto, alterarViagem, excluirTeto, excluirViagem, incluirTeto, incluirViagem } from './viagens';

// Ações da tela de viagens da proposta (US-071; plano do P21, Task 2). Depois do sucesso, voltam à lista com o
// aviso: a localidade da viagem ou a conta do teto (o texto sai das mensagens do orc).
const voltarViagem = (aviso: 'incluida' | 'alterada' | 'excluida', localidade: string): never => redirect(`/orc/viagens?aviso=${aviso}&l=${encodeURIComponent(localidade)}`);
const voltarTeto = (aviso: 'teto-incluido' | 'teto-alterado' | 'teto-excluido', conta: string): never => redirect(`/orc/viagens?aviso=${aviso}&c=${encodeURIComponent(conta)}`);

export const incluirViagemAcao = definirAcao({ funcionalidade: 'orc.viagens', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirViagem(ctx, e);
  if (!r.ok) return r;
  return voltarViagem('incluida', r.valor.localidade);
});

export const alterarViagemAcao = definirAcao({ funcionalidade: 'orc.viagens', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarViagem(ctx, e);
  if (!r.ok) return r;
  return voltarViagem('alterada', r.valor.localidade);
});

export const excluirViagemAcao = definirAcao({ funcionalidade: 'orc.viagens', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirViagem(ctx, e);
  if (!r.ok) return r;
  return voltarViagem('excluida', r.valor.localidade);
});

export const incluirTetoAcao = definirAcao({ funcionalidade: 'orc.viagens', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirTeto(ctx, e);
  if (!r.ok) return r;
  return voltarTeto('teto-incluido', r.valor.conta);
});

export const alterarTetoAcao = definirAcao({ funcionalidade: 'orc.viagens', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarTeto(ctx, e);
  if (!r.ok) return r;
  return voltarTeto('teto-alterado', r.valor.conta);
});

export const excluirTetoAcao = definirAcao({ funcionalidade: 'orc.viagens', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirTeto(ctx, e);
  if (!r.ok) return r;
  return voltarTeto('teto-excluido', r.valor.conta);
});

// Pedir a validação das viagens da versão oficializada (US-081, WA02; plano do P28).
export const solicitarValidacaoViagensAcao = definirAcao({ funcionalidade: 'orc.viagens', acao: 'executar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await solicitarValidacaoViagens(ctx, e);
  if (!r.ok) return r;
  return redirect(`/orc/viagens?aviso=validacao&n=${encodeURIComponent(r.valor.numero)}`);
});
