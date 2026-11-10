'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { FUNCIONALIDADE_SISTEMA } from '../domain/sistema';
import { ativarSistema, desativarSistema } from './sistema';

// Ações da tela Ativação e Desativação do Sistema (US-036, UC02.01). Depois do sucesso, voltam à tela
// com o aviso; o motivo é validado no caso de uso (E1, RN0073), e o erro aparece no modal.
const entradaVazia = z.preprocess(() => ({}), z.object({}));
const entradaMotivo = z.preprocess(
  (v) => (v instanceof FormData ? { motivo: v.get('motivo') } : v),
  z.object({ motivo: z.unknown() }).transform((e) => ({ motivo: typeof e.motivo === 'string' ? e.motivo : '' })),
);

export const ativar = definirAcao({ funcionalidade: FUNCIONALIDADE_SISTEMA, acao: 'alterar', entrada: entradaVazia }, async (_e, ctx) => {
  await ativarSistema(ctx);
  redirect('/adm/sistema?aviso=ativado');
});

// Com espera zero, a desativação já vale (mensagem do UC02.01); com espera, foi agendada (D-P9-10).
export const desativar = definirAcao({ funcionalidade: FUNCIONALIDADE_SISTEMA, acao: 'alterar', entrada: entradaMotivo }, async (e, ctx) => {
  const { desativacaoEm } = await desativarSistema(ctx, e);
  redirect(desativacaoEm.getTime() <= Date.now() ? '/adm/sistema?aviso=desativado' : '/adm/sistema?aviso=agendado');
});
