import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { totalDoBem } from '../domain/bem';
import { distribuirIgual, montarCronograma, type LinhaCronograma } from '../domain/cronograma';
import { competenciaParaTexto } from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { ROTULO_TIPO_PROPOSTA, type SituacaoProposta, type TipoProposta } from '../domain/proposta';
import { competenciasDaVigencia } from '../domain/rateio';
import { custoDaViagem } from '../domain/viagem';
import { cacheAnos, custoDoEmpregado } from './custo-empregado';
import { carregarCargos } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';
import { situacaoDoLote } from './lote-pessoal';
import { situacaoDaViagem } from './lote-viagem';
import { uuid } from './pessoal-comum';
import { totaisDaVersao, vePessoal } from './totalizadores';

// Cronograma de desembolso da proposta de TP (US-075; UC04.01; plano do P25, Task 1). Sem tabela: a série mensal é
// montada na leitura a partir dos lançamentos da versão (REQ_CD_003), e o domínio calcula o acumulado, o %, o
// repasse do ciclo e os fechamentos anuais. Pessoal mês a mês pelo motor (só para quem o vê, D-P23-5); bens no
// mês da data; rateio na competência; viagens, sem data, distribuídas por igual na vigência (D-P25-2). O pessoal só
// entra com o lote homologado (RN_WA05_005, D-P27-4), e as viagens, com o lote validado (UC6.02 passo 4, D-P28-1).

const FUNCIONALIDADE = 'orc.cronograma';

export type FiltrosCronograma = { meta?: string | undefined };

export type ContaPorAno = { conta: string; descricao: string; anos: Readonly<Record<string, Dinheiro>>; total: Dinheiro };

export type CronogramaTela = {
  propostaId: string;
  numero: string;
  objeto: string;
  tipo: TipoProposta;
  versaoNumero: number;
  situacao: SituacaoProposta;
  /** RN0250: o rótulo da meta escolhida, ou "Todos". */
  meta: string;
  metas: readonly { id: string; rotulo: string }[];
  linhas: readonly LinhaCronograma[];
  /** Previsão de despesas: conta × ano (D-P25-1). */
  anos: readonly string[];
  porConta: readonly ContaPorAno[];
  total: Dinheiro;
  valorGlobal: Dinheiro;
  avisos: readonly string[];
  semPessoal: boolean;
  /** D-P27-4: há empregados, mas o lote de pessoal ainda não foi homologado (WA05). */
  pessoalNaoHomologado: boolean;
  /** D-P28-1: há viagens ainda não validadas no WA02, fora do cronograma. */
  viagensNaoValidadas: boolean;
  viagensDistribuidas: boolean;
};

export type SeriesDaVersao = {
  porMes: Map<string, Dinheiro>;
  /** Conta × competência ('conta|AAAA-MM'): o previsto da porta do realizado (US-085, parte 2). */
  porContaMes: Map<string, Dinheiro>;
  porContaAno: Map<string, Map<string, Dinheiro>>;
  total: Dinheiro;
  avisos: string[];
  semPessoal: boolean;
  pessoalNaoHomologado: boolean;
  viagensNaoValidadas: boolean;
  viagensDistribuidas: boolean;
};

const somarEm = (m: Map<string, Dinheiro>, k: string, v: Dinheiro) => {
  if (!v.ehZero()) m.set(k, (m.get(k) ?? Dinheiro.zero()).somar(v));
};

/**
 * D-P25-2: a série mensal e a previsão por conta e ano da versão. Com `metaId`, só os lançamentos da meta (o
 * rateio, sem meta, fica de fora). Meses fora da vigência não entram (o motor e as validações já os evitam).
 */
export async function seriesDaVersao(
  tx: TxCliente,
  deps: DepsOrc,
  versaoId: string,
  comPessoal: boolean,
  competencias: readonly string[],
  metaId?: string,
): Promise<SeriesDaVersao> {
  const porMes = new Map<string, Dinheiro>();
  const porContaMes = new Map<string, Dinheiro>();
  const porContaAno = new Map<string, Map<string, Dinheiro>>();
  const naVigencia = new Set(competencias);
  const lancar = (conta: string, comp: string, v: Dinheiro) => {
    if (!naVigencia.has(comp) || v.ehZero()) return;
    somarEm(porMes, comp, v);
    somarEm(porContaMes, `${conta}|${comp}`, v);
    const anos = porContaAno.get(conta) ?? new Map<string, Dinheiro>();
    somarEm(anos, comp.slice(0, 4), v);
    porContaAno.set(conta, anos);
  };
  const daMeta = metaId ? { metaId } : {};
  const [empregados, todasViagens, bens, celulas] = await Promise.all([
    tx.empregadoProposta.findMany({ where: { versaoPropostaId: versaoId, ...daMeta } }),
    tx.viagemProposta.findMany({ where: { versaoPropostaId: versaoId, ...daMeta }, include: { loteViagem: { select: { situacao: true } } } }),
    tx.bemProposta.findMany({ where: { versaoPropostaId: versaoId, ativo: true, ...daMeta } }),
    metaId ? Promise.resolve([]) : tx.rateioCelulaProposta.findMany({ where: { rateio: { versaoPropostaId: versaoId } } }),
  ]);
  const avisos = new Set<string>();
  const viagens = todasViagens.filter((v) => situacaoDaViagem(v.loteViagem) === 'VALIDADO');
  const homologado = empregados.length > 0 && (await situacaoDoLote(tx, versaoId)) === 'HOMOLOGADO';
  if (comPessoal && homologado) {
    const anos = cacheAnos(await carregarCargos(tx, deps));
    for (const e of empregados) {
      const c = await custoDoEmpregado(tx, deps, anos, { ...e, salarioMensal: Dinheiro.de(e.salarioMensal.toString()) }, undefined, (ano, serie) => {
        for (const l of serie.linhas) l.meses.forEach((v, i) => lancar(l.conta, `${ano}-${String(i + 1).padStart(2, '0')}`, v));
      });
      for (const a of [...c.avisos, ...c.erros]) avisos.add(a);
    }
  }
  for (const v of viagens) {
    const c = custoDaViagem({
      pessoas: v.pessoas,
      dias: v.dias,
      valorPassagem: Dinheiro.de(v.valorPassagem.toString()),
      valorDiaria: Dinheiro.de(v.valorDiaria.toString()),
      valorTransporte: Dinheiro.de(v.valorTransporte.toString()),
    });
    const partes: [string | null, Dinheiro][] = [
      [v.contaPassagem, c.passagem],
      [v.contaDiaria, c.diaria],
      [v.contaTransporte, c.transporte],
    ];
    for (const [conta, valor] of partes) {
      if (!conta) continue;
      distribuirIgual(valor, competencias.length).forEach((p, i) => lancar(conta, competencias[i]!, p));
    }
  }
  for (const b of bens) lancar(b.conta, competenciaParaTexto(b.data), totalDoBem({ quantidade: b.quantidade, valorUnitario: Dinheiro.de(b.valorUnitario.toString()) }));
  for (const c of celulas) lancar(c.conta, competenciaParaTexto(c.competencia), Dinheiro.de(c.valor.toString()));
  return {
    porMes,
    porContaMes,
    porContaAno,
    total: Dinheiro.somarTodos([...porMes.values()]),
    avisos: [...avisos],
    semPessoal: !comPessoal && homologado,
    pessoalNaoHomologado: empregados.length > 0 && !homologado,
    viagensNaoValidadas: viagens.length < todasViagens.length,
    viagensDistribuidas: viagens.length > 0,
  };
}

export type PropostaParaCronograma = { id: string; numero: string; objeto: string; tipo: string };

/** Sem proposta escolhida: as propostas do usuário (RLS), para escolher. */
export async function propostasParaCronograma(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly PropostaParaCronograma[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const ps = await emUnidade(ctx, (tx) => tx.propostaTp.findMany({ where: { excluidaEm: null }, include: { unidade: { select: { codigo: true } } } }), { cliente: deps.cliente });
  return ps
    .map((p) => ({ id: p.id, numero: p.unidade.codigo, objeto: p.objeto, tipo: ROTULO_TIPO_PROPOSTA[p.tipo as TipoProposta] }))
    .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

/** UC04.01: o cronograma da última versão da proposta, só leitura; nulo se o usuário não a vê. */
export async function obterCronograma(
  ctx: ContextoRequisicao,
  propostaId: string,
  filtros: FiltrosCronograma = {},
  depsParciais: Partial<DepsOrc> = {},
): Promise<CronogramaTela | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!uuid.safeParse(propostaId).success) return null;
  const arvore = await deps.estruturaCompleta.listarArvoreContas(deps.cliente);
  const descricoes = new Map<string, string>();
  const visitar = (nos: typeof arvore) => nos.forEach((n) => (descricoes.set(n.classificacao, n.descricao), visitar(n.filhos)));
  visitar(arvore);
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({
        where: { id: propostaId, excluidaEm: null },
        include: { unidade: { select: { codigo: true } }, versoes: { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } },
      });
      const v = p?.versoes[0];
      if (!p || !v) return null;
      const metasDaVersao = await tx.metaProposta.findMany({ where: { versaoPropostaId: v.id }, select: { id: true, numero: true, nome: true } });
      const metas = metasDaVersao.map((m) => ({ id: m.id, rotulo: `${m.numero} – ${m.nome}` })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true }));
      const meta = metas.find((m) => m.id === filtros.meta);
      const competencias = competenciasDaVigencia(p.inicio, p.fim);
      const comPessoal = vePessoal(ctx);
      const s = await seriesDaVersao(tx, deps, v.id, comPessoal, competencias, meta?.id);
      const valorGlobal = (await totaisDaVersao(tx, deps, v.id, comPessoal)).total;
      const anos = [...new Set(competencias.map((c) => c.slice(0, 4)))];
      const porConta = [...s.porContaAno.entries()]
        .map(([conta, m]) => ({
          conta,
          descricao: descricoes.get(conta) ?? M.VIAGEM_CONTA_FORA_DO_PLANO,
          anos: Object.fromEntries(m),
          total: Dinheiro.somarTodos([...m.values()]),
        }))
        .sort((a, b) => a.conta.localeCompare(b.conta, 'pt-BR', { numeric: true }));
      return {
        propostaId: p.id,
        numero: p.unidade.codigo,
        objeto: p.objeto,
        tipo: p.tipo as TipoProposta,
        versaoNumero: v.numero,
        situacao: v.situacao as SituacaoProposta,
        meta: meta?.rotulo ?? 'Todos',
        metas,
        linhas: montarCronograma(competencias, s.porMes, valorGlobal),
        anos,
        porConta,
        total: s.total,
        valorGlobal,
        avisos: s.avisos,
        semPessoal: s.semPessoal,
        pessoalNaoHomologado: s.pessoalNaoHomologado,
        viagensNaoValidadas: s.viagensNaoValidadas,
        viagensDistribuidas: s.viagensDistribuidas,
      };
    },
    { cliente: deps.cliente },
  );
}
