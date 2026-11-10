'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { falha } from '@/shared/kernel';
import { entradaAlteracaoPerfil, entradaCadastroPerfil, entradaExclusaoPerfil } from './entrada-perfil';
import { alterarPerfil, excluirPerfil, incluirPerfil } from './perfis';

// Ações das telas de perfis (US-037). Depois do sucesso, voltam à listagem com o aviso.
const FUNCIONALIDADE = 'adm.perfis';

export const cadastrarPerfil = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'incluir', entrada: entradaCadastroPerfil }, async (e, ctx) => {
  const r = await incluirPerfil(ctx, e);
  if (!r.ok) return r;
  redirect('/adm/perfis?aviso=cadastrado');
});

export const salvarPerfil = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'alterar', entrada: entradaAlteracaoPerfil }, async (e, ctx) => {
  const r = await alterarPerfil(ctx, e.id, e.versao, e.dados);
  if (!r.ok) return r;
  // E3 sem a confirmação (requisição sem a caixa da tela): nada foi gravado; o texto volta como erro
  // do status, e a tela pede a confirmação antes de enviar de novo.
  if (r.valor) return falha([{ campo: 'ativo', mensagem: r.valor.confirmar }]);
  redirect('/adm/perfis?aviso=alterado');
});

export const removerPerfil = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'excluir', entrada: entradaExclusaoPerfil }, async (e, ctx) => {
  const r = await excluirPerfil(ctx, e.id, e.versao);
  if (!r.ok) return r;
  redirect('/adm/perfis?aviso=excluido');
});
