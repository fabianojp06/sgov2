'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { alterarFuncionalidade, alterarModulo } from './modulos';

// Ações da tela de módulos (US-035). Depois do sucesso, voltam ao detalhamento do módulo com o
// aviso (UC02.05 passos 8 e 9; UC02.06 passos 9 e 10). A URL leva só códigos, nunca texto livre.
const FUNCIONALIDADE = 'adm.modulos';

const texto = (f: FormData, campo: string): string => {
  const v = f.get(campo);
  return typeof v === 'string' ? v : '';
};

const entrada = z.preprocess(
  (v) => (v instanceof FormData ? { codigo: texto(v, 'codigo'), ativo: texto(v, 'ativo') } : v),
  z.object({
    codigo: z.string().regex(/^[A-Z_]{1,40}$/),
    ativo: z.enum(['true', 'false']).transform((a) => a === 'true'),
  }),
);

export const alternarModulo = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'alterar', entrada }, async (e, ctx) => {
  const r = await alterarModulo(ctx, e);
  if (!r.ok) return r;
  // Nada mudou (tela desatualizada): volta sem aviso de sucesso.
  const aviso = r.valor.alterado ? `&aviso=${e.ativo ? 'modulo-ativado' : 'modulo-desativado'}` : '';
  redirect(`/adm/modulos?modulo=${encodeURIComponent(e.codigo)}${aviso}`);
});

// O módulo da funcionalidade vem no formulário só para a volta ao detalhamento; a regra relê o
// módulo no banco.
const entradaFuncionalidade = z.preprocess(
  (v) => (v instanceof FormData ? { codigo: texto(v, 'codigo'), ativo: texto(v, 'ativo'), modulo: texto(v, 'modulo') } : v),
  z.object({
    codigo: z.string().regex(/^[a-z]{3}\.[a-z0-9_]{1,56}$/),
    ativo: z.enum(['true', 'false']).transform((a) => a === 'true'),
    modulo: z.string().regex(/^[A-Z_]{1,40}$/),
  }),
);

export const alternarFuncionalidade = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'alterar', entrada: entradaFuncionalidade }, async (e, ctx) => {
  const r = await alterarFuncionalidade(ctx, { codigo: e.codigo, ativo: e.ativo });
  if (!r.ok) return r;
  const aviso = r.valor.alterado ? `&aviso=${e.ativo ? 'funcionalidade-ativada' : 'funcionalidade-desativada'}` : '';
  redirect(`/adm/modulos?modulo=${encodeURIComponent(e.modulo)}${aviso}`);
});
