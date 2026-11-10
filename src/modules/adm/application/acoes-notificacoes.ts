'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { excluirNotificacao, incluirNotificacao } from './notificacoes';

// Ações da tela de notificações de desempenho (US-041). Adicionar e Excluir persistem na hora
// (D-P10-9) e voltam à tela com o aviso; a URL leva só o código do aviso, nunca texto livre.
const FUNCIONALIDADE = 'adm.notificacoes';

const texto = (f: FormData, campo: string): string => {
  const v = f.get(campo);
  return typeof v === 'string' ? v : '';
};

const MENSAGEM_VERSAO = 'Versão do registro inválida. Recarregue a tela.';
const numeroVersao = z.number(MENSAGEM_VERSAO).int(MENSAGEM_VERSAO).nonnegative(MENSAGEM_VERSAO);

// A validação dos campos fica no domínio (validarNotificacao), que devolve os erros por campo.
const entradaInclusao = z.preprocess(
  (v) =>
    v instanceof FormData
      ? { conta: texto(v, 'conta'), limite: texto(v, 'limite'), frequenciaDias: texto(v, 'frequenciaDias'), usuarioId: texto(v, 'usuarioId') }
      : v,
  z.record(z.string(), z.unknown()),
);

const entradaExclusao = z.preprocess(
  (v) => (v instanceof FormData ? { id: texto(v, 'id'), versao: /^\d{1,9}$/.test(texto(v, 'versao')) ? Number(texto(v, 'versao')) : NaN } : v),
  z.object({ id: z.string(), versao: numeroVersao }),
);

export const adicionarNotificacao = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'incluir', entrada: entradaInclusao }, async (e, ctx) => {
  const r = await incluirNotificacao(ctx, e);
  if (!r.ok) return r;
  redirect('/adm/notificacoes?aviso=incluida');
});

export const removerNotificacao = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'excluir', entrada: entradaExclusao }, async (e, ctx) => {
  const r = await excluirNotificacao(ctx, e.id, e.versao);
  if (!r.ok) return r;
  redirect('/adm/notificacoes?aviso=excluida');
});
