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
      ? { arquivo: v.get('arquivo'), aprovacao: { data: texto(v.get('aprovacaoData')), documento: texto(v.get('aprovacaoDocumento')) } }
      : v,
  // Os erros saem em aprovacao.data e aprovacao.documento, as mesmas chaves do caso de uso.
  z
    .object({
      arquivo: campoArquivoCarga,
      aprovacao: z
        .object({
          data: z.string().max(12, 'Informe a data da aprovação (AAAA-MM-DD).'),
          documento: z.string().max(200, 'Informe a referência do documento de aprovação (3 a 120 caracteres).'),
        })
        .strict(),
    })
    .strict(),
);

export const acaoImportarCentrosCusto = definirAcao({ funcionalidade: 'cad.centros_custo', acao: 'executar', entrada: entradaCc }, (e, ctx) => {
  const semAprovacao = e.aprovacao.data.trim() === '' && e.aprovacao.documento.trim() === '';
  return solicitarCargaCentrosCusto(ctx, e.arquivo, semAprovacao ? null : { data: e.aprovacao.data.trim(), documento: e.aprovacao.documento });
});

// M-n1: só devolve lote de centros de custo.
export const acaoConsultarCargaCc = definirAcao(
  { funcionalidade: 'cad.centros_custo', acao: 'executar', entrada: entradaConsultaCarga },
  (e, ctx) => consultarCargaDoGrupo(ctx, e.cargaId, 'CENTROS_CUSTO'),
);
