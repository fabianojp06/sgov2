import type { BeneficiosCargo, CargoExercicio, PremissasExercicio, SerieMensalComponentes } from '@/modules/cad/servidor';
import type { TxCliente } from '@/shared/db';
import { falha, type Dinheiro, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import type { DepsOrc } from './deps';

// Custo da posição com o cargo do cadastro de C&S (US-056; plano do P15, D-P15-3), o mesmo na prévia, na
// gravação e no recalcularExercicio. Sem cargo, o cálculo de antes: os benefícios padrão das premissas
// e nenhum adicional. Com cargo, os benefícios do cargo SUBSTITUEM os padrão (são uma escolha sobre a
// mesma Tabela Mestre; somar contaria duas vezes), e o adicional do cargo entra (§6.4). Os cargos vêm da
// versão sem a cifra: o motor não usa o salário da Fonte Ativa (o salário é o gravado na posição).

export type CacheCargos = { porId: ReadonlyMap<string, CargoExercicio>; beneficios: Map<string, BeneficiosCargo> };

/** Uma leitura dos cargos (com os inativos) por chamada; os benefícios entram no cache por cargo distinto. */
export async function carregarCargos(tx: TxCliente, deps: DepsOrc): Promise<CacheCargos> {
  const cargos = await deps.custoPessoal.listarCargosSemSalarioCifrado(tx, { incluirInativos: true });
  return { porId: new Map(cargos.map((c) => [c.id, c])), beneficios: new Map() };
}

/**
 * Lê em lote (beneficiosDosCargos, #421: uma leitura das premissas) os benefícios dos cargos que ainda não
 * estão no cache. O recálculo do exercício chama antes do laço das posições.
 */
export async function precarregarBeneficios(tx: TxCliente, deps: DepsOrc, cache: CacheCargos, ano: number, cargoIds: Iterable<string>): Promise<void> {
  const faltam = [...new Set(cargoIds)].filter((id) => !cache.beneficios.has(id));
  if (faltam.length === 0) return;
  for (const [id, b] of await deps.custoPessoal.beneficiosDosCargos(tx, ano, faltam)) cache.beneficios.set(id, b);
}

export type PosicaoCusto = { quantidade: number; salarioMensal: Dinheiro; mesInicio: number; mesSaida: number; cargoId: string | null };

/** Premissas do cálculo da posição: com cargo, os benefícios e os avisos do cargo no exercício. */
async function premissasDoCargo(tx: TxCliente, deps: DepsOrc, cache: CacheCargos, premissas: PremissasExercicio, cargoId: string): Promise<PremissasExercicio> {
  if (!cache.beneficios.has(cargoId)) await precarregarBeneficios(tx, deps, cache, premissas.ano, [cargoId]);
  const r = cache.beneficios.get(cargoId) ?? { beneficios: [], avisos: [] };
  return { ...premissas, beneficios: r.beneficios, avisos: [...premissas.avisos, ...r.avisos] };
}

export async function custoDaPosicao(
  tx: TxCliente,
  deps: DepsOrc,
  cache: CacheCargos,
  premissas: PremissasExercicio,
  p: PosicaoCusto,
): Promise<Resultado<SerieMensalComponentes>> {
  const base = { quantidade: p.quantidade, salarioMensal: p.salarioMensal, mesInicio: p.mesInicio, mesSaida: p.mesSaida };
  if (p.cargoId === null) return deps.custoPessoal.calcularCustoPosicao(base, premissas);
  const cargo = cache.porId.get(p.cargoId);
  if (!cargo) return falha([{ campo: 'cargoId', mensagem: MENSAGENS_ORC.CARGO_FORA_DO_CADASTRO }]);
  const comCargo = await premissasDoCargo(tx, deps, cache, premissas, p.cargoId);
  return deps.custoPessoal.calcularCustoPosicao(cargo.adicional ? { ...base, adicional: cargo.adicional } : base, comCargo);
}

/** Avisos do cargo (os que não são das premissas do ano), sem repetir, para o ResumoRecalculo. */
export function avisosDosCargos(cache: CacheCargos, premissas: PremissasExercicio): string[] {
  const doAno = new Set(premissas.avisos);
  return [...new Set([...cache.beneficios.values()].flatMap((b) => b.avisos))].filter((a) => !doAno.has(a));
}
