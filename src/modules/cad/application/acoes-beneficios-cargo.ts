'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { falha } from '@/shared/kernel';
import { alterarBeneficiosCargo } from './beneficios-cargo';
import { conferirOrigemBlindadaCargo } from './cargos';

// Server Action dos benefícios do cargo (US-050 parte 2). A negação (403) é auditada pela definirAcao
// (C5); a entrada chega bruta para a origem blindada do cargo ser auditada antes do parse (M-n4).
const PORTUGUES = z.locales.ptBR().localeError;
const esquema = z
  .object({
    idCargo: z.string().max(36),
    ano: z.number().int(),
    versao: z.number().int(),
    itens: z.array(z.object({ codigo: z.string().max(60), ativo: z.boolean(), valorManual: z.string().max(30).nullable() }).strict()).max(50),
  })
  .strict();

export const acaoAlterarBeneficiosCargo = definirAcao({ funcionalidade: 'cad.cargos', acao: 'alterar', entrada: z.unknown() }, async (bruto, ctx) => {
  await conferirOrigemBlindadaCargo(ctx, bruto);
  const e = esquema.safeParse(bruto, { error: PORTUGUES });
  if (!e.success) return falha(e.error.issues.map((i) => ({ campo: i.path.length > 0 ? i.path.join('.') : '_', mensagem: i.message })));
  const r = await alterarBeneficiosCargo(ctx, e.data.idCargo, e.data.ano, e.data.versao, e.data.itens);
  if (r.ok) revalidatePath('/cad/cargos');
  return r;
});
