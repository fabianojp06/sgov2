import type { TxCliente } from '@/shared/db';
import { Percentual } from '@/shared/kernel';
import { aliquotaVigente, ehCompetencia, incideEm, type AnoMes, type Incidencia } from '../domain/impostos';

// Contrato do cad para os impostos (US-052; acréscimo ao C2, combinado na #138): a alíquota vigente de
// cada imposto ativo numa competência. A proposta (frente A) congela o percentual devolvido no snapshot
// da oficialização (RN_TAX_03); o cad nunca recalcula nada já oficializado (RN_TAX_06). Recebe o tx,
// sem guarda: a permissão é de quem chama.

export type ImpostoVigente = Readonly<{
  id: string;
  nome: string;
  incidencia: Incidencia;
  /** Null: o imposto ainda não tem alíquota que valha na competência. */
  percentual: Percentual | null;
  /** A competência (AAAA-MM) em que a alíquota devolvida começou a valer, ou null. */
  desde: AnoMes | null;
}>;

export const competenciaDaData = (d: Date): AnoMes => d.toISOString().slice(0, 7) as AnoMes;

/**
 * Impostos ativos, em ordem de nome, com a alíquota que vale na competência (AAAA-MM). Com `tipo`, só
 * os que incidem nele (AMBOS incide nos dois). Competência mal formada: lista vazia.
 */
export async function impostosVigentes(
  tx: TxCliente,
  competencia: string,
  opcoes: { tipo?: 'CONTRATO' | 'TERMO_PARCERIA' } = {},
): Promise<readonly ImpostoVigente[]> {
  if (!ehCompetencia(competencia)) return [];
  const impostos = await tx.imposto.findMany({
    where: { ativo: true },
    orderBy: { nome: 'asc' },
    select: { id: true, nome: true, incidencia: true, aliquotas: { select: { competencia: true, percentual: true } } },
  });
  return impostos
    .filter((i) => !opcoes.tipo || incideEm(i.incidencia as Incidencia, opcoes.tipo))
    .map((i) => {
      const v = aliquotaVigente(
        i.aliquotas.map((a) => ({ competencia: competenciaDaData(a.competencia), percentual: a.percentual })),
        competencia,
      );
      return {
        id: i.id,
        nome: i.nome,
        incidencia: i.incidencia as Incidencia,
        percentual: v ? Percentual.dePontos(v.percentual.toFixed(4)) : null,
        desde: v?.competencia ?? null,
      };
    });
}
