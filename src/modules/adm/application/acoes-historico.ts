'use server';

import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { lerFiltroHistorico } from './filtro-historico';
import { registrarImpressao } from './historico';

// Ação da tela do Histórico (US-040): registra a impressão com os filtros da tela; o botão abre a
// impressão do navegador depois.
const parametros = z.preprocess(
  (v) => (v instanceof FormData ? Object.fromEntries([...v.entries()].filter(([, x]) => typeof x === 'string')) : v),
  z.record(z.string(), z.string()),
);

export const registrarImpressaoHistorico = definirAcao({ funcionalidade: 'adm.historico', acao: 'imprimir', entrada: parametros }, (e, ctx) =>
  registrarImpressao(ctx, lerFiltroHistorico(e, new Date()).filtro),
);
