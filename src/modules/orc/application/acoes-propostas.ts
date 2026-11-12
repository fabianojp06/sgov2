'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { entradaBruta } from './entrada-exercicio';
import { criarProposta, excluirProposta } from './propostas';

// Ações da tela de propostas de TP (US-065; plano do P17, Task 2). Depois do sucesso, voltam à lista
// com o aviso e o número do TP (o texto do aviso sai das mensagens do orc, na página).
const voltar = (aviso: 'incluida' | 'excluida', numero: string): never => redirect(`/orc/propostas?aviso=${aviso}&tp=${encodeURIComponent(numero)}`);

export const criarPropostaAcao = definirAcao({ funcionalidade: 'orc.propostas', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await criarProposta(ctx, e);
  if (!r.ok) return r;
  return voltar('incluida', r.valor.numero);
});

export const excluirPropostaAcao = definirAcao({ funcionalidade: 'orc.propostas', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirProposta(ctx, e);
  if (!r.ok) return r;
  return voltar('excluida', r.valor.numero);
});
