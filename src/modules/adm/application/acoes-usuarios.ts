'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { entradaAlteracao, entradaCadastro, entradaId } from './entrada-usuario';
import { alterarUsuario, cadastrarUsuario, desbloquearUsuario, resetarSenha } from './usuarios';

// Ações das telas de usuário (US-038). Depois do sucesso, cadastro, alteração e desbloqueio voltam
// à listagem com o aviso (UC02.12, UC02.13, A3); o reset mantém o formulário aberto (A2, passo 2.5).
const FUNCIONALIDADE = 'adm.usuarios';

export const cadastrar = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'incluir', entrada: entradaCadastro }, async (e, ctx) => {
  const r = await cadastrarUsuario(ctx, e);
  if (!r.ok) return r;
  redirect('/adm/usuarios?aviso=cadastrado');
});

export const alterar = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'alterar', entrada: entradaAlteracao }, async (e, ctx) => {
  const r = await alterarUsuario(ctx, e.id, e.versao, e.dados);
  if (!r.ok) return r;
  redirect('/adm/usuarios?aviso=alterado');
});

export const gerarNovaSenha = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'alterar', entrada: entradaId }, (e, ctx) =>
  resetarSenha(ctx, e.id),
);

export const desbloquear = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'alterar', entrada: entradaId }, async (e, ctx) => {
  const r = await desbloquearUsuario(ctx, e.id);
  if (!r.ok) return r;
  redirect('/adm/usuarios?aviso=desbloqueado');
});
