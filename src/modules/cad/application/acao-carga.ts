import 'server-only';
import { z } from 'zod';
import type { ContextoRequisicao } from '@/shared/authz';
import { ok, type Resultado } from '@/shared/kernel';
import { MSG_ARQUIVO, problemaArquivoCarga } from '../domain/arquivo-carga';
import { consultarCarga, type ArquivoCarga, type EstadoCarga, type TipoCarga } from './importar-estrutura';

// Peças comuns das ações de carga (US-043; plano do P4, Task 7a). Ficam fora dos arquivos
// 'use server', que só exportam as ações.

/**
 * FormData com o campo `arquivo` → ArquivoCarga: .xlsx de até 1 MB. A assinatura PK, o zip e o
 * conteúdo são conferidos pelo leitor seguro (R4); o nome é saneado lá também.
 */
export const entradaArquivoCarga = z.preprocess(
  (v) => (v instanceof FormData ? { arquivo: v.get('arquivo') } : v),
  z
    .object({
      arquivo: z
        .instanceof(File, { message: MSG_ARQUIVO.ausente })
        .superRefine((f, c) => {
          const problema = problemaArquivoCarga({ nome: f.name, tamanho: f.size });
          if (problema) c.addIssue({ code: 'custom', message: problema });
        })
        .transform(async (f): Promise<ArquivoCarga> => ({ nome: f.name, conteudo: new Uint8Array(await f.arrayBuffer()) })),
    })
    .strict(),
);

// M-n1: cada grupo de lote tem a sua ação de consulta, com a permissão do tipo (o teste de
// arquitetura exige o definirAcao explícito em cada uma; aqui fica só a parte comum).
export type GrupoCarga = 'PLANO_CONTAS' | 'CENTROS_CUSTO' | 'CARGOS';
const GRUPO_DO_TIPO: Record<TipoCarga, GrupoCarga> = {
  PLANO_CONTAS: 'PLANO_CONTAS',
  CENTROS_CUSTO: 'CENTROS_CUSTO',
  CARGOS: 'CARGOS',
  CARGOS_RECIFRA: 'CARGOS',
};

export const entradaConsultaCarga = z.object({ cargaId: z.string().max(36) }).strict();

/** Estado do lote para a tela acompanhar; lote de outro grupo ou inexistente → null. */
export async function consultarCargaDoGrupo(ctx: ContextoRequisicao, cargaId: string, grupo: GrupoCarga): Promise<Resultado<EstadoCarga | null>> {
  const carga = await consultarCarga(ctx, cargaId);
  return ok(carga && GRUPO_DO_TIPO[carga.tipo] === grupo ? carga : null);
}
