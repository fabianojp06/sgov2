import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { totalizar } from '@/shared/totalizer';
import { emUnidade } from '@/shared/unidade';
import { CATEGORIAS_EMPREGADO, type CategoriaEmpregado } from '../domain/empregado';
import type { CategoriaProposta, SituacaoProposta, TipoProposta } from '../domain/proposta';
import { montarArvore, separarPorPlano, type NoTotal } from '../domain/totalizador';
import { custoDaViagem } from '../domain/viagem';
import { cacheAnos, custoDoEmpregado } from './custo-empregado';
import { carregarCargos } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';
import { contarNoPeriodo } from './qtde-empregados';
import { totaisDaVersao, vePessoal } from './totalizadores';

// Pré-visualização da proposta (US-068; UC03.38, o "Corpo" do relatório; plano do P29). Só leitura, desde o
// Rascunho: a capa, as metas, os quantitativos de pessoal por período e a árvore de contas da última versão, com
// os totais. Sem tabela: compõe o que as abas já calculam.

const FUNCIONALIDADE = 'orc.propostas';

/** D-P29-3: a origem do valor da conta, no lugar da "fórmula" do UC03.38 (não há cadastro de fórmulas por conta). */
export const ORIGENS_VALOR = ['PESSOAL', 'VIAGENS', 'BENS', 'RATEIO'] as const;
export type OrigemValor = (typeof ORIGENS_VALOR)[number];

export type PreVisualizacao = {
  propostaId: string;
  numero: string;
  objeto: string;
  parceiro: string | null;
  tipo: TipoProposta;
  categoria: CategoriaProposta;
  versaoNumero: number;
  situacao: SituacaoProposta;
  /** Vigência em competências ("AAAA-MM"); é também o período de cada conta (D-P29-4). */
  vigencia: { inicio: string; fim: string };
  valorGlobal: Dinheiro;
  metas: readonly { numero: string; nome: string; valor: Dinheiro; ativa: boolean }[];
  /** Os quantitativos por período (UC03.38, primeiro agrupamento), em ordem do início. */
  quantitativos: readonly { documento: string; inicio: string; fim: string; quantidades: Readonly<Record<CategoriaEmpregado, number>> }[];
  totaisQuantitativos: Readonly<Record<CategoriaEmpregado, number>>;
  /** O segundo agrupamento: a árvore do plano com os valores da versão. */
  arvore: readonly NoTotal[];
  origens: Readonly<Record<string, readonly OrigemValor[]>>;
  foraDoPlano: readonly { conta: string; valor: Dinheiro }[];
  avisos: readonly string[];
  semPessoal: boolean;
};

const competencia = (d: Date) => d.toISOString().slice(0, 7);

/** Nulo se a proposta não existe ou o usuário não a vê (RLS). */
export async function obterPreVisualizacao(ctx: ContextoRequisicao, propostaId: string, depsParciais: Partial<DepsOrc> = {}): Promise<PreVisualizacao | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!/^[0-9a-f-]{36}$/i.test(propostaId)) return null;
  const [arvoreContas, indice] = await Promise.all([deps.estruturaCompleta.listarArvoreContas(deps.cliente), deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente)]);
  const comPessoal = vePessoal(ctx);
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({
        where: { id: propostaId, excluidaEm: null },
        include: { unidade: { select: { codigo: true } }, versoes: { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } },
      });
      const v = p?.versoes[0];
      if (!p || !v) return null;
      const [metas, qtdes, empregados, viagens, bens, celulas] = await Promise.all([
        tx.metaProposta.findMany({ where: { versaoPropostaId: v.id } }),
        tx.qtdeEmpregadoProposta.findMany({ where: { versaoPropostaId: v.id }, orderBy: [{ inicio: 'asc' }, { documento: 'asc' }] }),
        tx.empregadoProposta.findMany({ where: { versaoPropostaId: v.id } }),
        tx.viagemProposta.findMany({ where: { versaoPropostaId: v.id } }),
        tx.bemProposta.findMany({ where: { versaoPropostaId: v.id, ativo: true }, select: { conta: true } }),
        tx.rateioCelulaProposta.findMany({ where: { rateio: { versaoPropostaId: v.id }, valor: { gt: 0 } }, select: { conta: true } }),
      ]);
      const t = await totaisDaVersao(tx, deps, v.id, comPessoal);

      // As origens de cada conta (D-P29-3). O pessoal só para quem o vê (D-P29-2).
      const origens = new Map<string, Set<OrigemValor>>();
      const marcar = (conta: string | null, o: OrigemValor) => {
        if (conta) origens.set(conta, (origens.get(conta) ?? new Set()).add(o));
      };
      if (comPessoal && empregados.length > 0) {
        const anos = cacheAnos(await carregarCargos(tx, deps));
        const doPessoal = new Map<string, Dinheiro>();
        for (const e of empregados) await custoDoEmpregado(tx, deps, anos, { ...e, salarioMensal: Dinheiro.de(e.salarioMensal.toString()) }, doPessoal);
        for (const [conta, valor] of doPessoal) if (!valor.ehZero()) marcar(conta, 'PESSOAL');
      }
      for (const x of viagens) {
        const c = custoDaViagem({
          pessoas: x.pessoas,
          dias: x.dias,
          valorPassagem: Dinheiro.de(x.valorPassagem.toString()),
          valorDiaria: Dinheiro.de(x.valorDiaria.toString()),
          valorTransporte: Dinheiro.de(x.valorTransporte.toString()),
        });
        if (!c.passagem.ehZero()) marcar(x.contaPassagem, 'VIAGENS');
        if (!c.diaria.ehZero()) marcar(x.contaDiaria, 'VIAGENS');
        if (!c.transporte.ehZero()) marcar(x.contaTransporte, 'VIAGENS');
      }
      for (const b of bens) marcar(b.conta, 'BENS');
      for (const c of celulas) marcar(c.conta, 'RATEIO');

      const { dentro, fora } = separarPorPlano(t.porConta, (c) => indice.contaAnaliticaAtiva(c));
      const r = totalizar(indice.nosContas, dentro);
      const quantitativos = qtdes.map((q) => ({
        documento: q.documento,
        inicio: competencia(q.inicio),
        fim: competencia(q.fim),
        quantidades: contarNoPeriodo(q, empregados.filter((e) => e.metaId === q.metaId)),
      }));
      const totaisQuantitativos = Object.fromEntries(CATEGORIAS_EMPREGADO.map((c) => [c, quantitativos.reduce((s, q) => s + q.quantidades[c], 0)])) as Record<CategoriaEmpregado, number>;
      return {
        propostaId: p.id,
        numero: p.unidade.codigo,
        objeto: p.objeto,
        parceiro: p.parceiro,
        tipo: p.tipo as TipoProposta,
        categoria: p.categoria as CategoriaProposta,
        versaoNumero: v.numero,
        situacao: v.situacao as SituacaoProposta,
        vigencia: { inicio: competencia(p.inicio), fim: competencia(p.fim) },
        valorGlobal: t.total,
        metas: metas
          .map((m) => ({ numero: m.numero, nome: m.nome, valor: Dinheiro.de(m.valor.toString()), ativa: m.status === 'ATIVO' }))
          .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })),
        quantitativos,
        totaisQuantitativos,
        arvore: montarArvore(arvoreContas, (c) => r.valor(c)),
        origens: Object.fromEntries([...origens].map(([conta, s]) => [conta, ORIGENS_VALOR.filter((o) => s.has(o))])),
        foraDoPlano: fora,
        avisos: t.avisos,
        semPessoal: t.semPessoal,
      };
    },
    { cliente: deps.cliente },
  );
}
