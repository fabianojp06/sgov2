'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { ok } from '@/shared/kernel';
import { entradaBruta } from './entrada-exercicio';
import { alterarPosicao, excluirPosicao, incluirPosicao, previaPosicao, type ResultadoPosicao } from './posicoes';

// Ações da tela de posições de pessoal (US-056). Depois do sucesso, voltam à lista do CC com o aviso.
const voltar = (r: ResultadoPosicao, aviso: string): never => redirect(`/orc/posicoes?ano=${r.ano}&cc=${encodeURIComponent(r.cc)}&aviso=${aviso}`);

export const incluirPosicaoAcao = definirAcao({ funcionalidade: 'orc.posicoes', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirPosicao(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor, 'incluido');
});

export const alterarPosicaoAcao = definirAcao({ funcionalidade: 'orc.posicoes', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarPosicao(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor, 'alterado');
});

export const excluirPosicaoAcao = definirAcao({ funcionalidade: 'orc.posicoes', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirPosicao(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor, 'excluido');
});

// Prévia do custo (D-P12-6), só leitura. A guarda confere o consultar; o caso de uso exige incluir ou
// alterar. Os valores vão ao cliente como texto canônico ("1234.56"): Dinheiro não atravessa a ação.
export const previaPosicaoAcao = definirAcao({ funcionalidade: 'orc.posicoes', acao: 'consultar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await previaPosicao(ctx, e);
  if (!r.ok) return r;
  const { massa, feriasDecimo, encargos, beneficios, anual, aviso } = r.valor;
  return ok({ massa: massa.paraString(), feriasDecimo: feriasDecimo.paraString(), encargos: encargos.paraString(), beneficios: beneficios.paraString(), anual: anual.paraString(), aviso });
});
