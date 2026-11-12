import { z } from 'zod';
import {
  QUANTIDADE_MAXIMA,
  type CargoExercicio,
  type IndiceEstruturaFinanceira,
  type NoCentroCusto,
  type PremissasExercicio,
  type SerieMensalComponentes,
} from '@/modules/cad/servidor';
import { auditar } from '@/shared/audit';
import { ErroPermissao, exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, Dinheiro, ErroDominio, exigirUmaLinha, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { editavel, ROTULO_SITUACAO, type SituacaoExercicio } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { COLUNAS_PESSOAL, validarLinhaPosicao, type DadosPosicaoValidada } from '../domain/planilha';
import { valorDaTela } from '../domain/valor-tela';
import { contextoAuditoria, ErroRecalculo, errosNaoEditavel, recalcularExercicio, travarExercicio, type ExercicioTravado } from './calculo-linhas';
import { carregarCargos, custoDaPosicao, type CacheCargos } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';
import { resolverEscopo, type Escopo } from './escopo';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';

// Posições de pessoal pela tela (US-056; plano do P12, Task 1), no molde dos pacotes (P11). O Gestor
// de Diretoria lança só nos CCs da subárvore do escopo (C25, R8, conferido aqui, inclusive no CC da
// posição existente); a GFIN, em qualquer CC. O custo vem do motor único do cad (C33,
// deps.custoPessoal.calcularCustoPosicao), na gravação e na prévia (D-P12-6). Cada operação recalcula
// só as linhas da posição (D-P12-5); com as premissas mudadas desde o último cálculo, a GFIN recalcula
// o exercício inteiro e o Gestor é recusado. O salário e o anual só vão a quem inclui ou altera
// (D-P12-3). Regras e mensagens [PROVISÓRIAS] (GAP-ORC-004).
//
// Cargo do cadastro de C&S (plano do P15, Task 1): a posição pode apontar para um cargo (cargo_id, sem
// FK), e então o texto `cargo` guarda o nome do cadastro; sem cargo, é o texto livre (C34). O custo usa os
// benefícios e o adicional do cargo (D-P15-3). A Fonte Ativa e a faixa de mercado são dado de
// cad.salarios (R24): só vão a quem lança E tem cad.salarios:consultar (D-P15-5), com o CONSULTA.

const FUNCIONALIDADE = 'orc.posicoes';

// Campo do formulário → coluna da aba Pessoal (a validação fica num lugar só).
const CAMPOS = ['cc', 'cargo', 'quantidade', 'salarioMensal', 'mesInicio', 'mesSaida', 'observacao'] as const;
const COLUNA: Readonly<Record<string, string>> = Object.fromEntries(CAMPOS.map((c, i) => [c, COLUNAS_PESSOAL[i]!]));
const CAMPO: Readonly<Record<string, string>> = Object.fromEntries(CAMPOS.map((c, i) => [COLUNAS_PESSOAL[i]!, c]));

export type OrigemPosicao = 'IMPORTACAO' | 'COPIA' | 'TELA';
// salarioMensal e valorAnual nulos: quem só consulta não os recebe (D-P12-3; com quantidade 1, o
// anual revelaria o salário por conta inversa).
export type PosicaoTela = {
  id: string;
  cc: string;
  /** Com cargo do cadastro, o nome atual dele; sem, o texto gravado. */
  cargo: string;
  cargoId: string | null;
  cargoInativo: boolean;
  quantidade: number;
  salarioMensal: Dinheiro | null;
  mesInicio: number;
  mesSaida: number;
  observacao: string | null;
  origem: OrigemPosicao;
  versao: number;
  valorAnual: Dinheiro | null;
};
export type ListaPosicoes = { posicoes: readonly PosicaoTela[]; editavel: boolean; veSalario: boolean };
export type OpcaoCc = { classificacao: string; descricao: string };
export type OpcoesPosicao = {
  ccs: readonly OpcaoCc[];
  // QUANTIDADE_MAXIMA do C2, para o formulário (o cliente não importa o cad).
  quantidadeMaxima: number;
  situacao: SituacaoExercicio;
  rotuloSituacao: string;
  editavel: boolean;
  /** Escopo TOTAL (sem subárvore): a condição da tela de correspondência do cargo (P16, D-P16-1). */
  escopoTotal: boolean;
};
export type ResultadoPosicao = { id: string; ano: number; cc: string; mensagem: string };
// Cargo da escolha na posição (D-P15-2, D-P15-5): valores em texto canônico ("1234.56"), nulos sem
// cad.salarios ou sem a chave da cifra.
export type OpcaoCargo = { id: string; codigo: string; nome: string; salarioFonteAtiva: string | null; faixa: { minimo: string; maximo: string } | null };
export type CargosPosicao = { cargos: readonly OpcaoCargo[]; comSalario: boolean; aviso: string | null };
// Prévia do custo (§6.6): massa (salário e adicional), férias + 1/3 e 13º, encargos, benefícios e o
// anual. aviso: premissas mudadas para quem lança só no escopo (a gravação seria recusada, D-P12-5).
export type PreviaPosicao = { massa: Dinheiro; feriasDecimo: Dinheiro; encargos: Dinheiro; beneficios: Dinheiro; anual: Dinheiro; aviso: string | null };

const din = (v: { toString(): string }) => Dinheiro.de(v.toString());
const noEscopo = (escopo: Escopo, cc: string) => escopo.tipo === 'TOTAL' || escopo.ccs.has(cc);
const conflito = (): Resultado<never> => falha([{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }]);
const inexistente = () => new ErroDominio('orc.posicao_inexistente', MENSAGENS_ORC.POSICAO_INEXISTENTE);
// D-P12-3: vê o salário quem inclui ou altera posição.
const veSalario = (ctx: ContextoRequisicao) => ctx.permissoes.has(`${FUNCIONALIDADE}:incluir`) || ctx.permissoes.has(`${FUNCIONALIDADE}:alterar`);

async function exercicio(deps: DepsOrc, id: string) {
  const e = z.uuid().safeParse(id).success ? await deps.cliente.orcamentoExercicio.findUnique({ where: { id } }) : null;
  if (!e) throw new ErroDominio('orc.exercicio_inexistente', 'Exercício não encontrado.');
  return { ...e, situacao: e.situacao as SituacaoExercicio };
}

export async function listarPosicoes(ctx: ContextoRequisicao, exercicioId: string, depsParciais: Partial<DepsOrc> = {}): Promise<ListaPosicoes> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const deps = resolverDeps(depsParciais);
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  const escopo = await resolverEscopo(deps.cliente, ctx, indice, deps);
  const e = await exercicio(deps, exercicioId);
  const ve = veSalario(ctx);
  const linhas = await deps.cliente.posicaoOrcada.findMany({
    where: { exercicioId: e.id, ...(escopo.tipo === 'TOTAL' ? {} : { cc: { in: [...escopo.ccs] } }) },
    // Sem a permissão, o salário e as linhas nem saem do banco.
    select: {
      id: true, cc: true, cargo: true, cargoId: true, quantidade: true, mesInicio: true, mesSaida: true, observacao: true, origem: true, versao: true,
      salarioMensal: ve, linhas: ve ? { select: { total: true } } : false,
    },
    orderBy: [{ cc: 'asc' }, { cargo: 'asc' }, { id: 'asc' }],
  });
  // Nome e situação atuais do cargo do cadastro (sem a cifra: nada de salário aqui).
  const cargos = linhas.some((p) => p.cargoId !== null)
    ? new Map((await deps.custoPessoal.listarCargosSemSalarioCifrado(deps.cliente, { incluirInativos: true })).map((c) => [c.id, c]))
    : new Map<string, CargoExercicio>();
  const posicoes = linhas.map(
    (p): PosicaoTela => ({
      id: p.id,
      cc: p.cc,
      cargo: (p.cargoId && cargos.get(p.cargoId)?.nome) || p.cargo,
      cargoId: p.cargoId,
      cargoInativo: p.cargoId !== null && cargos.get(p.cargoId)?.ativo === false,
      quantidade: p.quantidade,
      salarioMensal: ve && p.salarioMensal ? din(p.salarioMensal) : null,
      mesInicio: p.mesInicio,
      mesSaida: p.mesSaida,
      observacao: p.observacao,
      origem: p.origem as OrigemPosicao,
      versao: p.versao,
      valorAnual: ve && p.linhas ? Dinheiro.somarTodos(p.linhas.map((l) => din(l.total))) : null,
    }),
  );
  return { posicoes, editavel: editavel(e.situacao), veSalario: ve };
}

// CCs analíticos ativos da árvore, em ordem (a árvore já vem ordenada pela classificação).
function analiticos(nos: readonly NoCentroCusto[], indice: IndiceEstruturaFinanceira): OpcaoCc[] {
  return nos.flatMap((n) => [
    ...(n.tipo === 'ANALITICO' && indice.centroCustoAnalitico(n.classificacao) ? [{ classificacao: n.classificacao, descricao: n.descricao }] : []),
    ...analiticos(n.filhos, indice),
  ]);
}

// Opções do formulário: CCs analíticos do escopo e a situação do exercício.
export async function opcoesPosicao(ctx: ContextoRequisicao, exercicioId: string, depsParciais: Partial<DepsOrc> = {}): Promise<OpcoesPosicao> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const deps = resolverDeps(depsParciais);
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  const escopo = await resolverEscopo(deps.cliente, ctx, indice, deps);
  const e = await exercicio(deps, exercicioId);
  const arvore = await deps.estrutura.listarArvoreCentrosCusto(deps.cliente);
  return {
    ccs: analiticos(arvore, indice).filter((c) => noEscopo(escopo, c.classificacao)),
    quantidadeMaxima: QUANTIDADE_MAXIMA,
    situacao: e.situacao,
    rotuloSituacao: ROTULO_SITUACAO[e.situacao],
    editavel: editavel(e.situacao),
    escopoTotal: escopo.tipo === 'TOTAL',
  };
}

const texto = z.string().optional();
const DADOS = Object.fromEntries(CAMPOS.map((c) => [c, texto])) as Record<(typeof CAMPOS)[number], typeof texto>;
const versao = z.coerce.number().int().min(0);
// cargoId: o cargo do cadastro de C&S; vazio ou ausente = cargo em texto livre (C34).
const entradaInclusao = z.object({ ...DADOS, cargoId: texto, exercicioId: z.string() }).strict();
const entradaAlteracao = z.object({ ...DADOS, cargoId: texto, id: z.string(), versao }).strict();
const entradaExclusao = z.object({ id: z.string(), versao }).strict();
const MENSAGEM_ENTRADA = 'Dados da posição inválidos. Recarregue a tela.';
const errosDaEntrada = (): Resultado<never> => falha([{ campo: '_', mensagem: MENSAGEM_ENTRADA }]);

// Campos do formulário → validação da aba Pessoal (salário no formato brasileiro da tela).
function validarDados(dados: Readonly<Record<string, unknown>>, indice: IndiceEstruturaFinanceira, escopo: Escopo): Resultado<DadosPosicaoValidada> {
  const celulas = Object.fromEntries(
    CAMPOS.map((c) => {
      const v = typeof dados[c] === 'string' ? (dados[c] as string) : null;
      return [COLUNA[c]!, c === 'salarioMensal' ? valorDaTela(v ?? '') : v];
    }),
  );
  const r = validarLinhaPosicao(
    celulas,
    // A aba Pessoal não tem conta: contaPermitida nunca é chamada.
    { ccAnalitico: (cc) => indice.centroCustoAnalitico(cc), contaPermitida: () => false, noEscopo: (cc) => noEscopo(escopo, cc) },
    { quantidadeMaxima: QUANTIDADE_MAXIMA },
  );
  if (!r.ok) return falha(r.erros.map((e): ErroCampo => ({ campo: CAMPO[e.campo] ?? '_', mensagem: e.mensagem })));
  return r;
}

// A posição validada com o cargo do cadastro (nulo = texto livre).
type DadosPosicao = DadosPosicaoValidada & { cargoId: string | null };
type Retratavel = Omit<DadosPosicao, 'salarioMensal'> & { salarioMensal: Dinheiro | { toString(): string } };
// D-P12-4: a posição inteira no Histórico, com o salário (a tela de detalhe mascara com
// mascararHistoricoOrc). A descrição nunca leva salário nem valor. Do cargo do cadastro, só o id (C24,
// D-P15-2): nenhum campo diz se o salário é o da Fonte Ativa.
export const retrato = (p: Retratavel) => ({
  cc: p.cc,
  cargo: p.cargo,
  cargoId: p.cargoId,
  quantidade: p.quantidade,
  salarioMensal: (p.salarioMensal instanceof Dinheiro ? p.salarioMensal : din(p.salarioMensal)).paraString(),
  mesInicio: p.mesInicio,
  mesSaida: p.mesSaida,
  observacao: p.observacao,
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
// Na inclusão (e na prévia) o exercício vem do formulário; na alteração e na exclusão, nunca (é o da posição).
const BLINDADOS_INCLUSAO = CAMPOS_ORIGEM_BLINDADA.posicao.filter((c) => c !== 'exercicioId');

async function indiceEEscopo(ctx: ContextoRequisicao, deps: DepsOrc) {
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  return { indice, escopo: await resolverEscopo(deps.cliente, ctx, indice, deps) };
}

const custoDe = (tx: TxCliente, v: DadosPosicao, cache: CacheCargos, premissas: PremissasExercicio, deps: DepsOrc) =>
  custoDaPosicao(tx, deps, cache, premissas, { quantidade: v.quantidade, salarioMensal: v.salarioMensal, mesInicio: v.mesInicio, mesSaida: v.mesSaida, cargoId: v.cargoId });
// Erros do motor: os campos dele (quantidade, salarioMensal, mesInicio, mesSaida) são os do formulário;
// os das premissas (contas sem analítica, encargos) viram erro geral.
const errosDoMotor = (erros: readonly ErroCampo[]): ErroCampo[] =>
  erros.map((e) => ({ campo: (CAMPOS as readonly string[]).includes(e.campo) ? e.campo : '_', mensagem: e.mensagem }));

type Recalculo = { tipo: 'POSICAO'; serie: SerieMensalComponentes } | { tipo: 'EXERCICIO' };
type Preparo = { v: DadosPosicao; premissas: PremissasExercicio; serie: SerieMensalComponentes; desatualizadas: boolean };

const erroCargo = (mensagem: string): Resultado<never> => falha([{ campo: 'cargoId', mensagem }]);
const ehCifraIndisponivel = (e: unknown) => e instanceof ErroDominio && e.codigo === 'cad.cifra_indisponivel';
// A versão com o salário decifrado (só no app, com a chave): importada na hora, para a cifra não entrar
// no caminho da seed, da importação e do worker (D-P15-2).
const decifrados = async (deps: DepsOrc) => deps.cargosDecifrados ?? (await import('@/modules/cad')).listarCargosExercicio;

// O cargo escolhido tem salário na Fonte Ativa? Pela versão decifrada; sem a chave, só pela fonte
// escolhida no cadastro (D-P15-2).
async function semFonteAtiva(tx: TxCliente, cargo: CargoExercicio, deps: DepsOrc): Promise<boolean> {
  try {
    const decifrado = (await (await decifrados(deps))(tx, { incluirInativos: true })).find((c) => c.id === cargo.id);
    return !decifrado || decifrado.salarioFonteAtiva === null;
  } catch (e) {
    if (ehCifraIndisponivel(e)) return cargo.fonteAtiva === null;
    throw e;
  }
}

// Cargo do cadastro (D-P15-1, D-P15-2): com cargo, o texto `cargo` passa a ser o nome do cadastro,
// cortado em 120 caracteres, antes da validação. O cargo precisa existir sempre; inativo e sem Fonte
// Ativa são recusados só quando o cargoId muda (o mesmo já gravado passa). cargoId '' é o texto livre
// (C34); sem cargoId, ninguém escolheu (o formulário abre em "Escolha o cargo", que não é enviado).
async function aplicarCargo(
  tx: TxCliente,
  dados: Readonly<Record<string, unknown>>,
  cache: CacheCargos,
  cargoGravado: string | null,
  deps: DepsOrc,
): Promise<Resultado<{ dados: Readonly<Record<string, unknown>>; cargoId: string | null }>> {
  if (typeof dados.cargoId !== 'string') return erroCargo(MENSAGENS_ORC.CARGO_NAO_ESCOLHIDO);
  const cargoId = dados.cargoId !== '' ? dados.cargoId : null;
  if (cargoId === null) return ok({ dados, cargoId });
  const cargo = await validarCargoEscolhido(tx, cache, cargoId, cargoGravado, deps);
  if (!cargo.ok) return cargo;
  return ok({ dados: { ...dados, cargo: nomeDoCargo(cargo.valor) }, cargoId });
}

/** O texto `cargo` da posição ligada: o nome do cadastro, cortado em 120 caracteres (D-P15-1). */
export const nomeDoCargo = (cargo: CargoExercicio) => cargo.nome.slice(0, 120);

/**
 * O cargo escolhido do cadastro (D-P15-2): precisa existir sempre; inativo e sem Fonte Ativa são recusados
 * só quando muda (o mesmo já gravado passa). Também na tela de correspondência (P16), com cargoGravado nulo.
 */
export async function validarCargoEscolhido(
  tx: TxCliente,
  cache: CacheCargos,
  cargoId: string,
  cargoGravado: string | null,
  deps: DepsOrc,
): Promise<Resultado<CargoExercicio>> {
  const cargo = cache.porId.get(cargoId);
  if (!cargo) return erroCargo(MENSAGENS_ORC.CARGO_NAO_ENCONTRADO);
  if (cargoId !== cargoGravado) {
    if (!cargo.ativo) return erroCargo(MENSAGENS_ORC.CARGO_INATIVO);
    if (await semFonteAtiva(tx, cargo, deps)) return erroCargo(MENSAGENS_ORC.CARGO_SEM_FONTE_ATIVA);
  }
  return ok(cargo);
}

// Validação e custo da posição com as premissas atuais, sem gravar nada (gravação e prévia). O motor
// roda antes de qualquer escrita: um erro da própria posição volta como erro de campo, e um erro no
// recálculo do exercício inteiro só pode ser de outro lançamento. cargoGravado: o cargo da posição
// existente (alteração e prévia com o id), para a regra da troca de cargo.
async function preparar(
  tx: TxCliente,
  e: { ano: number; versaoPremissas: number | null },
  bruto: Readonly<Record<string, unknown>>,
  cargoGravado: string | null,
  indice: IndiceEstruturaFinanceira,
  escopo: Escopo,
  deps: DepsOrc,
): Promise<Resultado<Preparo>> {
  const cache = await carregarCargos(tx, deps);
  const c = await aplicarCargo(tx, bruto, cache, cargoGravado, deps);
  if (!c.ok) return c;
  const r = validarDados(c.valor.dados, indice, escopo);
  if (!r.ok) return r;
  const v: DadosPosicao = { ...r.valor, cargoId: c.valor.cargoId };
  const premissas = await deps.custoPessoal.obterPremissasExercicio(tx, e.ano);
  if (!premissas) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.PREMISSAS_INEXISTENTES }]);
  const serie = await custoDe(tx, v, cache, premissas, deps);
  if (!serie.ok) return falha(errosDoMotor(serie.erros));
  // Exercício nunca calculado (versaoPremissas nula): qualquer um grava, como na importação.
  const desatualizadas = e.versaoPremissas !== null && e.versaoPremissas !== premissas.versao;
  return ok({ v, premissas, serie: serie.valor, desatualizadas });
}

// Dentro da transação, depois da trava do exercício. Premissas iguais às do último cálculo → só as
// linhas da posição. Mudadas → com escopo TOTAL, o exercício inteiro; com subárvore, recusado.
async function prepararGravacao(
  tx: TxCliente,
  e: ExercicioTravado,
  dados: Readonly<Record<string, unknown>>,
  cargoGravado: string | null,
  indice: IndiceEstruturaFinanceira,
  escopo: Escopo,
  deps: DepsOrc,
): Promise<Resultado<{ v: DadosPosicao; plano: Recalculo }>> {
  const p = await preparar(tx, e, dados, cargoGravado, indice, escopo, deps);
  if (!p.ok) return p;
  const { v, serie, desatualizadas } = p.valor;
  if (e.versaoPremissas === p.valor.premissas.versao) return ok({ v, plano: { tipo: 'POSICAO', serie } });
  if (escopo.tipo !== 'TOTAL' && desatualizadas) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS_PACOTE }]);
  return ok({ v, plano: { tipo: 'EXERCICIO' } });
}

// Grava as linhas e devolve a versão das premissas antes e depois quando refez o exercício inteiro
// (para o Histórico, como a importação); só a posição, null. Sempre sobe a versão do exercício.
async function recalcularPosicao(tx: TxCliente, e: ExercicioTravado, posicaoId: string, cc: string, plano: Recalculo, escopo: Escopo, deps: DepsOrc): Promise<{ antes: number | null; depois: number } | null> {
  if (plano.tipo === 'EXERCICIO') {
    const r = await recalcularExercicio(tx, e.id, deps);
    // As premissas são relidas no recálculo: uma versão nova gravada entre as duas leituras desfaz.
    if (escopo.tipo !== 'TOTAL' && e.versaoPremissas !== null && r.versaoPremissas !== e.versaoPremissas) {
      throw new ErroRecalculo([{ campo: '_', mensagem: MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS_PACOTE }]);
    }
    return { antes: e.versaoPremissas, depois: r.versaoPremissas };
  }
  await gravarLinhasPosicao(tx, e.id, posicaoId, cc, plano.serie);
  await tocarExercicio(tx, e.id, deps);
  return null;
}

/** Troca as linhas de uma posição pelas da série (sem subir a versão do exercício). */
export async function gravarLinhasPosicao(tx: TxCliente, exercicioId: string, posicaoId: string, cc: string, serie: SerieMensalComponentes): Promise<void> {
  await tx.linhaOrcada.deleteMany({ where: { posicaoId } });
  await tx.linhaOrcada.createMany({
    data: serie.linhas.map((l) => ({
      exercicioId, cc, conta: l.conta, origem: 'PESSOAL', componente: l.componente, posicaoId, meses: l.meses.map((m) => m.paraString()), total: l.total.paraString(),
    })),
  });
}

export const tocarExercicio = (tx: TxCliente, id: string, deps: DepsOrc) =>
  tx.orcamentoExercicio.update({ where: { id }, data: { versao: { increment: 1 }, atualizadoEm: deps.agora() } });

// Erros do recálculo do exercício inteiro (sempre de outro lançamento: a posição já passou pelo
// motor): com escopo TOTAL, o aviso e os erros como vieram; com subárvore, os de CC fora dela viram
// um aviso só.
function errosDoRecalculo(erro: ErroRecalculo, escopo: Escopo): ErroCampo[] {
  if (escopo.tipo === 'TOTAL') return [{ campo: '_', mensagem: MENSAGENS_ORC.RECALCULO_BARROU_POSICAO }, ...erro.erros];
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

const dadosGravados = (v: DadosPosicao) => ({
  cc: v.cc,
  cargo: v.cargo,
  cargoId: v.cargoId,
  quantidade: v.quantidade,
  salarioMensal: v.salarioMensal.paraString(),
  mesInicio: v.mesInicio,
  mesSaida: v.mesSaida,
  observacao: v.observacao,
});
const comPremissas = (r: object, versao: number | null) => ({ ...r, versaoPremissas: versao });

export async function incluirPosicao(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<ResultadoPosicao>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'incluir', bruto, entradaInclusao, BLINDADOS_INCLUSAO, deps);
  if (!entrada) return errosDaEntrada();
  const { indice, escopo } = await indiceEEscopo(ctx, deps);
  return emTransacao(deps, escopo, async (tx) => {
    // A trava do exercício (FOR UPDATE) vem antes de qualquer escrita no orc_posicao (deadlock com os triggers).
    const e = await travarExercicio(tx, entrada.exercicioId);
    if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
    const p = await prepararGravacao(tx, e, entrada, null, indice, escopo, deps);
    if (!p.ok) return p;
    const { v, plano } = p.valor;
    const criada = await tx.posicaoOrcada.create({ data: { exercicioId: e.id, ...dadosGravados(v), origem: 'TELA' } });
    const premissas = await recalcularPosicao(tx, e, criada.id, v.cc, plano, escopo, deps);
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'INSERCAO',
      registroId: criada.id,
      descricao: `Posição de pessoal incluída no CC ${v.cc}, exercício ${e.ano}${premissas ? ', com o orçamento recalculado' : ''}`,
      ...(premissas ? { antes: { versaoPremissas: premissas.antes } } : {}),
      depois: premissas ? comPremissas(retrato(v), premissas.depois) : retrato(v),
    });
    return ok({ id: criada.id, ano: e.ano, cc: v.cc, mensagem: MENSAGENS_ORC.RECALCULADO });
  });
}

// Posição existente, travada pelo exercício dela: lê, trava o exercício e relê dentro da trava. Fora
// do escopo, a mesma resposta da inexistente (não revela que a posição existe).
async function travarPosicao(tx: TxCliente, id: string, escopo: Escopo) {
  if (!z.uuid().safeParse(id).success) throw inexistente();
  const antes = await tx.posicaoOrcada.findUnique({ where: { id }, select: { exercicioId: true } });
  if (!antes) throw inexistente();
  const e = await travarExercicio(tx, antes.exercicioId);
  const p = await tx.posicaoOrcada.findUnique({ where: { id } });
  if (!p || p.exercicioId !== e.id || !noEscopo(escopo, p.cc)) throw inexistente();
  return { e, p };
}

export async function alterarPosicao(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<ResultadoPosicao>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'alterar', bruto, entradaAlteracao, CAMPOS_ORIGEM_BLINDADA.posicao, deps);
  if (!entrada) return errosDaEntrada();
  const { indice, escopo } = await indiceEEscopo(ctx, deps);
  return emTransacao(deps, escopo, async (tx) => {
    const { e, p } = await travarPosicao(tx, entrada.id, escopo);
    if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
    if (p.versao !== entrada.versao) return conflito();
    const r = await prepararGravacao(tx, e, entrada, p.cargoId, indice, escopo, deps);
    if (!r.ok) return r;
    const { v, plano } = r.valor;
    // A origem e a importação nunca mudam pela tela (D-P12-7).
    exigirUmaLinha(await tx.posicaoOrcada.updateMany({ where: { id: p.id, versao: entrada.versao }, data: { ...dadosGravados(v), versao: { increment: 1 } } }));
    const premissas = await recalcularPosicao(tx, e, p.id, v.cc, plano, escopo, deps);
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: p.id,
      descricao: `Posição de pessoal alterada no CC ${v.cc}, exercício ${e.ano}${premissas ? ', com o orçamento recalculado' : ''}`,
      antes: premissas ? comPremissas(retrato(p), premissas.antes) : retrato(p),
      depois: premissas ? comPremissas(retrato(v), premissas.depois) : retrato(v),
    });
    return ok({ id: p.id, ano: e.ano, cc: v.cc, mensagem: MENSAGENS_ORC.RECALCULADO });
  });
}

// A exclusão sempre pode: não exige CC ativo nem premissas.
export async function excluirPosicao(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<ResultadoPosicao>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'excluir', bruto, entradaExclusao, CAMPOS_ORIGEM_BLINDADA.posicao, deps);
  if (!entrada) return errosDaEntrada();
  const { escopo } = await indiceEEscopo(ctx, deps);
  return emTransacao(deps, escopo, async (tx) => {
    const { e, p } = await travarPosicao(tx, entrada.id, escopo);
    if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
    if (p.versao !== entrada.versao) return conflito();
    // As linhas da posição saem em cascata; nenhuma outra linha depende dela.
    exigirUmaLinha(await tx.posicaoOrcada.deleteMany({ where: { id: p.id, versao: entrada.versao } }));
    await tocarExercicio(tx, e.id, deps);
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId: p.id,
      descricao: `Posição de pessoal excluída do CC ${p.cc}, exercício ${e.ano}`,
      antes: retrato(p),
    });
    return ok({ id: p.id, ano: e.ano, cc: p.cc, mensagem: MENSAGENS_ORC.RECALCULADO });
  });
}

// id: a posição em alteração, para a mesma regra da troca de cargo da gravação (D-P15-2).
const entradaPrevia = z.object({ ...DADOS, cargoId: texto, id: texto, exercicioId: z.string() }).strict();
const somar = (s: SerieMensalComponentes, prefixos: readonly string[]) =>
  Dinheiro.somarTodos(s.linhas.filter((l) => prefixos.some((x) => l.componente === x || l.componente.startsWith(`${x}.`))).map((l) => l.total));

// Prévia do custo (D-P12-6): só leitura, sem gravar e sem Histórico, com o mesmo motor e as premissas
// atuais do exercício (as da gravação). Exige incluir ou alterar (só quem vê o salário) e respeita o
// escopo pelo CC. O texto do cargo e a observação não barram a prévia; o cargo do cadastro entra no
// cálculo (benefícios e adicional) e passa pelas mesmas recusas da gravação.
export async function previaPosicao(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<PreviaPosicao>> {
  if (!veSalario(ctx)) throw new ErroPermissao(FUNCIONALIDADE, 'incluir');
  const deps = resolverDeps(depsParciais);
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, BLINDADOS_INCLUSAO, deps);
  const parse = entradaPrevia.safeParse(bruto);
  if (!parse.success) return errosDaEntrada();
  const entrada = parse.data;
  const { indice, escopo } = await indiceEEscopo(ctx, deps);
  const e = await exercicio(deps, entrada.exercicioId);
  if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
  // O cargo gravado só vale para posição do mesmo exercício e do escopo; senão, a regra da inclusão.
  const gravada = entrada.id && z.uuid().safeParse(entrada.id).success
    ? await deps.cliente.posicaoOrcada.findUnique({ where: { id: entrada.id }, select: { exercicioId: true, cc: true, cargoId: true } })
    : null;
  const cargoGravado = gravada && gravada.exercicioId === e.id && noEscopo(escopo, gravada.cc) ? gravada.cargoId : null;
  const p = await preparar(deps.cliente, e, { ...entrada, cargo: 'Prévia', observacao: '' }, cargoGravado, indice, escopo, deps);
  if (!p.ok) return p;
  const { serie, desatualizadas } = p.valor;
  return ok({
    massa: somar(serie, ['salario', 'adicional']),
    feriasDecimo: somar(serie, ['ferias', 'decimo_terceiro']),
    encargos: somar(serie, ['encargo']),
    beneficios: somar(serie, ['beneficio']),
    anual: serie.total,
    aviso: desatualizadas && escopo.tipo !== 'TOTAL' ? MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS_PACOTE : null,
  });
}

const canonico = (d: Dinheiro) => d.paraString();

/**
 * Cargos da escolha na posição (D-P15-2, D-P15-5): os ativos com Fonte Ativa, em ordem de código. Só para
 * quem inclui ou altera posição. A Fonte Ativa e a faixa de mercado vão só a quem também tem
 * cad.salarios:consultar (R24), com um CONSULTA em cad.salarios (os códigos, sem os valores). Sem a chave
 * da cifra, a lista sai sem salário e com o aviso.
 */
export async function cargosParaPosicao(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<CargosPosicao> {
  if (!veSalario(ctx)) throw new ErroPermissao(FUNCIONALIDADE, 'incluir');
  const deps = resolverDeps(depsParciais);
  const podeVer = ctx.permissoes.has('cad.salarios:consultar');
  let cargos: readonly CargoExercicio[];
  let cifra = true;
  try {
    cargos = (await (await decifrados(deps))(deps.cliente)).filter((c) => c.salarioFonteAtiva !== null);
  } catch (e) {
    if (!ehCifraIndisponivel(e)) throw e;
    cifra = false;
    cargos = (await deps.custoPessoal.listarCargosSemSalarioCifrado(deps.cliente)).filter((c) => c.fonteAtiva !== null);
  }
  const ativos = cargos.filter((c) => c.ativo);
  const comSalario = podeVer && cifra;
  const opcoes = ativos.map(
    (c): OpcaoCargo => ({
      id: c.id,
      codigo: c.codigo,
      nome: c.nome,
      salarioFonteAtiva: comSalario && c.salarioFonteAtiva ? canonico(c.salarioFonteAtiva) : null,
      faixa: comSalario && c.faixa ? { minimo: canonico(c.faixa.minimo), maximo: canonico(c.faixa.maximo) } : null,
    }),
  );
  if (comSalario && opcoes.length > 0) {
    await deps.cliente.$transaction((tx) =>
      auditar(tx, {
        contexto: contextoAuditoria(ctx),
        funcionalidade: 'cad.salarios',
        tipo: 'CONSULTA',
        registroId: '*',
        descricao: `Salários de ${opcoes.length} ${opcoes.length === 1 ? 'cargo consultado' : 'cargos consultados'} sem máscara na posição de pessoal`,
        depois: { cargos: opcoes.map((c) => c.codigo) },
      }),
    );
  }
  const aviso = comSalario ? null : !podeVer ? MENSAGENS_ORC.FONTE_ATIVA_SEM_PERFIL : MENSAGENS_ORC.FONTE_ATIVA_INDISPONIVEL;
  return { cargos: opcoes, comSalario, aviso };
}
