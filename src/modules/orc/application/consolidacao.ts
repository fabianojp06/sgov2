import type { NoCentroCusto, NoConta } from '@/modules/cad/servidor';
import { ErroPermissao, exigir, type ContextoRequisicao } from '@/shared/authz';
import { totalizarSerie, type NoArvore } from '@/shared/totalizer';
import { Dinheiro, ErroDominio, Percentual } from '@/shared/kernel';
import { editavel, ROTULO_SITUACAO, type SituacaoExercicio } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import type { Prioridade } from '../domain/pacote';
import { calcularPainel, type Painel } from '../domain/resultado';
import { resolverDeps, type DepsOrc, type FaixaSemaforo } from './deps';
import { resolverEscopo, type Escopo } from './escopo';
import { contarCaracteres } from '../domain/texto';

// Visão por centro de custo (US-058; plano do P6, Task 6; RN_TOT_01): árvore de CC com pessoal +
// encargos, base zero, total e % do escopo; detalhe com a série mês a mês e as linhas CC × conta
// com a origem. Sintéticos somados pelo TotalizerService. Com CC de escopo (C25, R8), só a
// subárvore do gestor; CC fora dela é negado (404 na página, negação auditada).

const ZERO12 = (): Dinheiro[] => Array.from({ length: 12 }, () => Dinheiro.zero());
const somarSeries = (a: readonly Dinheiro[], b: readonly Dinheiro[]) => a.map((x, i) => x.somar(b[i]!));
const somaAno = (xs: readonly Dinheiro[]) => Dinheiro.somarTodos(xs);

export type NoVisao = {
  cc: string;
  codigoReduzido: string;
  descricao: string;
  tipo: 'SINTETICO' | 'ANALITICO';
  inativo: boolean;
  pessoal: Dinheiro;
  baseZero: Dinheiro;
  total: Dinheiro;
  percentualDoEscopo: Percentual | null;
  filhos: readonly NoVisao[];
};
export type LinhaDetalhe = { conta: string; descricaoConta: string; origem: 'PESSOAL' | 'BASE_ZERO'; meses: readonly Dinheiro[]; total: Dinheiro };
export type DetalheCc = {
  cc: string;
  codigoReduzido: string;
  descricao: string;
  serie: { pessoal: readonly Dinheiro[]; baseZero: readonly Dinheiro[]; total: readonly Dinheiro[] };
  linhas: readonly LinhaDetalhe[];
};
export type Indicadores = {
  orcamentoAno: Dinheiro;
  pessoal: Dinheiro;
  percentualPessoal: Percentual | null;
  pacotes: number;
  empregadosDezembro: number;
  porPrioridade: Readonly<Record<Prioridade, Dinheiro>>;
};
export type ExercicioVisao = {
  id: string;
  ano: number;
  situacao: SituacaoExercicio;
  rotuloSituacao: string;
  editavel: boolean;
  versao: number;
  premissasDesatualizadas: boolean;
};
export type PainelVisao = Painel & { semaforo: FaixaSemaforo | null; justificativaTeto: string | null };
export type VisaoExercicio = {
  exercicio: ExercicioVisao;
  // Teto, semáforo e resultado: só para quem vê a Adm. Central inteira (R8); null com escopo.
  painel: PainelVisao | null;
  escopo: Escopo;
  arvore: readonly NoVisao[];
  indicadores: Indicadores;
  detalhe: DetalheCc | null;
  avisos: readonly string[];
};

type NoPlano = { cc: string; paiId: string | null; codigoReduzido: string; descricao: string; tipo: 'SINTETICO' | 'ANALITICO'; inativo: boolean; filhos: string[] };

function achatar(nos: readonly NoCentroCusto[], paiId: string | null, inativoAcima: boolean, saida: Map<string, NoPlano>): void {
  for (const n of nos) {
    const inativo = inativoAcima || !n.ativo;
    saida.set(n.classificacao, { cc: n.classificacao, paiId, codigoReduzido: n.codigoReduzido, descricao: n.descricao, tipo: n.tipo, inativo, filhos: n.filhos.map((f) => f.classificacao) });
    achatar(n.filhos, n.classificacao, inativo, saida);
  }
}

function descricoesContas(nos: readonly NoConta[], saida = new Map<string, string>()): Map<string, string> {
  for (const n of nos) {
    saida.set(n.classificacao, n.descricao);
    descricoesContas(n.filhos, saida);
  }
  return saida;
}

function ancestraisAteRaiz(plano: Map<string, NoPlano>, ccs: ReadonlySet<string>, raiz: string): Set<string> {
  const ids = new Set<string>();
  for (const cc of ccs) {
    let atual: string | null = cc;
    while (atual !== null && !ids.has(atual)) {
      ids.add(atual);
      if (atual === raiz) break;
      atual = plano.get(atual)?.paiId ?? null;
    }
  }
  return ids;
}

function subarvore(plano: Map<string, NoPlano>, raiz: string): Set<string> {
  const ids = new Set<string>();
  const visitar = (id: string) => {
    const n = plano.get(id);
    if (!n) return;
    ids.add(id);
    n.filhos.forEach(visitar);
  };
  visitar(raiz);
  return ids;
}

// orc.orcamento:consultar. Sem exercício cadastrado, null. ano nulo: o mais recente.
export async function obterVisaoExercicio(
  ctx: ContextoRequisicao,
  ano: number | null,
  ccDetalhe: string | null,
  depsParciais: Partial<DepsOrc> = {},
): Promise<VisaoExercicio | null> {
  exigir(ctx, 'orc.orcamento', 'consultar');
  const deps = resolverDeps(depsParciais);
  const c = deps.cliente;
  const exercicios = await c.orcamentoExercicio.findMany({ orderBy: { ano: 'desc' } });
  const ex = exercicios.find((e) => e.ano === ano) ?? exercicios[0];
  if (!ex) return null;

  const [indice, arvoreCc, arvoreContas] = await Promise.all([
    deps.estrutura.carregarIndiceEstrutura(c),
    deps.estrutura.listarArvoreCentrosCusto(c, { incluirInativos: true }),
    deps.estrutura.listarArvoreContas(c, { incluirInativos: true }),
  ]);
  const escopo = await resolverEscopo(c, ctx, indice, deps);
  const plano = new Map<string, NoPlano>();
  achatar(arvoreCc, null, false, plano);
  const contas = descricoesContas(arvoreContas);

  const todas = await c.linhaOrcada.findMany({
    where: { exercicioId: ex.id, ...(escopo.tipo === 'TOTAL' ? {} : { cc: { in: [...escopo.ccs] } }) },
    include: { pacote: { select: { prioridade: true } } },
  });
  // CC usado no orçamento que nem a árvore com inativos conhece: nó próprio na raiz (o totalizador
  // não aceita valor em nó ausente), marcado como fora da estrutura.
  for (const l of todas) {
    if (!plano.has(l.cc)) plano.set(l.cc, { cc: l.cc, paiId: null, codigoReduzido: '', descricao: MENSAGENS_ORC.CC_DESCONHECIDO, tipo: 'ANALITICO', inativo: true, filhos: [] });
  }
  // Escopo (R8, R16): com CC de escopo, só os CCs analíticos ATIVOS que o índice do C1 põe sob a
  // raiz, mais os ancestrais deles até a raiz (para a árvore). Raiz inexistente ou inativa: o índice
  // devolve vazio e nada aparece. Linha em CC inativo ou fora da estrutura só a visão total mostra.
  const visiveis = escopo.tipo === 'TOTAL' ? new Set(plano.keys()) : ancestraisAteRaiz(plano, escopo.ccs, escopo.raiz);
  const noEscopo = (cc: string) => (escopo.tipo === 'TOTAL' ? true : escopo.ccs.has(cc));
  const linhas = todas.filter((l) => noEscopo(l.cc));

  const serie = (l: (typeof todas)[number]) => l.meses.map((m) => Dinheiro.de(m.toString()));
  const porCc = { pessoal: new Map<string, Dinheiro[]>(), baseZero: new Map<string, Dinheiro[]>() };
  for (const l of linhas) {
    const mapa = l.origem === 'PESSOAL' ? porCc.pessoal : porCc.baseZero;
    mapa.set(l.cc, somarSeries(mapa.get(l.cc) ?? ZERO12(), serie(l)));
  }

  const nosArvore: NoArvore[] = [...plano.values()]
    .filter((n) => visiveis.has(n.cc))
    .map((n) => ({ id: n.cc, paiId: n.paiId !== null && visiveis.has(n.paiId) ? n.paiId : null, tipo: n.tipo === 'SINTETICO' ? 'SINTETICA' : 'ANALITICA' }));
  const sPessoal = totalizarSerie(nosArvore, porCc.pessoal);
  const sBase = totalizarSerie(nosArvore, porCc.baseZero);
  const totalEscopo = somaAno(sPessoal.total).somar(somaAno(sBase.total));

  const montar = (id: string): NoVisao => {
    const n = plano.get(id)!;
    const pessoal = somaAno(sPessoal.valor(id));
    const baseZero = somaAno(sBase.valor(id));
    const total = pessoal.somar(baseZero);
    return {
      cc: id,
      codigoReduzido: n.codigoReduzido,
      descricao: n.descricao,
      tipo: n.tipo,
      inativo: n.inativo,
      pessoal,
      baseZero,
      total,
      percentualDoEscopo: Percentual.razao(total, totalEscopo),
      filhos: n.filhos.filter((f) => visiveis.has(f)).map(montar),
    };
  };
  const arvore = nosArvore.filter((n) => n.paiId === null).map((n) => montar(n.id));

  let detalhe: DetalheCc | null = null;
  if (ccDetalhe !== null) {
    if (!visiveis.has(ccDetalhe)) {
      if (plano.has(ccDetalhe)) throw new ErroPermissao('orc.orcamento', 'consultar'); // fora do escopo
      throw new ErroDominio('orc.cc_inexistente', 'Centro de custo não encontrado.');
    }
    const sob = subarvore(plano, ccDetalhe);
    const agrupadas = new Map<string, LinhaDetalhe>();
    for (const l of linhas.filter((x) => sob.has(x.cc))) {
      const chave = `${l.origem}|${l.conta}`;
      const atual = agrupadas.get(chave);
      const meses = atual ? somarSeries(atual.meses, serie(l)) : serie(l);
      agrupadas.set(chave, { conta: l.conta, descricaoConta: contas.get(l.conta) ?? '', origem: l.origem as LinhaDetalhe['origem'], meses, total: somaAno(meses) });
    }
    const pessoal = sPessoal.valor(ccDetalhe);
    const baseZero = sBase.valor(ccDetalhe);
    detalhe = {
      cc: ccDetalhe,
      codigoReduzido: plano.get(ccDetalhe)!.codigoReduzido,
      descricao: plano.get(ccDetalhe)!.descricao,
      serie: { pessoal, baseZero, total: somarSeries(pessoal, baseZero) },
      linhas: [...agrupadas.values()].sort((a, b) => a.origem.localeCompare(b.origem) || a.conta.localeCompare(b.conta)),
    };
  }

  // Indicadores do escopo (§6.6).
  const filtroCc = escopo.tipo === 'TOTAL' ? {} : { cc: { in: [...escopo.ccs] } };
  const [pacotes, dezembro] = await Promise.all([
    c.pacoteBaseZero.count({ where: { exercicioId: ex.id, ...filtroCc } }),
    c.posicaoOrcada.aggregate({ where: { exercicioId: ex.id, mesSaida: 12, ...filtroCc }, _sum: { quantidade: true } }),
  ]);
  const pessoalAno = somaAno(sPessoal.total);
  const porPrioridade: Record<Prioridade, Dinheiro> = { ESSENCIAL: Dinheiro.zero(), IMPORTANTE: Dinheiro.zero(), DESEJAVEL: Dinheiro.zero() };
  for (const l of linhas) {
    const p = l.pacote?.prioridade as Prioridade | undefined;
    if (p) porPrioridade[p] = porPrioridade[p].somar(Dinheiro.de(l.total.toString()));
  }

  // Premissas: avisos do C2 e versão do último cálculo (R9).
  const avisos: string[] = [];
  let premissasDesatualizadas = false;
  try {
    const premissas = await deps.custoPessoal.obterPremissasExercicio(c, ex.ano);
    if (!premissas) avisos.push(MENSAGENS_ORC.PREMISSAS_INEXISTENTES);
    else {
      premissasDesatualizadas = premissas.versao !== ex.versaoPremissas;
      if (premissasDesatualizadas) avisos.push(MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS);
      avisos.push(...premissas.avisos);
    }
  } catch (erro) {
    if (!(erro instanceof ErroDominio && erro.codigo === 'cad.custo_pessoal_indisponivel')) throw erro;
    avisos.push(MENSAGENS_ORC.PREMISSAS_INDISPONIVEIS);
  }

  // Painel (US-059): receitas e despesas da Adm. Central inteira, só sem escopo.
  let painel: PainelVisao | null = null;
  if (escopo.tipo === 'TOTAL') {
    const receitas = await c.receitaRateio.findMany({ where: { exercicioId: ex.id }, select: { situacao: true, meses: true } });
    const base = calcularPainel(
      somarSeries(sPessoal.total, sBase.total),
      receitas.map((r) => ({ situacao: r.situacao as 'CONFIRMADO' | 'PREVISTO', meses: r.meses.map((m) => Dinheiro.de(m.toString())) })),
      ex.tetoManual === null ? null : Dinheiro.de(ex.tetoManual.toString()),
    );
    let semaforo: FaixaSemaforo | null = null;
    if (!deps.semaforo) avisos.push(MENSAGENS_ORC.SEMAFORO_INDISPONIVEL);
    else if (!ctx.permissoes.has('cad.parametros:consultar')) avisos.push(MENSAGENS_ORC.SEMAFORO_SEM_PERMISSAO);
    else {
      const faixas = await deps.semaforo.faixas(ctx, ex.ano);
      if (faixas) semaforo = deps.semaforo.classificar(base.uso, faixas);
      else avisos.push(MENSAGENS_ORC.SEMAFORO_INDISPONIVEL);
    }
    // D-P6-2 vale também depois: receita reduzida pode deixar o teto manual acima dela sem justificativa.
    if (base.tetoManual && base.tetoManual.comparar(base.tetoPadrao) > 0 && contarCaracteres((ex.tetoJustificativa ?? '').trim()) < 15) {
      avisos.push(MENSAGENS_ORC.TETO_SEM_JUSTIFICATIVA);
    }
    painel = { ...base, semaforo, justificativaTeto: ex.tetoJustificativa };
  }

  const situacao = ex.situacao as SituacaoExercicio;
  return {
    exercicio: { id: ex.id, ano: ex.ano, situacao, rotuloSituacao: ROTULO_SITUACAO[situacao], editavel: editavel(situacao), versao: ex.versao, premissasDesatualizadas },
    escopo,
    painel,
    arvore,
    indicadores: {
      orcamentoAno: totalEscopo,
      pessoal: pessoalAno,
      percentualPessoal: Percentual.razao(pessoalAno, totalEscopo),
      pacotes,
      empregadosDezembro: dezembro._sum.quantidade ?? 0,
      porPrioridade,
    },
    detalhe,
    avisos,
  };
}
