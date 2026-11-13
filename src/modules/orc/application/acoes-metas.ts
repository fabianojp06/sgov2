'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { entradaBruta } from './entrada-exercicio';
import { alterarMeta, excluirMeta, incluirMeta } from './metas';

// Ações da tela de metas da proposta (US-067; plano do P19, Task 2). Depois do sucesso, voltam à lista com o
// aviso e o número da meta (o texto do aviso sai das mensagens do orc, na página).
const voltar = (aviso: 'incluida' | 'alterada' | 'excluida', numero: string): never => redirect(`/orc/metas?aviso=${aviso}&m=${encodeURIComponent(numero)}`);

export const incluirMetaAcao = definirAcao({ funcionalidade: 'orc.metas', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirMeta(ctx, e);
  if (!r.ok) return r;
  return voltar('incluida', r.valor.numero);
});

export const alterarMetaAcao = definirAcao({ funcionalidade: 'orc.metas', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarMeta(ctx, e);
  if (!r.ok) return r;
  return voltar('alterada', r.valor.numero);
});

export const excluirMetaAcao = definirAcao({ funcionalidade: 'orc.metas', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirMeta(ctx, e);
  if (!r.ok) return r;
  return voltar('excluida', r.valor.numero);
});
