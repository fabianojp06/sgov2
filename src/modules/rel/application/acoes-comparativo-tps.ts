'use server';

import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { comentarComparativo } from './comparativo-tps';

// Ação dos comentários do comparativo entre TPs (US-106): Server Action sem entrada, com tempo limite de
// 60 s no caso de uso. A guarda confere a permissão do caso. Só leitura.
const entrada = z.record(z.string(), z.unknown());

export const comentarComparativoAcao = definirAcao({ funcionalidade: 'rel.comparativo_tps', acao: 'executar', entrada }, (_e, ctx) => comentarComparativo(ctx));
