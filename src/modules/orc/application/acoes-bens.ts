'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { alterarBem, excluirBem, incluirBem } from './bens';
import { entradaBruta } from './entrada-exercicio';

// Ações da tela de bens da proposta (US-072; plano do P22, Task 2). Depois do sucesso, voltam à lista com o
// aviso e a descrição do item (o texto sai das mensagens do orc).
const voltar = (aviso: 'incluido' | 'alterado' | 'excluido' | 'inativado', descricao: string): never => redirect(`/orc/bens?aviso=${aviso}&d=${encodeURIComponent(descricao)}`);

export const incluirBemAcao = definirAcao({ funcionalidade: 'orc.bens', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirBem(ctx, e);
  if (!r.ok) return r;
  return voltar('incluido', r.valor.descricao);
});

export const alterarBemAcao = definirAcao({ funcionalidade: 'orc.bens', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarBem(ctx, e);
  if (!r.ok) return r;
  return voltar('alterado', r.valor.descricao);
});

export const excluirBemAcao = definirAcao({ funcionalidade: 'orc.bens', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirBem(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor.inativado ? 'inativado' : 'excluido', r.valor.descricao);
});
