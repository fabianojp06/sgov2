'use server';

import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { perguntarAoManual } from './ajuda-manual';

// Ação da ajuda do manual (US-108): Server Action sem stream, com tempo limite de 30 s no caso de
// uso. A guarda confere a permissão do caso; a pergunta é validada no caso de uso. Só leitura.
const entrada = z.record(z.string(), z.unknown());

export const perguntarAoManualAcao = definirAcao({ funcionalidade: 'rel.ia_ajuda_manual', acao: 'executar', entrada }, (e, ctx) => perguntarAoManual(ctx, e));
