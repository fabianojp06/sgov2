import { z } from 'zod';
import { obterUsuarioParaSessao } from '@/modules/adm';
import { auditar } from '@/shared/audit';
import { exigir, type Acao, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { totalizarSerie, type NoArvore } from '@/shared/totalizer';
import type { NoCentroCusto } from '@/modules/cad/servidor';
import { Dinheiro, ErroDominio, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { ROTULO_SITUACAO, transicionar, type EventoCiclo, type SituacaoExercicio } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { calcularPainel, validarTeto } from '../domain/resultado';
import { montarSnapshot } from '../infrastructure/snapshot';
import { contextoAuditoria, travarExercicio, type ExercicioTravado } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { exigirSemEscopo } from './escopo';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';
import { contarCaracteres } from '../domain/texto';

// Envio, aprovação, rejeição e oficialização (US-061; C36; plano do P6, Task 8; R10). A GFIN
// envia (orc.aprovacao:executar); a DIREX aprova ou rejeita (orc.aprovacao:aprovar). Uma etapa só
// na trilha; a alçada configurável (UC02.28) assume depois.

const FUNCIONALIDADE = 'orc.aprovacao';
const versao = z.coerce.number().int().min(0);
const entradaCiclo = z.object({ id: z.string(), versao }).strict();
const entradaRejeicao = z.object({ id: z.string(), versao, justificativa: z.string().max(1000).optional() }).strict();
const MENSAGEM_ENTRADA = 'Dados inválidos. Recarregue a tela.';

// Erro de regra dentro da transação: desfaz tudo e vira falha fora dela (como o ErroRecalculo).
class ErroCiclo extends ErroDominio {
  constructor(readonly erros: readonly ErroCampo[]) {
    super('orc.ciclo_recusado', erros.map((e) => e.mensagem).join(' '));
  }
}
const recusar = (mensagem: string, campo = '_'): never => {
  throw new ErroCiclo([{ campo, mensagem }]);
};

// Permissão → escopo total (R15) → governança → parse estrito, nessa ordem.
async function abrir<T>(ctx: ContextoRequisicao, acao: Acao, bruto: unknown, schema: z.ZodType<T>, deps: DepsOrc): Promise<T | null> {
  exigir(ctx, FUNCIONALIDADE, acao);
  await exigirSemEscopo(deps.cliente, ctx, deps, FUNCIONALIDADE, acao);
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.exercicio, deps);
  const e = schema.safeParse(bruto);
  return e.success ? e.data : null;
}

// Pré-condições do envio, conferidas de novo na aprovação, sempre depois da trava (R10): premissas
// na versão do último cálculo (R9), ao menos uma linha, CC e conta ainda analíticos ativos (R2) e
// teto manual acima da receita confirmada atual só com justificativa (D-P6-2).
async function conferirPreCondicoes(tx: TxCliente, e: ExercicioTravado, deps: DepsOrc) {
  const premissas = await deps.custoPessoal.obterPremissasExercicio(tx, e.ano);
  if (!premissas || premissas.versao !== e.versaoPremissas) recusar(MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS);
  const linhas = await tx.linhaOrcada.findMany({ where: { exercicioId: e.id }, orderBy: [{ cc: 'asc' }, { conta: 'asc' }, { id: 'asc' }] });
  if (linhas.length === 0) recusar(MENSAGENS_ORC.EXERCICIO_VAZIO);
  const indice = await deps.estrutura.carregarIndiceEstrutura(tx);
  const invalidas = new Map<string, string>();
  for (const l of linhas) {
    if (!indice.centroCustoAnalitico(l.cc) || !indice.contaAnaliticaAtiva(l.conta)) invalidas.set(`${l.cc}|${l.conta}`, MENSAGENS_ORC.LANCAMENTO_INATIVO(l.cc, l.conta));
  }
  if (invalidas.size > 0) throw new ErroCiclo([...invalidas.values()].map((mensagem) => ({ campo: '_', mensagem })));
  const ex = await tx.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id }, select: { tetoManual: true, tetoJustificativa: true } });
  const receitas = await tx.receitaRateio.findMany({ where: { exercicioId: e.id }, orderBy: { tp: 'asc' } });
  if (ex.tetoManual !== null) {
    const confirmada = Dinheiro.somarTodos(receitas.filter((r) => r.situacao === 'CONFIRMADO').map((r) => Dinheiro.de(r.total.toString())));
    const v = validarTeto(Dinheiro.de(ex.tetoManual.toString()), ex.tetoJustificativa, confirmada);
    if (!v.ok) throw new ErroCiclo(v.erros);
  }
  return { premissas: premissas!, linhas, receitas, tetoManual: ex.tetoManual };
}

async function transitar(
  ctx: ContextoRequisicao,
  tx: TxCliente,
  e: ExercicioTravado,
  evento: EventoCiclo,
  deps: DepsOrc,
  extra: { justificativa?: string; enviadoPor?: string; oficializadoEm?: Date } = {},
): Promise<SituacaoExercicio> {
  const t = transicionar(e.situacao, evento);
  if (!t.ok) throw new ErroCiclo(t.erros);
  await tx.orcamentoExercicio.update({
    where: { id: e.id },
    data: {
      situacao: t.valor,
      versao: { increment: 1 },
      atualizadoEm: deps.agora(),
      ...(extra.enviadoPor ? { enviadoPor: extra.enviadoPor } : {}),
      ...(extra.oficializadoEm ? { oficializadoEm: extra.oficializadoEm } : {}),
    },
  });
  return t.valor;
}

async function registrarTramite(ctx: ContextoRequisicao, tx: TxCliente, e: ExercicioTravado, para: SituacaoExercicio, justificativa?: string) {
  await tx.tramiteExercicio.create({ data: { exercicioId: e.id, de: e.situacao, para, usuarioId: ctx.usuarioId, justificativa: justificativa ?? null } });
  await auditar(tx, {
    contexto: contextoAuditoria(ctx),
    funcionalidade: FUNCIONALIDADE,
    tipo: 'ALTERACAO',
    registroId: e.id,
    descricao: `Orçamento ${e.ano}: ${ROTULO_SITUACAO[e.situacao]} → ${ROTULO_SITUACAO[para]}${justificativa ? ` (rejeitado: ${justificativa})` : ''}`,
    antes: { situacao: e.situacao },
    depois: { situacao: para, ...(justificativa ? { justificativa } : {}) },
  });
}

async function executar<T>(deps: DepsOrc, f: (tx: TxCliente) => Promise<T>): Promise<Resultado<T>> {
  try {
    return ok(await deps.cliente.$transaction(f));
  } catch (erro) {
    if (erro instanceof ErroCiclo) return falha(erro.erros);
    throw erro;
  }
}

const versaoVelha = () => recusar(MENSAGENS_ORC.ALTERADO_POR_OUTRO);

export async function enviarParaAprovacao(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ano: number }>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'executar', bruto, entradaCiclo, deps);
  if (!entrada) return falha([{ campo: '_', mensagem: MENSAGEM_ENTRADA }]);
  return executar(deps, async (tx) => {
    const e = await travarExercicio(tx, entrada.id);
    if (e.versao !== entrada.versao) versaoVelha();
    if (e.situacao !== 'EM_ELABORACAO') recusar(MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(ROTULO_SITUACAO[e.situacao]));
    await conferirPreCondicoes(tx, e, deps);
    const para = await transitar(ctx, tx, e, 'ENVIAR', deps, { enviadoPor: ctx.usuarioId });
    await registrarTramite(ctx, tx, e, para);
    return { ano: e.ano };
  });
}

export async function aprovarExercicio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ano: number }>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'aprovar', bruto, entradaCiclo, deps);
  if (!entrada) return falha([{ campo: '_', mensagem: MENSAGEM_ENTRADA }]);
  return executar(deps, async (tx) => {
    const e = await travarExercicio(tx, entrada.id);
    if (e.versao !== entrada.versao) versaoVelha();
    if (e.situacao !== 'EM_APROVACAO') recusar(MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(ROTULO_SITUACAO[e.situacao]));
    // D-P6-3: quem enviou não aprova; sem remetente gravado, também não (falha fechada).
    if (!e.enviadoPor || e.enviadoPor === ctx.usuarioId) recusar(MENSAGENS_ORC.QUEM_ENVIOU_NAO_APROVA);
    const { premissas, linhas, receitas, tetoManual } = await conferirPreCondicoes(tx, e, deps);
    const oficializadoEm = deps.agora();
    const para = await transitar(ctx, tx, e, 'APROVAR', deps, { oficializadoEm });

    // R10: congela as premissas no C2 e relê na mesma transação; se uma escrita da GRH/GFIN entrou
    // entre a leitura e o congelamento, a versão muda e tudo é desfeito. O snapshot guarda as
    // premissas já congeladas.
    await deps.custoPessoal.congelarPremissasExercicio(tx, contextoAuditoria(ctx), e.ano);
    const congeladas = await deps.custoPessoal.obterPremissasExercicio(tx, e.ano);
    if (!congeladas || congeladas.versao !== premissas.versao) recusar(MENSAGENS_ORC.PREMISSAS_MUDARAM_NA_APROVACAO);

    // Snapshot sempre com a Adm. Central inteira, independente de quem aprova.
    const despesasMes = Array.from({ length: 12 }, (_, i) => Dinheiro.somarTodos(linhas.map((l) => Dinheiro.de(l.meses[i]!.toString()))));
    const painel = calcularPainel(
      despesasMes,
      receitas.map((r) => ({ situacao: r.situacao as 'CONFIRMADO' | 'PREVISTO', meses: r.meses.map((m) => Dinheiro.de(m.toString())) })),
      tetoManual === null ? null : Dinheiro.de(tetoManual.toString()),
    );
    const [posicoes, pacotes] = await Promise.all([
      tx.posicaoOrcada.findMany({ where: { exercicioId: e.id }, orderBy: { id: 'asc' } }),
      tx.pacoteBaseZero.findMany({ where: { exercicioId: e.id }, orderBy: { id: 'asc' } }),
    ]);
    const dinheiro = (v: { toString(): string }) => Dinheiro.de(v.toString());
    const { conteudo, sha256 } = montarSnapshot({
      ano: e.ano,
      oficializadoEm,
      premissas: congeladas,
      painel,
      totaisPorCc: await totaisPorCc(tx, linhas, deps),
      // Sem o salário de cada posição (decisão do PO de 03/11, D-P6-1): o snapshot é imutável e não
      // daria para cifrar depois; o custo fica nas linhas calculadas e nas premissas congeladas.
      posicoes: posicoes.map((p) => ({ id: p.id, cc: p.cc, cargo: p.cargo, quantidade: p.quantidade, mesInicio: p.mesInicio, mesSaida: p.mesSaida })),
      pacotes: pacotes.map((k) => ({ id: k.id, cc: k.cc, conta: k.conta, justificativa: k.justificativa, prioridade: k.prioridade, quantidade: k.quantidade, valorUnitario: dinheiro(k.valorUnitario), corrigirIpca: k.corrigirIpca, distribuicao: k.distribuicao, mesOcorrencia: k.mesOcorrencia })),
      receitas: receitas.map((r) => ({ tp: r.tp, situacao: r.situacao, origem: r.origem, meses: r.meses.map(dinheiro), total: dinheiro(r.total) })),
      linhas: linhas.map((l) => ({ cc: l.cc, conta: l.conta, origem: l.origem, componente: l.componente, meses: l.meses.map(dinheiro), total: dinheiro(l.total) })),
    });
    await tx.snapshotExercicio.create({ data: { exercicioId: e.id, sha256, conteudo: conteudo as object } });
    await registrarTramite(ctx, tx, e, para);
    return { ano: e.ano };
  });
}

// Totais por CC para o snapshot (§6.2: "sintéticas calculadas"): a árvore de CC do C1 com inativos,
// somada pelo TotalizerService; CC fora da estrutura vira nó próprio na raiz.
async function totaisPorCc(tx: TxCliente, linhas: readonly { cc: string; meses: readonly { toString(): string }[] }[], deps: DepsOrc) {
  const nos: NoArvore[] = [];
  const visitar = (lista: readonly NoCentroCusto[], paiId: string | null) => {
    for (const n of lista) {
      nos.push({ id: n.classificacao, paiId, tipo: n.tipo === 'SINTETICO' ? 'SINTETICA' : 'ANALITICA' });
      visitar(n.filhos, n.classificacao);
    }
  };
  visitar(await deps.estrutura.listarArvoreCentrosCusto(tx, { incluirInativos: true }), null);
  const conhecidos = new Set(nos.map((n) => n.id));
  const valores = new Map<string, Dinheiro[]>();
  for (const l of linhas) {
    if (!conhecidos.has(l.cc)) {
      nos.push({ id: l.cc, paiId: null, tipo: 'ANALITICA' });
      conhecidos.add(l.cc);
    }
    const atual = valores.get(l.cc) ?? Array.from({ length: 12 }, () => Dinheiro.zero());
    valores.set(l.cc, atual.map((v, i) => v.somar(Dinheiro.de(l.meses[i]!.toString()))));
  }
  const serie = totalizarSerie(nos, valores);
  return nos.map((n) => ({ cc: n.id, tipo: n.tipo, meses: serie.valor(n.id), total: Dinheiro.somarTodos(serie.valor(n.id)) }));
}

// Quem enviou pode rejeitar o próprio envio (devolve para Em Elaboração); D-P6-3 trata só da aprovação.
export async function rejeitarExercicio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ano: number }>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'aprovar', bruto, entradaRejeicao, deps);
  if (!entrada) return falha([{ campo: '_', mensagem: MENSAGEM_ENTRADA }]);
  const justificativa = (entrada.justificativa ?? '').trim();
  if (contarCaracteres(justificativa) < 15) return falha([{ campo: 'justificativa', mensagem: MENSAGENS_ORC.REJEICAO_CURTA }]);
  return executar(deps, async (tx) => {
    const e = await travarExercicio(tx, entrada.id);
    if (e.versao !== entrada.versao) versaoVelha();
    const para = await transitar(ctx, tx, e, 'REJEITAR', deps);
    await registrarTramite(ctx, tx, e, para, justificativa);
    return { ano: e.ano };
  });
}

export type TramiteTela = { de: string; para: string; usuario: string; justificativa: string | null; em: Date };

export async function listarTramites(ctx: ContextoRequisicao, exercicioId: string, depsParciais: Partial<DepsOrc> = {}): Promise<readonly TramiteTela[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const deps = resolverDeps(depsParciais);
  await exigirSemEscopo(deps.cliente, ctx, deps, FUNCIONALIDADE, 'consultar');
  if (!z.uuid().safeParse(exercicioId).success) return [];
  const tramites = await deps.cliente.tramiteExercicio.findMany({ where: { exercicioId }, orderBy: { em: 'asc' } });
  const nomes = new Map<string, string>();
  for (const id of new Set(tramites.map((t) => t.usuarioId))) nomes.set(id, (await obterUsuarioParaSessao(deps.cliente, id))?.nome ?? '—');
  return tramites.map((t) => ({
    de: ROTULO_SITUACAO[t.de as SituacaoExercicio],
    para: ROTULO_SITUACAO[t.para as SituacaoExercicio],
    usuario: nomes.get(t.usuarioId) ?? '—',
    justificativa: t.justificativa,
    em: t.em,
  }));
}
