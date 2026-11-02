'use server';

import 'server-only';
import { definirAcao } from '@/shared/authz';
import { consultarCargaDoGrupo, entradaArquivoCarga, entradaConsultaCarga } from './acao-carga';
import { solicitarCargaPlanoContas } from './importar-estrutura';

// Server Actions da importação do plano de contas (US-043 parte 4). A negação (403) é auditada pela
// definirAcao (C5); a carga em si é do worker, e a tela acompanha o lote pela consulta.
export const acaoImportarPlanoContas = definirAcao(
  { funcionalidade: 'cad.plano_contas', acao: 'executar', entrada: entradaArquivoCarga },
  (e, ctx) => solicitarCargaPlanoContas(ctx, e.arquivo),
);

// M-n1: só devolve lote do plano de contas.
export const acaoConsultarCargaPlano = definirAcao(
  { funcionalidade: 'cad.plano_contas', acao: 'executar', entrada: entradaConsultaCarga },
  (e, ctx) => consultarCargaDoGrupo(ctx, e.cargaId, 'PLANO_CONTAS'),
);
