import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { Dinheiro, Percentual } from '@/shared/kernel';
import { emTodasAsUnidades } from '@/shared/unidade';
import type { TxCliente } from '@/shared/db';
import { totalDoBem } from '../domain/bem';
import { ROTULO_TIPO_PROPOSTA, type SituacaoProposta, type TipoProposta } from '../domain/proposta';
import { custoDaViagem } from '../domain/viagem';
import { contextoAuditoria } from './calculo-linhas';
import { cacheAnos, custoDoEmpregado } from './custo-empregado';
import { carregarCargos } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';

// Consolidado dos TPs (US-101; spec §6.7; plano do P31). O único lugar com vários TPs juntos: para quem tem
// orc.consolidado, todos os TPs ativos, mesmo os que a pessoa não opera, pelo caminho emTodasAsUnidades
// (transação só de leitura). Cada consulta vai ao Histórico antes da leitura (acesso auditado).

const FUNCIONALIDADE = 'orc.consolidado';

export type LinhaConsolidado = {
  numero: string;
  objeto: string;
  tipo: string;
  /** A situação da última versão. */
  situacao: SituacaoProposta;
  versaoAtual: number;
  /** D-P31-2: a versão oficializada mais recente e o Valor Global do snapshot dela; nulos se nunca oficializado. */
  versaoOficial: number | null;
  orcado: Dinheiro | null;
  /** D-P31-3: zero até a execução (F5). */
  realizado: Dinheiro;
  percentual: Percentual | null;
};

export type Consolidado = { linhas: readonly LinhaConsolidado[]; totalOrcado: Dinheiro; totalRealizado: Dinheiro; percentual: Percentual | null; oficializados: number };

export async function obterConsolidado(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<Consolidado> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  // Sem a trilha, não há dado: o registro vem antes e numa transação própria (a da leitura não grava).
  await deps.cliente.$transaction((tx) =>
    auditar(tx, { contexto: contextoAuditoria(ctx), funcionalidade: FUNCIONALIDADE, tipo: 'CONSULTA', descricao: 'Consulta ao Consolidado dos TPs' }),
  );
  return emTodasAsUnidades(
    ctx,
    async (tx) => {
      const propostas = await tx.propostaTp.findMany({
        where: { excluidaEm: null, unidade: { ativo: true } },
        include: {
          unidade: { select: { codigo: true } },
          versoes: { orderBy: { numero: 'desc' }, select: { numero: true, situacao: true, snapshot: { select: { valorGlobal: true } } } },
        },
      });
      const linhas = propostas
        .map((p): LinhaConsolidado => {
          const ultima = p.versoes[0];
          const oficial = p.versoes.find((v) => v.snapshot !== null);
          const orcado = oficial?.snapshot ? Dinheiro.de(oficial.snapshot.valorGlobal.toString()) : null;
          const realizado = Dinheiro.zero();
          return {
            numero: p.unidade.codigo,
            objeto: p.objeto,
            tipo: ROTULO_TIPO_PROPOSTA[p.tipo as TipoProposta],
            situacao: (ultima?.situacao ?? 'RASCUNHO') as SituacaoProposta,
            versaoAtual: ultima?.numero ?? 0,
            versaoOficial: oficial?.numero ?? null,
            orcado,
            realizado,
            percentual: orcado ? Percentual.razao(realizado, orcado) : null,
          };
        })
        .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
      const totalOrcado = Dinheiro.somarTodos(linhas.flatMap((l) => (l.orcado ? [l.orcado] : [])));
      const totalRealizado = Dinheiro.somarTodos(linhas.map((l) => l.realizado));
      return { linhas, totalOrcado, totalRealizado, percentual: Percentual.razao(totalRealizado, totalOrcado), oficializados: linhas.filter((l) => l.orcado).length };
    },
    { cliente: deps.cliente },
  );
}

/**
 * O comparativo entre TPs para a US-106 da frente B (IA-17; pedido na #138): a mesma permissão, o mesmo registro
 * no Histórico e o mesmo caminho só de leitura do consolidado. Por TP, a versão usada é a última oficializada
 * (oficial: true, com o Valor Global do snapshot) ou, sem oficialização, a última versão (oficial: false, com o
 * Valor Global calculado). Só totais por TP: nada de empregado nem salário. `postos` deixa o rel omitir o peso do
 * pessoal de quem tem poucos postos (US-107).
 */
export type ComparativoTp = {
  numero: string;
  tipo: TipoProposta;
  situacao: SituacaoProposta;
  oficial: boolean;
  versao: number;
  vigencia: { inicio: string; fim: string };
  valorGlobal: Dinheiro;
  porCategoria: { pessoal: Dinheiro; viagens: Dinheiro; bens: Dinheiro; rateioAdmCentral: Dinheiro; outros: Dinheiro };
  postos: number;
  /** Privacidade do pessoal no rel (US-107, pedido na #138): custos por pessoa-mês distintos entre os empregados calculados. */
  custosPessoaDistintos?: number;
  /** true se todo empregado tem custo calculado (> 0, sem aviso nem erro do motor). */
  pessoalCalculado?: boolean;
  metas: readonly { numero: string; valor: Dinheiro; ativa?: boolean }[];
  /** Zero até a execução (F5), como no consolidado. */
  realizado: Dinheiro;
};

/** As somas por origem dos lançamentos da versão (as linhas de uma versão oficializada não mudam mais). */
async function somasPorOrigem(tx: TxCliente, deps: DepsOrc, versaoId: string, anos: ReturnType<typeof cacheAnos>) {
  const [empregados, viagens, bens, celulas] = await Promise.all([
    tx.empregadoProposta.findMany({ where: { versaoPropostaId: versaoId } }),
    tx.viagemProposta.findMany({ where: { versaoPropostaId: versaoId } }),
    tx.bemProposta.findMany({ where: { versaoPropostaId: versaoId, ativo: true } }),
    tx.rateioCelulaProposta.findMany({ where: { rateio: { versaoPropostaId: versaoId } }, select: { valor: true } }),
  ]);
  let pessoal = Dinheiro.zero();
  const custosPessoa = new Set<string>();
  let pessoalCalculado = true;
  for (const e of empregados) {
    const c = await custoDoEmpregado(tx, deps, anos, { ...e, salarioMensal: Dinheiro.de(e.salarioMensal.toString()) });
    pessoal = pessoal.somar(c.periodo);
    const calculado = !c.periodo.ehZero() && c.avisos.length === 0 && c.erros.length === 0;
    if (!calculado) {
      pessoalCalculado = false;
      continue;
    }
    const meses = (e.fim.getUTCFullYear() - e.inicio.getUTCFullYear()) * 12 + (e.fim.getUTCMonth() - e.inicio.getUTCMonth()) + 1;
    custosPessoa.add(c.periodo.dividir(String(meses)).paraString());
  }
  const viagem = Dinheiro.somarTodos(
    viagens.map((v) => {
      const c = custoDaViagem({
        pessoas: v.pessoas,
        dias: v.dias,
        valorPassagem: Dinheiro.de(v.valorPassagem.toString()),
        valorDiaria: Dinheiro.de(v.valorDiaria.toString()),
        valorTransporte: Dinheiro.de(v.valorTransporte.toString()),
      });
      return c.passagem.somar(c.diaria).somar(c.transporte);
    }),
  );
  return {
    pessoal,
    viagens: viagem,
    bens: Dinheiro.somarTodos(bens.map((b) => totalDoBem({ quantidade: b.quantidade, valorUnitario: Dinheiro.de(b.valorUnitario.toString()) }))),
    rateioAdmCentral: Dinheiro.somarTodos(celulas.map((c) => Dinheiro.de(c.valor.toString()))),
    postos: empregados.length,
    custosPessoaDistintos: custosPessoa.size,
    pessoalCalculado,
  };
}

export async function obterComparativoTps(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly ComparativoTp[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  await deps.cliente.$transaction((tx) =>
    auditar(tx, { contexto: contextoAuditoria(ctx), funcionalidade: FUNCIONALIDADE, tipo: 'CONSULTA', descricao: 'Consulta ao comparativo entre TPs' }),
  );
  return emTodasAsUnidades(
    ctx,
    async (tx) => {
      const propostas = await tx.propostaTp.findMany({
        where: { excluidaEm: null, unidade: { ativo: true } },
        include: {
          unidade: { select: { codigo: true } },
          versoes: { orderBy: { numero: 'desc' }, select: { id: true, numero: true, situacao: true, snapshot: { select: { valorGlobal: true } } } },
        },
      });
      const anos = cacheAnos(await carregarCargos(tx, deps));
      const linhas: ComparativoTp[] = [];
      for (const p of propostas) {
        const v = p.versoes.find((x) => x.snapshot !== null) ?? p.versoes[0];
        if (!v) continue;
        const somas = await somasPorOrigem(tx, deps, v.id, anos);
        const calculado = Dinheiro.somarTodos([somas.pessoal, somas.viagens, somas.bens, somas.rateioAdmCentral]);
        const valorGlobal = v.snapshot ? Dinheiro.de(v.snapshot.valorGlobal.toString()) : calculado;
        const metas = await tx.metaProposta.findMany({ where: { versaoPropostaId: v.id }, select: { numero: true, valor: true, status: true } });
        linhas.push({
          numero: p.unidade.codigo,
          tipo: p.tipo as TipoProposta,
          situacao: v.situacao as SituacaoProposta,
          oficial: v.snapshot !== null,
          versao: v.numero,
          vigencia: { inicio: p.inicio.toISOString().slice(0, 7), fim: p.fim.toISOString().slice(0, 7) },
          valorGlobal,
          // O snapshot congelou o pessoal com os parâmetros da época: a diferença para o cálculo de hoje fica em outros.
          porCategoria: { pessoal: somas.pessoal, viagens: somas.viagens, bens: somas.bens, rateioAdmCentral: somas.rateioAdmCentral, outros: valorGlobal.subtrair(calculado) },
          postos: somas.postos,
          custosPessoaDistintos: somas.custosPessoaDistintos,
          pessoalCalculado: somas.pessoalCalculado,
          metas: metas.map((m) => ({ numero: m.numero, valor: Dinheiro.de(m.valor.toString()), ativa: m.status === 'ATIVO' })).sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })),
          realizado: Dinheiro.zero(),
        });
      }
      return linhas.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
    },
    { cliente: deps.cliente },
  );
}
