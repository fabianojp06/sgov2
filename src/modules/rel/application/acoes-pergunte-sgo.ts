'use server';

import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { perguntarAoSgo } from './pergunte-sgo';

// Ação do Pergunte ao SGO (US-104): Server Action com tempo limite de 30 s no caso de uso. A guarda confere a
// permissão do caso; a pergunta é validada no caso de uso. Só leitura.
const entrada = z.record(z.string(), z.unknown());

export const perguntarAoSgoAcao = definirAcao({ funcionalidade: 'rel.pergunte_sgo', acao: 'executar', entrada }, (e, ctx) => perguntarAoSgo(ctx, e));
