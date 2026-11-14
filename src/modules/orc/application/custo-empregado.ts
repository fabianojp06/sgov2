import type { PremissasExercicio, SerieMensalComponentes } from '@/modules/cad/servidor';
import type { TxCliente } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { mesesDoAno, type Competencias } from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { custoDaPosicao, type CacheCargos } from './custo-posicao';
import type { DepsOrc } from './deps';

// O custo do empregado da proposta pelo motor único, ano a ano (US-070, D-P20-4), num módulo próprio: os
// empregados (lista e gravação) e os totalizadores (US-074, plano do P23) o usam, e os totalizadores não podem
// importar os empregados (ciclo com as metas, que mostram o Valor Global).

/**
 * Premissas e benefícios por ano, lidos uma vez por chamada (premissas nulas: o ano não tem parâmetros). Os
 * benefícios do cargo mudam de ano para ano, e o cache do custo-posicao é por cargo: um por ano, com os
 * mesmos cargos.
 */
export type CacheAnos = { cargos: CacheCargos; porAno: Map<number, { premissas: PremissasExercicio | null; cache: CacheCargos }> };
export const cacheAnos = (cargos: CacheCargos): CacheAnos => ({ cargos, porAno: new Map() });

export type CustoEmpregado = { mensal: Dinheiro | null; periodo: Dinheiro; avisos: string[]; erros: string[] };

/**
 * D-P20-4: o motor (custoDaPosicao do P15, com o adicional e os benefícios do cargo) para cada ano da
 * competência, com uma pessoa e o salário gravado. Ano sem parâmetros fica sem custo, com aviso; recusa do
 * motor vai em `erros` (a gravação recusa; a lista mostra como aviso). Com `porConta`, soma cada componente do
 * motor na conta dele (os totalizadores, RN_TOT_03); com `porAno`, recebe a série mensal de cada ano (o cronograma,
 * US-075).
 */
export async function custoDoEmpregado(
  tx: TxCliente,
  deps: DepsOrc,
  anos: CacheAnos,
  e: Competencias & { cargoId: string; salarioMensal: Dinheiro },
  porConta?: Map<string, Dinheiro>,
  porAno?: (ano: number, serie: SerieMensalComponentes) => void,
): Promise<CustoEmpregado> {
  const r: CustoEmpregado = { mensal: null, periodo: Dinheiro.zero(), avisos: [], erros: [] };
  for (let ano = e.inicio.getUTCFullYear(); ano <= e.fim.getUTCFullYear(); ano++) {
    let doAno = anos.porAno.get(ano);
    if (!doAno) {
      doAno = { premissas: await deps.custoPessoal.obterPremissasExercicio(tx, ano), cache: { porId: anos.cargos.porId, beneficios: new Map() } };
      anos.porAno.set(ano, doAno);
    }
    const p = doAno.premissas;
    if (!p) {
      r.avisos.push(M.EMPREGADO_SEM_PARAMETROS(ano));
      continue;
    }
    const meses = mesesDoAno(e, ano)!;
    const serie = await custoDaPosicao(tx, deps, doAno.cache, p, { quantidade: 1, salarioMensal: e.salarioMensal, cargoId: e.cargoId, ...meses });
    if (!serie.ok) {
      r.erros.push(...serie.erros.map((x) => `${ano}: ${x.mensagem}`));
      continue;
    }
    r.periodo = r.periodo.somar(serie.valor.total);
    if (porConta) for (const l of serie.valor.linhas) porConta.set(l.conta, (porConta.get(l.conta) ?? Dinheiro.zero()).somar(l.total));
    porAno?.(ano, serie.valor);
    if (ano === e.inicio.getUTCFullYear()) r.mensal = serie.valor.totalMes[meses.mesInicio - 1]!;
  }
  return r;
}
