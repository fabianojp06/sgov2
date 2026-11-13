import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { aliquotaVigente, competenciaDe, ehCompetencia, validarAliquota, validarImposto, type Competencia, type Incidencia } from '../domain/impostos';
import { competenciaDaData } from '../infrastructure/impostos';
import { MSG_CONCORRENCIA } from '../infrastructure/parametro-sistema';

// Impostos e alíquotas com vigência (US-052; UC03.01, REQ_TAX_001, RN_TAX_05/06), com
// cad.impostos (GFIN). A alíquota que já começou a valer não muda nem sai; a futura pode ser
// removida antes de valer. O trigger da migration garante o mesmo no banco.

type Deps = { cliente?: PrismaClient; agora?: () => Date };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});
// 6.5000 → 6,5 (tela).
const pctTela = (d: { toFixed(n: number): string }) => {
  const s = d.toFixed(4);
  return (s.includes('.') ? s.replace(/\.?0+$/, '') : s).replace('.', ',');
};
const nomeRepetido = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || (e instanceof Error && /\b23505\b|imposto_nome_key/.test(e.message));
const MSG_NOME = (nome: string) => `Operação rejeitada: já existe um imposto cadastrado com o nome ${nome}.`;

export type AliquotaTela = Readonly<{ competencia: Competencia; percentual: string; futura: boolean }>;
export type ImpostoTela = Readonly<{
  id: string;
  nome: string;
  incidencia: Incidencia;
  ativo: boolean;
  versao: number;
  /** A alíquota que vale no mês atual, ou null. */
  vigente: AliquotaTela | null;
  /** Histórico, da mais recente para a mais antiga. */
  aliquotas: readonly AliquotaTela[];
}>;
export type TelaImpostos = Readonly<{ mesAtual: Competencia; impostos: readonly ImpostoTela[] }>;

export async function obterTelaImpostos(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaImpostos> {
  exigir(ctx, 'cad.impostos', 'consultar');
  const mesAtual = competenciaDe((deps.agora ?? (() => new Date()))());
  const lidos = await (deps.cliente ?? prisma).imposto.findMany({
    orderBy: { nome: 'asc' },
    select: { id: true, nome: true, incidencia: true, ativo: true, versao: true, aliquotas: { select: { competencia: true, percentual: true } } },
  });
  return {
    mesAtual,
    impostos: lidos.map((i) => {
      const aliquotas = i.aliquotas
        .map((a) => {
          const competencia = competenciaDaData(a.competencia);
          return { competencia, percentual: pctTela(a.percentual), futura: competencia > mesAtual };
        })
        .sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
      return { id: i.id, nome: i.nome, incidencia: i.incidencia as Incidencia, ativo: i.ativo, versao: i.versao, vigente: aliquotaVigente(aliquotas, mesAtual), aliquotas };
    }),
  };
}

/** Inclui um imposto (cad.impostos:incluir). */
export async function incluirImposto(ctx: ContextoRequisicao, dados: { nome: string; incidencia: string }, deps: Deps = {}): Promise<Resultado<{ id: string }>> {
  exigir(ctx, 'cad.impostos', 'incluir');
  const v = validarImposto(dados);
  if (!v.ok) return v;
  try {
    return await (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
      // SQL explícito: o sgo_app só insere nome e incidência (o Prisma mandaria os defaults).
      const [criado] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "imposto" ("nome", "incidencia")
        VALUES (${v.valor.nome}, ${v.valor.incidencia}::"IncidenciaImposto") RETURNING "id"`;
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.impostos',
        tipo: 'INSERCAO',
        registroId: criado!.id,
        descricao: `Imposto ${v.valor.nome} incluído`,
        depois: { nome: v.valor.nome, incidencia: v.valor.incidencia },
      });
      return ok({ id: criado!.id });
    });
  } catch (e) {
    if (nomeRepetido(e)) return falha([{ campo: 'nome', mensagem: MSG_NOME(v.valor.nome) }]);
    throw e;
  }
}

/** Altera nome, incidência e situação do imposto (cad.impostos:alterar), com a versão. */
export async function alterarImposto(
  ctx: ContextoRequisicao,
  id: string,
  versao: number,
  dados: { nome: string; incidencia: string; ativo: boolean },
  deps: Deps = {},
): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.impostos', 'alterar');
  if (!UUID.test(id) || !Number.isInteger(versao) || versao < 1) return falha([{ campo: '_', mensagem: 'Imposto ou versão inválidos. Recarregue a tela.' }]);
  const v = validarImposto(dados);
  if (!v.ok) return v;
  try {
    return await (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
      const antes = await tx.imposto.findUnique({ where: { id }, select: { nome: true, incidencia: true, ativo: true } });
      if (!antes) return falha([{ campo: '_', mensagem: 'Imposto não encontrado. Recarregue a tela.' }]);
      if (antes.nome === v.valor.nome && antes.incidencia === v.valor.incidencia && antes.ativo === dados.ativo) return ok({ versao });
      const r = await tx.imposto.updateMany({
        where: { id, versao },
        data: { nome: v.valor.nome, incidencia: v.valor.incidencia, ativo: dados.ativo, versao: { increment: 1 } },
      });
      if (r.count === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.impostos',
        tipo: 'ALTERACAO',
        registroId: id,
        descricao: `Imposto ${v.valor.nome} alterado`,
        antes: { nome: antes.nome, incidencia: antes.incidencia, ativo: antes.ativo },
        depois: { nome: v.valor.nome, incidencia: v.valor.incidencia, ativo: dados.ativo },
      });
      return ok({ versao: versao + 1 });
    });
  } catch (e) {
    if (nomeRepetido(e)) return falha([{ campo: 'nome', mensagem: MSG_NOME(v.valor.nome) }]);
    throw e;
  }
}

/** Inclui a alíquota de uma competência atual ou futura (cad.impostos:alterar). */
export async function incluirAliquota(
  ctx: ContextoRequisicao,
  impostoId: string,
  dados: { competencia: string; percentual: string },
  deps: Deps = {},
): Promise<Resultado<{ competencia: Competencia }>> {
  exigir(ctx, 'cad.impostos', 'alterar');
  if (!UUID.test(impostoId)) return falha([{ campo: '_', mensagem: 'Imposto inválido. Recarregue a tela.' }]);
  const v = validarAliquota(dados, competenciaDe((deps.agora ?? (() => new Date()))()));
  if (!v.ok) return v;
  try {
    return await (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
      const imposto = await tx.imposto.findUnique({ where: { id: impostoId }, select: { nome: true } });
      if (!imposto) return falha([{ campo: '_', mensagem: 'Imposto não encontrado. Recarregue a tela.' }]);
      await tx.$executeRaw`INSERT INTO "aliquota_imposto" ("imposto_id", "competencia", "percentual")
        VALUES (${impostoId}::uuid, ${`${v.valor.competencia}-01`}::date, ${v.valor.percentual.paraString()}::numeric)`;
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.impostos',
        tipo: 'INSERCAO',
        registroId: impostoId,
        descricao: `Alíquota do ${imposto.nome} a partir de ${v.valor.competencia}`,
        depois: { competencia: v.valor.competencia, percentual: v.valor.percentual.paraString() },
      });
      return ok({ competencia: v.valor.competencia });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return falha([{ campo: 'competencia', mensagem: 'Já existe alíquota para essa competência. Remova a futura antes de incluir outra.' }]);
    }
    if (e instanceof Error && /\b23505\b|aliquota_imposto_pkey/.test(e.message)) {
      return falha([{ campo: 'competencia', mensagem: 'Já existe alíquota para essa competência. Remova a futura antes de incluir outra.' }]);
    }
    if (e instanceof Error && /Alíquota retroativa/.test(e.message)) {
      return falha([{ campo: 'competencia', mensagem: 'A vigência de uma alíquota não pode ser retroativa.' }]);
    }
    throw e;
  }
}

/** Remove uma alíquota que ainda não começou a valer (cad.impostos:alterar). */
export async function removerAliquotaFutura(ctx: ContextoRequisicao, impostoId: string, competencia: string, deps: Deps = {}): Promise<Resultado<{ removida: boolean }>> {
  exigir(ctx, 'cad.impostos', 'alterar');
  if (!UUID.test(impostoId) || !ehCompetencia(competencia)) return falha([{ campo: '_', mensagem: 'Alíquota inválida. Recarregue a tela.' }]);
  if (competencia <= competenciaDe((deps.agora ?? (() => new Date()))())) {
    return falha([{ campo: '_', mensagem: 'A alíquota em vigor ou passada não pode ser removida: inclua uma nova vigência.' }]);
  }
  try {
    return await (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
      const imposto = await tx.imposto.findUnique({ where: { id: impostoId }, select: { nome: true } });
      if (!imposto) return falha([{ campo: '_', mensagem: 'Imposto não encontrado. Recarregue a tela.' }]);
      const [removida] = await tx.$queryRaw<{ percentual: string }[]>`DELETE FROM "aliquota_imposto"
        WHERE "imposto_id" = ${impostoId}::uuid AND "competencia" = ${`${competencia}-01`}::date RETURNING "percentual"::text`;
      if (!removida) return ok({ removida: false });
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.impostos',
        tipo: 'EXCLUSAO',
        registroId: impostoId,
        descricao: `Alíquota futura do ${imposto.nome} de ${competencia} removida`,
        antes: { competencia, percentual: removida.percentual },
      });
      return ok({ removida: true });
    });
  } catch (e) {
    if (e instanceof Error && /Alíquota em vigor ou passada não sai/.test(e.message)) {
      return falha([{ campo: '_', mensagem: 'A alíquota passou a valer. Recarregue a tela.' }]);
    }
    throw e;
  }
}
