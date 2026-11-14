'use server';

import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { analisarQuadroPessoal } from './quadro-pessoal';

// Ação da análise do quadro de pessoal (US-107): Server Action sem stream, com tempo limite de 60 s no
// caso de uso. A guarda confere a permissão do caso; os filtros são validados no caso de uso. Só leitura.
const entrada = z.record(z.string(), z.unknown());

export const analisarQuadroPessoalAcao = definirAcao({ funcionalidade: 'rel.ia_quadro_pessoal', acao: 'executar', entrada }, (e, ctx) =>
  analisarQuadroPessoal(ctx, e),
);
