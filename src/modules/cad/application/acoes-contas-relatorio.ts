'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { alterarContasRelatorio } from './contas-relatorio';

// Server Action das contas dos relatórios (US-097). A negação (403) é auditada pela definirAcao (C5).
const entrada = z
  .object({
    papel: z.string().max(20),
    classificacoes: z.array(z.string().max(40)).max(200),
    anterior: z.string().max(10000),
  })
  .strict();

export const acaoAlterarContasRelatorio = definirAcao({ funcionalidade: 'cad.plano_contas', acao: 'executar', entrada }, async (e, ctx) => {
  const r = await alterarContasRelatorio(ctx, e);
  if (r.ok) revalidatePath('/cad/plano-contas/contas-relatorio');
  return r;
});
