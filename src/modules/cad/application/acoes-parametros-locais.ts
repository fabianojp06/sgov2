'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { alterarParametroLocal } from './parametros-locais-conta';

// Server Action dos parâmetros locais da conta (US-045). A negação (403) é auditada pela definirAcao (C5).
const pct = z.string().max(20, 'Informe um percentual com até 4 casas decimais.');
const entrada = z
  .object({
    contaId: z.string().max(40),
    versao: z.number().int(),
    natureza: z.string().max(10).nullable(),
    semaforo: z.object({ verdeAte: pct, amareloAte: pct, laranjaAte: pct }).strict().nullable(),
  })
  .strict();

export const acaoAlterarParametroLocal = definirAcao({ funcionalidade: 'cad.plano_contas', acao: 'executar', entrada }, async (e, ctx) => {
  const r = await alterarParametroLocal(ctx, e.contaId, e.versao, { natureza: e.natureza, semaforo: e.semaforo });
  if (r.ok) revalidatePath('/cad/plano-contas/parametros-locais');
  return r;
});
