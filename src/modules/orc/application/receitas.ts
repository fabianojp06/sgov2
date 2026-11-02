import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, ErroDominio, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { editavel } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { validarReceita } from '../domain/planilha';
import { valorDaTela, valorParaTela } from '../domain/valor-tela';
import { contextoAuditoria, errosNaoEditavel, travarExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { exigirSemEscopo } from './escopo';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';

// Receitas do rateio dos TPs digitadas na transição (US-060; C35; plano do P6, Task 5). Origem
// sempre MANUAL_TRANSICAO (R11); o rateio calculado do TP substitui o digitado na F3 (US-073).
// Só quem vê a Adm. Central inteira (R15). ISS "a definir" (GAP-ORC-007): líquido = rateio.

const FUNCIONALIDADE = 'orc.receitas';
export const MESES_FORM = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
// Campo do formulário → coluna da aba Receitas (as regras de validação ficam num lugar só).
const COLUNA: Readonly<Record<string, string>> = {
  tp: 'TP / versão',
  descricao: 'Descrição',
  situacao: 'Situação',
  ...Object.fromEntries(MESES_FORM.map((m) => [m, m[0]!.toUpperCase() + m.slice(1)])),
};
const CAMPO = Object.fromEntries(Object.entries(COLUNA).map(([campo, coluna]) => [coluna, campo]));

export type ReceitaTela = {
  id: string;
  tp: string;
  descricao: string;
  situacao: 'CONFIRMADO' | 'PREVISTO';
  meses: readonly Dinheiro[];
  total: Dinheiro;
  iss: 'a definir';
  liquido: Dinheiro;
  origem: 'MANUAL_TRANSICAO';
  versao: number;
};
export type ListaReceitas = {
  confirmadas: readonly ReceitaTela[];
  previstas: readonly ReceitaTela[];
  totalConfirmadoMes: readonly Dinheiro[];
  totalPrevistoMes: readonly Dinheiro[];
  editavel: boolean;
};

const din = (v: { toString(): string }) => Dinheiro.de(v.toString());
const somaPorMes = (rs: readonly ReceitaTela[]) => Array.from({ length: 12 }, (_, i) => Dinheiro.somarTodos(rs.map((r) => r.meses[i]!)));

export async function listarReceitas(ctx: ContextoRequisicao, exercicioId: string, depsParciais: Partial<DepsOrc> = {}): Promise<ListaReceitas> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const deps = resolverDeps(depsParciais);
  await exigirSemEscopo(deps.cliente, ctx, deps, FUNCIONALIDADE, 'consultar');
  const e = z.uuid().safeParse(exercicioId).success ? await deps.cliente.orcamentoExercicio.findUnique({ where: { id: exercicioId } }) : null;
  if (!e) throw new ErroDominio('orc.exercicio_inexistente', 'Exercício não encontrado.');
  const linhas = await deps.cliente.receitaRateio.findMany({ where: { exercicioId }, orderBy: { tp: 'asc' } });
  const receitas: ReceitaTela[] = linhas.map((r) => ({
    id: r.id,
    tp: r.tp,
    descricao: r.descricao,
    situacao: r.situacao as ReceitaTela['situacao'],
    meses: r.meses.map(din),
    total: din(r.total),
    iss: 'a definir',
    liquido: din(r.total),
    origem: 'MANUAL_TRANSICAO',
    versao: r.versao,
  }));
  const confirmadas = receitas.filter((r) => r.situacao === 'CONFIRMADO');
  const previstas = receitas.filter((r) => r.situacao === 'PREVISTO');
  return {
    confirmadas,
    previstas,
    totalConfirmadoMes: somaPorMes(confirmadas),
    totalPrevistoMes: somaPorMes(previstas),
    editavel: editavel(e.situacao as Parameters<typeof editavel>[0]),
  };
}

const camposReceita = Object.keys(COLUNA);
const texto = z.string().optional();
const DADOS = {
  tp: texto, descricao: texto, situacao: texto,
  jan: texto, fev: texto, mar: texto, abr: texto, mai: texto, jun: texto, jul: texto, ago: texto, set: texto, out: texto, nov: texto, dez: texto,
};
const versao = z.coerce.number().int().min(0);
const entradaInclusao = z.object({ ...DADOS, exercicioId: z.string() }).strict();
const entradaAlteracao = z.object({ ...DADOS, id: z.string(), versao }).strict();
const entradaExclusao = z.object({ id: z.string(), versao }).strict();

const MENSAGEM_ENTRADA = 'Dados da receita inválidos. Recarregue a tela.';
const errosDaEntrada = (): Resultado<never> => falha([{ campo: '_', mensagem: MENSAGEM_ENTRADA }]);

// Campos do formulário → validação da aba Receitas (com o valor no formato brasileiro da tela).
function validarDados(dados: Readonly<Record<string, unknown>>): Resultado<ReturnType<typeof validarReceita> extends Resultado<infer T> ? T : never> {
  const celulas = Object.fromEntries(
    camposReceita.map((c) => {
      const v = typeof dados[c] === 'string' ? (dados[c] as string) : null;
      return [COLUNA[c]!, (MESES_FORM as readonly string[]).includes(c) ? valorDaTela(v ?? '') : v];
    }),
  );
  const r = validarReceita(celulas);
  if (!r.ok) return falha(r.erros.map((e): ErroCampo => ({ campo: CAMPO[e.campo] ?? '_', mensagem: e.mensagem })));
  return r;
}

const retrato = (r: { tp: string; descricao: string; situacao: string; meses: readonly Dinheiro[] }) => ({
  tp: r.tp,
  descricao: r.descricao,
  situacao: r.situacao,
  meses: r.meses,
  total: Dinheiro.somarTodos(r.meses),
});
const duplicada = (tp: string) => falha([{ campo: 'tp', mensagem: MENSAGENS_ORC.RECEITA_DUPLICADA(tp) }]);
const ehTpDuplicado = (erro: unknown) => erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';

async function tocarExercicio(tx: TxCliente, id: string, agora: Date) {
  await tx.orcamentoExercicio.update({ where: { id }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
}

// Abre a escrita: permissão, escopo total (R15), governança e o parse estrito, nessa ordem.
async function abrir<T>(
  ctx: ContextoRequisicao,
  acao: 'incluir' | 'alterar' | 'excluir',
  bruto: unknown,
  schema: z.ZodType<T>,
  deps: DepsOrc,
): Promise<T | null> {
  exigir(ctx, FUNCIONALIDADE, acao);
  await exigirSemEscopo(deps.cliente, ctx, deps, FUNCIONALIDADE, acao);
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.receita, deps);
  const e = schema.safeParse(bruto);
  return e.success ? e.data : null;
}

export async function incluirReceita(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ id: string; ano: number }>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'incluir', bruto, entradaInclusao, deps);
  if (!entrada) return errosDaEntrada();
  const dados = validarDados(entrada);
  if (!dados.ok) return dados;
  const v = dados.valor;
  try {
    return await deps.cliente.$transaction(async (tx) => {
      const e = await travarExercicio(tx, entrada.exercicioId);
      if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
      if (await tx.receitaRateio.findFirst({ where: { exercicioId: e.id, tp: v.tp } })) return duplicada(v.tp);
      const criada = await tx.receitaRateio.create({
        data: { exercicioId: e.id, tp: v.tp, descricao: v.descricao, situacao: v.situacao, meses: v.meses.map((m) => m.paraString()), total: Dinheiro.somarTodos(v.meses).paraString() },
      });
      await tocarExercicio(tx, e.id, deps.agora());
      await auditar(tx, {
        contexto: contextoAuditoria(ctx),
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: criada.id,
        descricao: `Receita do TP ${v.tp} incluída no exercício ${e.ano} (digitada na transição)`,
        depois: retrato(v),
      });
      return ok({ id: criada.id, ano: e.ano });
    });
  } catch (erro) {
    if (ehTpDuplicado(erro)) return duplicada(v.tp);
    throw erro;
  }
}

// Receita existente, travada pelo exercício dela: lê, trava o exercício e relê dentro da trava.
async function travarReceita(tx: TxCliente, id: string) {
  const inexistente = () => new ErroDominio('orc.receita_inexistente', MENSAGENS_ORC.RECEITA_INEXISTENTE);
  if (!z.uuid().safeParse(id).success) throw inexistente();
  const antes = await tx.receitaRateio.findUnique({ where: { id }, select: { exercicioId: true } });
  if (!antes) throw inexistente();
  const e = await travarExercicio(tx, antes.exercicioId);
  const r = await tx.receitaRateio.findUnique({ where: { id } });
  if (!r || r.exercicioId !== e.id) throw inexistente();
  return { e, r };
}

export async function alterarReceita(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ano: number }>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'alterar', bruto, entradaAlteracao, deps);
  if (!entrada) return errosDaEntrada();
  const dados = validarDados(entrada);
  if (!dados.ok) return dados;
  const v = dados.valor;
  try {
    return await deps.cliente.$transaction(async (tx) => {
      const { e, r } = await travarReceita(tx, entrada.id);
      if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
      if (r.versao !== entrada.versao) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }]);
      if (await tx.receitaRateio.findFirst({ where: { exercicioId: e.id, tp: v.tp, NOT: { id: r.id } } })) return duplicada(v.tp);
      await tx.receitaRateio.update({
        where: { id: r.id },
        data: { tp: v.tp, descricao: v.descricao, situacao: v.situacao, meses: v.meses.map((m) => m.paraString()), total: Dinheiro.somarTodos(v.meses).paraString(), versao: { increment: 1 } },
      });
      await tocarExercicio(tx, e.id, deps.agora());
      await auditar(tx, {
        contexto: contextoAuditoria(ctx),
        funcionalidade: FUNCIONALIDADE,
        tipo: 'ALTERACAO',
        registroId: r.id,
        descricao: `Receita do TP ${v.tp} alterada no exercício ${e.ano}`,
        antes: retrato({ ...r, meses: r.meses.map(din) }),
        depois: retrato(v),
      });
      return ok({ ano: e.ano });
    });
  } catch (erro) {
    if (ehTpDuplicado(erro)) return duplicada(v.tp);
    throw erro;
  }
}

export async function excluirReceita(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ano: number }>> {
  const deps = resolverDeps(depsParciais);
  const entrada = await abrir(ctx, 'excluir', bruto, entradaExclusao, deps);
  if (!entrada) return errosDaEntrada();
  return deps.cliente.$transaction(async (tx) => {
    const { e, r } = await travarReceita(tx, entrada.id);
    if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
    if (r.versao !== entrada.versao) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }]);
    await tx.receitaRateio.delete({ where: { id: r.id } });
    await tocarExercicio(tx, e.id, deps.agora());
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId: r.id,
      descricao: `Receita do TP ${r.tp} excluída do exercício ${e.ano}`,
      antes: retrato({ ...r, meses: r.meses.map(din) }),
    });
    return ok({ ano: e.ano });
  });
}

// Receita para o formulário de alteração (valores no formato brasileiro da tela).
export async function obterReceita(
  ctx: ContextoRequisicao,
  id: string,
  depsParciais: Partial<DepsOrc> = {},
): Promise<{ id: string; exercicioId: string; tp: string; descricao: string; situacao: string; meses: readonly string[]; versao: number } | null> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const deps = resolverDeps(depsParciais);
  await exigirSemEscopo(deps.cliente, ctx, deps, FUNCIONALIDADE, 'alterar');
  if (!z.uuid().safeParse(id).success) return null;
  const r = await deps.cliente.receitaRateio.findUnique({ where: { id } });
  if (!r) return null;
  return { id: r.id, exercicioId: r.exercicioId, tp: r.tp, descricao: r.descricao, situacao: r.situacao, meses: r.meses.map((m) => valorParaTela(din(m))), versao: r.versao };
}
