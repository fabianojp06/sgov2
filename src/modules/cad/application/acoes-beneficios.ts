'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { FORMAS_BENEFICIO } from '../domain/beneficios';
import { alterarBeneficioMestre, incluirBeneficioMestre } from './beneficios';

// Server Actions da Tabela Mestre (US-050). A negação (403) é auditada pela definirAcao (C5). Campos de
// origem blindada passam pelo schema só para o caso de uso recusá-los e auditar (M4/M-n4).
const blindados = { provisorio: z.unknown().optional(), versaoItem: z.unknown().optional(), atualizadoEm: z.unknown().optional() };
const item = {
  ano: z.number().int().min(2000).max(2099),
  codigo: z.string().max(60),
  nome: z.string().max(200),
  forma: z.enum(FORMAS_BENEFICIO),
  valor: z.string().max(30).nullable(),
  percentual: z.string().max(30).nullable(),
  conta: z.string().max(40),
  padraoPosicao: z.boolean(),
  ativo: z.boolean(),
};

const dados = (e: { codigo: string; nome: string; forma: (typeof FORMAS_BENEFICIO)[number]; valor: string | null; percentual: string | null; conta: string; padraoPosicao: boolean; ativo: boolean; provisorio?: unknown; atualizadoEm?: unknown }) => ({
  codigo: e.codigo,
  nome: e.nome,
  forma: e.forma,
  valor: e.valor,
  percentual: e.percentual,
  conta: e.conta,
  padraoPosicao: e.padraoPosicao,
  ativo: e.ativo,
  ...(e.provisorio !== undefined ? { provisorio: e.provisorio } : {}),
  ...(e.atualizadoEm !== undefined ? { atualizadoEm: e.atualizadoEm } : {}),
});

export const incluirBeneficio = definirAcao(
  { funcionalidade: 'cad.beneficios', acao: 'incluir', entrada: z.object({ ...item, ...blindados }).strict() },
  async (e, ctx) => {
    const r = await incluirBeneficioMestre(ctx, e.ano, dados(e));
    if (r.ok) revalidatePath('/cad/beneficios');
    return r;
  },
);

export const alterarBeneficio = definirAcao(
  { funcionalidade: 'cad.beneficios', acao: 'alterar', entrada: z.object({ ...item, versao: z.number().int().min(1), ...blindados }).strict() },
  async (e, ctx) => {
    const r = await alterarBeneficioMestre(ctx, e.ano, e.codigo, e.versao, dados(e));
    if (r.ok) revalidatePath('/cad/beneficios');
    return r;
  },
);
