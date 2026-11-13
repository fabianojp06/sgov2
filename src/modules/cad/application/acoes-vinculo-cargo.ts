'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { vincularCargo } from './vinculo-cargo';

// Server Action do vínculo do cargo com a estrutura funcional (US-048 parte 2). A negação (403) é
// auditada pela definirAcao (C5).
const entrada = z.object({ cargoId: z.string().max(40), anterior: z.string().max(40).nullable(), unidadeId: z.string().max(40).nullable() }).strict();

export const acaoVincularCargo = definirAcao({ funcionalidade: 'cad.cargos', acao: 'alterar', entrada }, async (e, ctx) => {
  const r = await vincularCargo(ctx, e.cargoId, e.anterior, e.unidadeId);
  if (r.ok) {
    revalidatePath(`/cad/cargos/${e.cargoId}`);
    revalidatePath('/cad/cargos');
    revalidatePath('/cad/estrutura-funcional');
  }
  return r;
});
