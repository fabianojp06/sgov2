import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { dataParaTexto } from '../domain/bem';
import { competenciaParaTexto, type CategoriaEmpregado } from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { cacheAnos, custoDoEmpregado } from './custo-empregado';
import { carregarCargos } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';
import { situacaoDoLote, type SituacaoLote } from './lote-pessoal';
import { VERSAO_OFICIAL } from './realizado';
import { vePessoal } from './totalizadores';

// Leitura da versão oficializada do TP para os demonstrativos da frente B (pedido na #138; US-097 e US-098, decididas
// pelo PO na #119 e na #120). Como o `realizadoPorTp`: RLS do usuário e `orc.realizado:consultar`; nulo se o TP não
// existe ou o usuário não o vê; sem versão oficializada, `versao` nulo e listas vazias.

const FUNCIONALIDADE = 'orc.realizado';

export type BemDaVersaoOficial = {
  conta: string;
  descricao: string;
  /** "AAAA-MM-DD". */
  data: string;
  quantidade: number;
  valorUnitario: Dinheiro;
  /** Nulo na Consolidada. */
  metaNumero: string | null;
};

export type BensDaVersaoOficial = { versao: number | null; itens: readonly BemDaVersaoOficial[] };

export type EmpregadoDaVersaoOficial = {
  ordem: number;
  /** Nulo: vaga "A CONTRATAR" (RN0249). */
  nome: string | null;
  categoria: CategoriaEmpregado;
  /** Código e nome do cargo no cadastro. */
  cargo: string;
  /** RN_EMP_008: o nó analítico da estrutura funcional ligado ao cargo; nulo se o cargo não tem. */
  vinculoFuncional: string | null;
  /** Competências em "AAAA-MM". */
  inicio: string;
  fim: string;
  /** Nulos na Consolidada. */
  metaNumero: string | null;
  metaNome: string | null;
  /**
   * Custo do primeiro mês (REQ_EMP_002); nulo para quem não vê o custo do pessoal (D-P20-5, D-P23-5), sem parâmetros no ano
   * ou com recusa do motor (os avisos ficam na tela de empregados).
   */
  custoMensal: Dinheiro | null;
};

export type EmpregadosDaVersaoOficial = {
  versao: number | null;
  /** 'META' ou 'CONSOLIDADA' (a categoria da proposta). */
  categoriaTp: string;
  /** O lote de pessoal da versão (RN_WA05_005); a versão oficializada com empregados vem com ele Homologado (D-P27-8). */
  lote: SituacaoLote | null;
  empregados: readonly EmpregadoDaVersaoOficial[];
};

async function versaoOficialDoTp(tx: TxCliente, tp: string) {
  return tx.propostaTp.findFirst({ where: { excluidaEm: null, unidade: { codigo: tp } }, select: { categoria: true, versoes: VERSAO_OFICIAL } });
}

/** UC05.04 (Aquisições): os bens ativos da última versão oficializada do TP, por data. */
export async function bensDaVersaoOficial(ctx: ContextoRequisicao, filtro: { tp: string }, depsParciais: Partial<DepsOrc> = {}): Promise<BensDaVersaoOficial | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await versaoOficialDoTp(tx, filtro.tp);
      if (!p) return null;
      const v = p.versoes[0];
      if (!v) return { versao: null, itens: [] };
      const bens = await tx.bemProposta.findMany({
        where: { versaoPropostaId: v.id, ativo: true },
        orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
        select: { conta: true, descricao: true, data: true, quantidade: true, valorUnitario: true, meta: { select: { numero: true } } },
      });
      return {
        versao: v.numero,
        itens: bens.map((b) => ({
          conta: b.conta,
          descricao: b.descricao,
          data: dataParaTexto(b.data),
          quantidade: b.quantidade,
          valorUnitario: Dinheiro.de(b.valorUnitario.toString()),
          metaNumero: b.meta?.numero ?? null,
        })),
      };
    },
    { cliente: deps.cliente },
  );
}

/** UC05.05, UC05.06 e UC05.10: os empregados da última versão oficializada do TP, por meta e ordem. */
export async function empregadosDaVersaoOficial(
  ctx: ContextoRequisicao,
  filtro: { tp: string },
  depsParciais: Partial<DepsOrc> = {},
): Promise<EmpregadosDaVersaoOficial | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const comCusto = vePessoal(ctx);
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await versaoOficialDoTp(tx, filtro.tp);
      if (!p) return null;
      const v = p.versoes[0];
      if (!v) return { versao: null, categoriaTp: p.categoria, lote: null, empregados: [] };
      const [gravados, lote, cache] = await Promise.all([
        tx.empregadoProposta.findMany({ where: { versaoPropostaId: v.id }, include: { meta: { select: { numero: true, nome: true } } } }),
        situacaoDoLote(tx, v.id),
        carregarCargos(tx, deps),
      ]);
      // A Consolidada (sem meta) por último, como na tela (RN0148).
      gravados.sort((a, b) => (a.meta?.numero ?? '￿').localeCompare(b.meta?.numero ?? '￿', 'pt-BR', { numeric: true }) || a.ordem - b.ordem);
      const anos = cacheAnos(cache);
      const empregados: EmpregadoDaVersaoOficial[] = [];
      for (const e of gravados) {
        const custo = comCusto ? await custoDoEmpregado(tx, deps, anos, { ...e, salarioMensal: Dinheiro.de(e.salarioMensal) }) : null;
        const cargo = cache.porId.get(e.cargoId);
        empregados.push({
          ordem: e.ordem,
          nome: e.nome,
          categoria: e.categoria as CategoriaEmpregado,
          cargo: cargo ? `${cargo.codigo} – ${cargo.nome}` : M.CARGO_NAO_ENCONTRADO,
          vinculoFuncional: cargo?.vinculoFuncional?.nome ?? null,
          inicio: competenciaParaTexto(e.inicio),
          fim: competenciaParaTexto(e.fim),
          metaNumero: e.meta?.numero ?? null,
          metaNome: e.meta?.nome ?? null,
          custoMensal: custo?.mensal ?? null,
        });
      }
      return { versao: v.numero, categoriaTp: p.categoria, lote, empregados };
    },
    { cliente: deps.cliente },
  );
}
