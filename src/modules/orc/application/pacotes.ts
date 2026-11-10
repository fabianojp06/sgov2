import { z } from 'zod';
import { QUANTIDADE_MAXIMA, type IndiceEstruturaFinanceira, type NoCentroCusto, type NoConta, type PremissasExercicio } from '@/modules/cad/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, Dinheiro, ErroDominio, exigirUmaLinha, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { editavel, ROTULO_SITUACAO, type SituacaoExercicio } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { calcularPacote, type Prioridade } from '../domain/pacote';
import { COLUNAS_PACOTES, validarLinhaPacote, type DadosPacoteValidado } from '../domain/planilha';
import { valorDaTela } from '../domain/valor-tela';
import { contextoAuditoria, ErroRecalculo, errosNaoEditavel, recalcularExercicio, travarExercicio, type ExercicioTravado } from './calculo-linhas';
import { contasVetadasEmPacote } from './contas-vetadas';
import { resolverDeps, type DepsOrc } from './deps';
import { resolverEscopo, type Escopo } from './escopo';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';

// Pacotes base zero pela tela (US-057; plano do P11, Task 1). O Gestor de Diretoria lança só nos
// CCs da subárvore do escopo (C25, R8, conferido aqui, inclusive no CC do pacote existente); a GFIN,
// em qualquer CC. Cada operação recalcula só as linhas do pacote (D-P11-2); com as premissas
// mudadas desde o último cálculo, a GFIN recalcula o exercício inteiro e o Gestor é recusado.
// Regras e mensagens [PROVISÓRIAS] (GAP-ORC-003, GAP-ORC-004).

const FUNCIONALIDADE = 'orc.pacotes';

// Campo do formulário → coluna da aba Pacotes base zero (a validação fica num lugar só).
const CAMPOS = ['cc', 'conta', 'justificativa', 'prioridade', 'quantidade', 'valorUnitario', 'corrigirIpca', 'distribuicao', 'mesOcorrencia'] as const;
const COLUNA: Readonly<Record<string, string>> = Object.fromEntries(CAMPOS.map((c, i) => [c, COLUNAS_PACOTES[i]!]));
const CAMPO: Readonly<Record<string, string>> = Object.fromEntries(CAMPOS.map((c, i) => [COLUNAS_PACOTES[i]!, c]));

export type Distribuicao = 'MENSAL' | 'PONTUAL';
export type OrigemPacote = 'IMPORTACAO' | 'COPIA' | 'TELA';
export type PacoteTela = {
  id: string;
  cc: string;
  conta: string;
  justificativa: string;
  prioridade: Prioridade;
  quantidade: number;
  valorUnitario: Dinheiro;
  corrigirIpca: boolean;
  distribuicao: Distribuicao;
  mesOcorrencia: number | null;
  origem: OrigemPacote;
  versao: number;
  valorAnual: Dinheiro;
  meses: readonly Dinheiro[];
};
export type ListaPacotes = { pacotes: readonly PacoteTela[]; editavel: boolean };
export type OpcaoEstrutura = { classificacao: string; descricao: string };
export type OpcoesPacote = {
  ccs: readonly OpcaoEstrutura[];
  contas: readonly OpcaoEstrutura[];
  // IPCA do exercício em pontos percentuais, como texto ("4.5000"); null sem premissas.
  ipca: string | null;
  // QUANTIDADE_MAXIMA do C2, para a prévia no cliente (o cliente não importa o cad).
  quantidadeMaxima: number;
  situacao: SituacaoExercicio;
  rotuloSituacao: string;
  editavel: boolean;
};
export type ResultadoPacote = { id: string; ano: number; cc: string; mensagem: string };

const din = (v: { toString(): string }) => Dinheiro.de(v.toString());
const noEscopo = (escopo: Escopo, cc: string) => escopo.tipo === 'TOTAL' || escopo.ccs.has(cc);
const conflito = (): Resultado<never> => falha([{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }]);
const inexistente = () => new ErroDominio('orc.pacote_inexistente', MENSAGENS_ORC.PACOTE_INEXISTENTE);

async function exercicio(deps: DepsOrc, id: string) {
  const e = z.uuid().safeParse(id).success ? await deps.cliente.orcamentoExercicio.findUnique({ where: { id } }) : null;
  if (!e) throw new ErroDominio('orc.exercicio_inexistente', 'Exercício não encontrado.');
  return { ...e, situacao: e.situacao as SituacaoExercicio };
}

export async function listarPacotes(ctx: ContextoRequisicao, exercicioId: string, depsParciais: Partial<DepsOrc> = {}): Promise<ListaPacotes> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const deps = resolverDeps(depsParciais);
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  const escopo = await resolverEscopo(deps.cliente, ctx, indice, deps);
  const e = await exercicio(deps, exercicioId);
  const linhas = await deps.cliente.pacoteBaseZero.findMany({
    where: { exercicioId: e.id, ...(escopo.tipo === 'TOTAL' ? {} : { cc: { in: [...escopo.ccs] } }) },
    include: { linhas: { select: { meses: true, total: true } } },
    orderBy: [{ cc: 'asc' }, { conta: 'asc' }, { id: 'asc' }],
  });
  const pacotes = linhas.map((k): PacoteTela => {
    const linha = k.linhas[0];
    return {
      id: k.id,
      cc: k.cc,
      conta: k.conta,
      justificativa: k.justificativa,
      prioridade: k.prioridade as Prioridade,
      quantidade: k.quantidade,
      valorUnitario: din(k.valorUnitario),
      corrigirIpca: k.corrigirIpca,
      distribuicao: k.distribuicao as Distribuicao,
      mesOcorrencia: k.mesOcorrencia,
      origem: k.origem as OrigemPacote,
      versao: k.versao,
      valorAnual: linha ? din(linha.total) : Dinheiro.zero(),
      meses: linha ? linha.meses.map(din) : Array.from({ length: 12 }, () => Dinheiro.zero()),
    };
  });
  return { pacotes, editavel: editavel(e.situacao) };
}

// Analíticos ativos da árvore, em ordem (a árvore já vem ordenada pela classificação).
function analiticos<T extends { classificacao: string; descricao: string; filhos: readonly T[] }>(nos: readonly T[], ehAnalitico: (n: T) => boolean): OpcaoEstrutura[] {
  return nos.flatMap((n) => [...(ehAnalitico(n) ? [{ classificacao: n.classificacao, descricao: n.descricao }] : []), ...analiticos(n.filhos, ehAnalitico)]);
}

// Opções do formulário: CCs analíticos do escopo, contas permitidas (D-P11-3) e o IPCA do exercício.
export async function opcoesPacote(ctx: ContextoRequisicao, exercicioId: string, depsParciais: Partial<DepsOrc> = {}): Promise<OpcoesPacote> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const deps = resolverDeps(depsParciais);
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  const escopo = await resolverEscopo(deps.cliente, ctx, indice, deps);
  const e = await exercicio(deps, exercicioId);
  const [arvoreCcs, arvoreContas, premissas] = await Promise.all([
    deps.estrutura.listarArvoreCentrosCusto(deps.cliente),
    deps.estrutura.listarArvoreContas(deps.cliente),
    deps.custoPessoal.obterPremissasExercicio(deps.cliente, e.ano),
  ]);
  const vetadas = contasVetadasEmPacote(indice, premissas);
  return {
    ccs: analiticos<NoCentroCusto>(arvoreCcs, (n) => n.tipo === 'ANALITICO' && indice.centroCustoAnalitico(n.classificacao)).filter((c) => noEscopo(escopo, c.classificacao)),
    contas: analiticos<NoConta>(arvoreContas, (n) => n.tipo === 'ANALITICA' && indice.contaAnaliticaAtiva(n.classificacao)).filter((c) => !vetadas.has(c.classificacao)),
    ipca: premissas ? premissas.ipca.paraString() : null,
    quantidadeMaxima: QUANTIDADE_MAXIMA,
    situacao: e.situacao,
    rotuloSituacao: ROTULO_SITUACAO[e.situacao],
    editavel: editavel(e.situacao),
  };
}

const texto = z.string().optional();
const DADOS = Object.fromEntries(CAMPOS.map((c) => [c, texto])) as Record<(typeof CAMPOS)[number], typeof texto>;
const versao = z.coerce.number().int().min(0);
const entradaInclusao = z.object({ ...DADOS, exercicioId: z.string() }).strict();
const entradaAlteracao = z.object({ ...DADOS, id: z.string(), versao }).strict();
const entradaExclusao = z.object({ id: z.string(), versao }).strict();
const MENSAGEM_ENTRADA = 'Dados do pacote inválidos. Recarregue a tela.';
const errosDaEntrada = (): Resultado<never> => falha([{ campo: '_', mensagem: MENSAGEM_ENTRADA }]);

// Campos do formulário → validação da aba Pacotes base zero (valor no formato brasileiro da tela).
function validarDados(dados: Readonly<Record<string, unknown>>, indice: IndiceEstruturaFinanceira, escopo: Escopo, vetadas: ReadonlySet<string>): Resultado<DadosPacoteValidado> {
  const celulas = Object.fromEntries(
    CAMPOS.map((c) => {
      const v = typeof dados[c] === 'string' ? (dados[c] as string) : null;
      return [COLUNA[c]!, c === 'valorUnitario' ? valorDaTela(v ?? '') : v];
    }),
  );
  const r = validarLinhaPacote(
    celulas,
    {
      ccAnalitico: (cc) => indice.centroCustoAnalitico(cc),
      contaPermitida: (conta) => indice.contaAnaliticaAtiva(conta) && !vetadas.has(conta),
      noEscopo: (cc) => noEscopo(escopo, cc),
    },
    { quantidadeMaxima: QUANTIDADE_MAXIMA },
  );
  if (!r.ok) return falha(r.erros.map((e): ErroCampo => ({ campo: CAMPO[e.campo] ?? '_', mensagem: e.mensagem })));
  return r;
}

type Retratavel = Omit<DadosPacoteValidado, 'valorUnitario'> & { valorUnitario: Dinheiro | { toString(): string } };
// D-P11-4: o pacote inteiro no Histórico (pacote não tem dado sigiloso).
const retrato = (k: Retratavel) => ({
  cc: k.cc,
  conta: k.conta,
  justificativa: k.justificativa,
  prioridade: k.prioridade,
  quantidade: k.quantidade,
  valorUnitario: (k.valorUnitario instanceof Dinheiro ? k.valorUnitario : din(k.valorUnitario)).paraString(),
  corrigirIpca: k.corrigirIpca,
  distribuicao: k.distribuicao,
  mesOcorrencia: k.mesOcorrencia,
});

// Abre a escrita: permissão, governança (ORIGEM BLINDADA no payload bruto) e o parse estrito.
async function abrir<T>(
  ctx: ContextoRequisicao,
  acao: 'incluir' | 'alterar' | 'excluir',
  bruto: unknown,
  schema: z.ZodType<T>,
  blindados: readonly string[],
  deps: DepsOrc,
): Promise<T | null> {
  exigir(ctx, FUNCIONALIDADE, acao);
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, blindados, deps);
  const e = schema.safeParse(bruto);
  return e.success ? e.data : null;
}
// Na inclusão o exercício vem do formulário; na alteração e na exclusão, nunca (é o do pacote).
const BLINDADOS_INCLUSAO = CAMPOS_ORIGEM_BLINDADA.pacote.filter((c) => c !== 'exercicioId');

async function indiceEEscopo(ctx: ContextoRequisicao, deps: DepsOrc) {
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  return { indice, escopo: await resolverEscopo(deps.cliente, ctx, indice, deps) };
}

type Recalculo = { tipo: 'PACOTE'; premissas: PremissasExercicio } | { tipo: 'EXERCICIO' };

// Dentro da transação, depois da trava do exercício: as premissas são lidas uma vez, para as contas
// vetadas (D-P11-3), a validação e a decisão do recálculo (D-P11-2, por escopo.tipo). Premissas
// iguais às do último cálculo → só as linhas do pacote. Mudadas → com escopo TOTAL, o exercício
// inteiro; com subárvore, recusado (salvo no exercício nunca calculado, como na importação).
async function prepararGravacao(
  tx: TxCliente,
  e: ExercicioTravado,
  dados: Readonly<Record<string, unknown>>,
  indice: IndiceEstruturaFinanceira,
  escopo: Escopo,
  deps: DepsOrc,
): Promise<Resultado<{ v: DadosPacoteValidado; plano: Recalculo }>> {
  const premissas = await deps.custoPessoal.obterPremissasExercicio(tx, e.ano);
  const r = validarDados(dados, indice, escopo, contasVetadasEmPacote(indice, premissas));
  if (!r.ok) return r;
  if (!premissas) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.PREMISSAS_INEXISTENTES }]);
  if (e.versaoPremissas === premissas.versao) return ok({ v: r.valor, plano: { tipo: 'PACOTE', premissas } });
  if (escopo.tipo !== 'TOTAL' && e.versaoPremissas !== null) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS_PACOTE }]);
  return ok({ v: r.valor, plano: { tipo: 'EXERCICIO' } });
}

// Recalcula e devolve a versão das premissas antes e depois quando refez o exercício inteiro (para o
// Histórico, como a importação); só o pacote, null. Sempre sobe a versão do exercício.
async function recalcularPacote(tx: TxCliente, e: ExercicioTravado, pacoteId: string, plano: Recalculo, escopo: Escopo, deps: DepsOrc): Promise<{ antes: number | null; depois: number } | null> {
  if (plano.tipo === 'EXERCICIO') {
    const r = await recalcularExercicio(tx, e.id, deps);
    // As premissas são relidas no recálculo: uma versão nova gravada entre as duas leituras desfaz.
    if (escopo.tipo !== 'TOTAL' && e.versaoPremissas !== null && r.versaoPremissas !== e.versaoPremissas) {
      throw new ErroRecalculo([{ campo: '_', mensagem: MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS_PACOTE }]);
    }
    return { antes: e.versaoPremissas, depois: r.versaoPremissas };
  }
  const k = await tx.pacoteBaseZero.findUniqueOrThrow({ where: { id: pacoteId } });
  const { valorAnual, meses } = calcularPacote(
    { quantidade: k.quantidade, valorUnitario: din(k.valorUnitario), corrigirIpca: k.corrigirIpca, distribuicao: k.distribuicao as Distribuicao, mesOcorrencia: k.mesOcorrencia },
    plano.premissas.ipca,
  );
  await tx.linhaOrcada.deleteMany({ where: { pacoteId } });
  await tx.linhaOrcada.create({
    data: { exercicioId: e.id, cc: k.cc, conta: k.conta, origem: 'BASE_ZERO', pacoteId, meses: meses.map((m) => m.paraString()), total: valorAnual.paraString() },
  });
  await tocarExercicio(tx, e.id, deps);
  return null;
}

const tocarExercicio = (tx: TxCliente, id: string, deps: DepsOrc) =>
  tx.orcamentoExercicio.update({ where: { id }, data: { versao: { increment: 1 }, atualizadoEm: deps.agora() } });

// Erros do recálculo do exercício inteiro: com escopo TOTAL, o aviso de que o erro é de outro
// lançamento e os erros como vieram; com subárvore, os de CC fora dela viram um aviso só.
function errosDoRecalculo(erro: ErroRecalculo, escopo: Escopo): ErroCampo[] {
  if (escopo.tipo === 'TOTAL') return [{ campo: '_', mensagem: MENSAGENS_ORC.RECALCULO_BARROU_PACOTE }, ...erro.erros];
  const dentro = erro.erros.filter((_, i) => erro.ccs[i] === null || escopo.ccs.has(erro.ccs[i]!));
  return dentro.length === erro.erros.length ? dentro : [...dentro, { campo: '_', mensagem: MENSAGENS_ORC.RECALCULO_FORA_DO_ESCOPO }];
}

async function emTransacao<T>(deps: DepsOrc, escopo: Escopo, corpo: (tx: TxCliente) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await deps.cliente.$transaction(corpo);
  } catch (erro) {
    if (erro instanceof ErroRecalculo) return falha(errosDoRecalculo(erro, escopo));
    if (erro instanceof ConflitoConcorrencia) return conflito();
    throw erro;
  }
}

const dadosGravados = (v: DadosPacoteValidado) => ({
  cc: v.cc,
  conta: v.conta,
  justificativa: v.justificativa,
  prioridade: v.prioridade,
  quantidade: v.quantidade,
  valorUnitario: v.valorUnitario.paraString(),
  corrigirIpca: v.corrigirIpca,
  distribuicao: v.distribuicao,
  mesOcorrencia: v.mesOcorrencia,
});
const comPremissas = (r: object, versao: number | null) => ({ ...r, versaoPremissas: versao });

export async function incluirPacote(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<ResultadoPacote>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'incluir', bruto, entradaInclusao, BLINDADOS_INCLUSAO, deps);
  if (!entrada) return errosDaEntrada();
  const { indice, escopo } = await indiceEEscopo(ctx, deps);
  return emTransacao(deps, escopo, async (tx) => {
    // A trava do exercício (FOR UPDATE) vem antes de qualquer escrita no orc_pacote (deadlock com os triggers).
    const e = await travarExercicio(tx, entrada.exercicioId);
    if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
    const p = await prepararGravacao(tx, e, entrada, indice, escopo, deps);
    if (!p.ok) return p;
    const { v, plano } = p.valor;
    const criado = await tx.pacoteBaseZero.create({ data: { exercicioId: e.id, ...dadosGravados(v), origem: 'TELA' } });
    const premissas = await recalcularPacote(tx, e, criado.id, plano, escopo, deps);
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'INSERCAO',
      registroId: criado.id,
      descricao: `Pacote base zero da conta ${v.conta} incluído no CC ${v.cc}, exercício ${e.ano}${premissas ? ', com o orçamento recalculado' : ''}`,
      ...(premissas ? { antes: { versaoPremissas: premissas.antes } } : {}),
      depois: premissas ? comPremissas(retrato(v), premissas.depois) : retrato(v),
    });
    return ok({ id: criado.id, ano: e.ano, cc: v.cc, mensagem: MENSAGENS_ORC.RECALCULADO });
  });
}

// Pacote existente, travado pelo exercício dele: lê, trava o exercício e relê dentro da trava. Fora
// do escopo, a mesma resposta do inexistente (B3: não revela que o pacote existe).
async function travarPacote(tx: TxCliente, id: string, escopo: Escopo) {
  if (!z.uuid().safeParse(id).success) throw inexistente();
  const antes = await tx.pacoteBaseZero.findUnique({ where: { id }, select: { exercicioId: true } });
  if (!antes) throw inexistente();
  const e = await travarExercicio(tx, antes.exercicioId);
  const k = await tx.pacoteBaseZero.findUnique({ where: { id } });
  if (!k || k.exercicioId !== e.id || !noEscopo(escopo, k.cc)) throw inexistente();
  return { e, k: { ...k, prioridade: k.prioridade as Prioridade, distribuicao: k.distribuicao as Distribuicao } };
}

export async function alterarPacote(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<ResultadoPacote>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'alterar', bruto, entradaAlteracao, CAMPOS_ORIGEM_BLINDADA.pacote, deps);
  if (!entrada) return errosDaEntrada();
  const { indice, escopo } = await indiceEEscopo(ctx, deps);
  return emTransacao(deps, escopo, async (tx) => {
    const { e, k } = await travarPacote(tx, entrada.id, escopo);
    if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
    if (k.versao !== entrada.versao) return conflito();
    // Valida tudo de novo, inclusive a conta (B4: conta que virou vetada precisa ser trocada).
    const p = await prepararGravacao(tx, e, entrada, indice, escopo, deps);
    if (!p.ok) return p;
    const { v, plano } = p.valor;
    // A origem e a importação nunca mudam pela tela (D-P11-5).
    exigirUmaLinha(await tx.pacoteBaseZero.updateMany({ where: { id: k.id, versao: entrada.versao }, data: { ...dadosGravados(v), versao: { increment: 1 } } }));
    const premissas = await recalcularPacote(tx, e, k.id, plano, escopo, deps);
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: k.id,
      descricao: `Pacote base zero da conta ${v.conta} alterado no CC ${v.cc}, exercício ${e.ano}${premissas ? ', com o orçamento recalculado' : ''}`,
      antes: premissas ? comPremissas(retrato(k), premissas.antes) : retrato(k),
      depois: premissas ? comPremissas(retrato(v), premissas.depois) : retrato(v),
    });
    return ok({ id: k.id, ano: e.ano, cc: v.cc, mensagem: MENSAGENS_ORC.RECALCULADO });
  });
}

// A exclusão sempre pode (M1): não exige CC nem conta ativos, nem conta permitida, nem premissas.
export async function excluirPacote(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<ResultadoPacote>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'excluir', bruto, entradaExclusao, CAMPOS_ORIGEM_BLINDADA.pacote, deps);
  if (!entrada) return errosDaEntrada();
  const { escopo } = await indiceEEscopo(ctx, deps);
  return emTransacao(deps, escopo, async (tx) => {
    const { e, k } = await travarPacote(tx, entrada.id, escopo);
    if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
    if (k.versao !== entrada.versao) return conflito();
    // As linhas do pacote saem em cascata; nenhuma outra linha depende dele (D-P11-2).
    exigirUmaLinha(await tx.pacoteBaseZero.deleteMany({ where: { id: k.id, versao: entrada.versao } }));
    await tocarExercicio(tx, e.id, deps);
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId: k.id,
      descricao: `Pacote base zero da conta ${k.conta} excluído do CC ${k.cc}, exercício ${e.ano}`,
      antes: retrato(k),
    });
    return ok({ id: k.id, ano: e.ano, cc: k.cc, mensagem: MENSAGENS_ORC.RECALCULADO });
  });
}
