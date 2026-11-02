'use server';

import 'server-only';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { campoArquivoCarga, consultarCargaDoGrupo, entradaConsultaCarga } from './acao-carga';
import { solicitarCargaCentrosCusto } from './importar-estrutura';

// Server Actions da importação dos centros de custo (US-046 parte 2). A negação (403) é auditada
// pela definirAcao (C5). A trava da DIREX (R16, GAP-CC-001) é do caso de uso: aqui só se monta a
// aprovação; data e documento em branco = sem aprovação.
const texto = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

const entradaCc = z.preprocess(
  (v) =>
    v instanceof FormData
      ? { arquivo: v.get('arquivo'), aprovacaoData: texto(v.get('aprovacaoData')), aprovacaoDocumento: texto(v.get('aprovacaoDocumento')) }
      : v,
  z
    .object({
      arquivo: campoArquivoCarga,
      aprovacaoData: z.string().max(10, 'Informe a data da aprovação (AAAA-MM-DD).'),
      aprovacaoDocumento: z.string().max(200, 'Informe a referência do documento de aprovação (3 a 120 caracteres).'),
    })
    .strict(),
);

export const acaoImportarCentrosCusto = definirAcao({ funcionalidade: 'cad.centros_custo', acao: 'executar', entrada: entradaCc }, (e, ctx) => {
  const semAprovacao = e.aprovacaoData.trim() === '' && e.aprovacaoDocumento.trim() === '';
  return solicitarCargaCentrosCusto(ctx, e.arquivo, semAprovacao ? null : { data: e.aprovacaoData.trim(), documento: e.aprovacaoDocumento });
});

// M-n1: só devolve lote de centros de custo.
export const acaoConsultarCargaCc = definirAcao(
  { funcionalidade: 'cad.centros_custo', acao: 'executar', entrada: entradaConsultaCarga },
  (e, ctx) => consultarCargaDoGrupo(ctx, e.cargaId, 'CENTROS_CUSTO'),
);
