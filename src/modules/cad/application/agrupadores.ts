import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { MSG_MINIMO, MSG_NOME_REPETIDO, validarAgrupador, type EntradaAgrupador } from '../domain/agrupadores';
import { MSG_CONCORRENCIA } from '../infrastructure/parametro-sistema';

// Agrupadores de contas (US-047; RF_PLA_REQ_005, RN_PLA_007–011). Consulta com cad.plano_contas:consultar;
// incluir, editar e excluir são parametrização local da tela do plano de contas, com
// cad.plano_contas:executar (C27, como os parâmetros locais da US-045). Os triggers da migration
// garantem as mesmas regras no banco (conta analítica ativa, ao menos duas contas).

type Deps = { cliente?: PrismaClient };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});
const MSG_CONTA = 'Uma das contas escolhidas não é analítica ativa. Recarregue a tela.';
const MSG_REFERENCIADO =
  'Exclusão Bloqueada: Este Agrupador está referenciado em documentos orçamentários ativos. Remova as referências antes de excluí-lo.';

export type ContaAgrupavel = Readonly<{ id: string; classificacao: string; descricao: string }>;
export type AgrupadorTela = Readonly<{
  id: string;
  nome: string;
  versao: number;
  contas: readonly Readonly<{ id: string; classificacao: string; descricao: string; ativa: boolean }>[];
}>;
export type TelaAgrupadores = Readonly<{ agrupadores: readonly AgrupadorTela[]; contas: readonly ContaAgrupavel[] }>;

/** Os agrupadores, em ordem de nome, e as contas analíticas ativas que podem entrar neles. */
export async function obterTelaAgrupadores(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaAgrupadores> {
  exigir(ctx, 'cad.plano_contas', 'consultar');
  const cliente = deps.cliente ?? prisma;
  const [agrupadores, contas] = await Promise.all([
    cliente.agrupadorConta.findMany({
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        versao: true,
        itens: { select: { conta: { select: { id: true, classificacao: true, descricao: true, ativa: true } } } },
      },
    }),
    cliente.contaContabil.findMany({
      where: { tipo: 'ANALITICA', ativa: true },
      orderBy: { classificacao: 'asc' },
      select: { id: true, classificacao: true, descricao: true },
    }),
  ]);
  return {
    agrupadores: agrupadores.map((a) => ({
      id: a.id,
      nome: a.nome,
      versao: a.versao,
      contas: a.itens.map((i) => i.conta).sort((x, y) => (x.classificacao < y.classificacao ? -1 : 1)),
    })),
    contas,
  };
}

const classificacoes = async (tx: TxCliente, ids: readonly string[]) =>
  (await tx.contaContabil.findMany({ where: { id: { in: [...ids] } }, select: { classificacao: true }, orderBy: { classificacao: 'asc' } })).map(
    (c) => c.classificacao,
  );

const traduzir = (e: unknown, nome: string) => {
  if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || (e instanceof Error && /\b23505\b|agrupador_conta_nome_key/.test(e.message))) {
    return falha([{ campo: 'nome', mensagem: `${MSG_NOME_REPETIDO} (${nome})` }]);
  }
  if (e instanceof Error && /Agrupador só reúne conta analítica ativa|agrupador_conta_item_conta_id_fkey/.test(e.message)) return falha([{ campo: 'contas', mensagem: MSG_CONTA }]);
  if (e instanceof Error && /menos de duas contas/.test(e.message)) return falha([{ campo: 'contas', mensagem: MSG_MINIMO }]);
  return null;
};

async function incluirItens(tx: TxCliente, agrupadorId: string, contaIds: readonly string[]) {
  if (contaIds.length === 0) return;
  await tx.$executeRaw`INSERT INTO "agrupador_conta_item" ("agrupador_id", "conta_id")
    SELECT ${agrupadorId}::uuid, c FROM unnest(${[...contaIds]}::uuid[]) AS c`;
}

// O mínimo de duas contas é conferido por constraint trigger diferido; aqui ele roda já, e a recusa
// sai dentro da transação, antes do Histórico (não no COMMIT).
const conferirMinimo = (tx: TxCliente) =>
  tx.$executeRaw`SET CONSTRAINTS "agrupador_conta_minimo_contas", "agrupador_conta_item_minimo_contas" IMMEDIATE`;

/** Inclui um agrupador com as contas (cad.plano_contas:executar). */
export async function incluirAgrupador(ctx: ContextoRequisicao, dados: EntradaAgrupador, deps: Deps = {}): Promise<Resultado<{ id: string }>> {
  exigir(ctx, 'cad.plano_contas', 'executar');
  const v = validarAgrupador(dados);
  if (!v.ok) return v;
  try {
    return await (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
      // SQL explícito: o sgo_app só insere o nome (o Prisma mandaria os defaults).
      const [criado] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "agrupador_conta" ("nome") VALUES (${v.valor.nome}) RETURNING "id"`;
      await incluirItens(tx, criado!.id, v.valor.contaIds);
      await conferirMinimo(tx);
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.plano_contas',
        tipo: 'INSERCAO',
        registroId: criado!.id,
        descricao: `Agrupador ${v.valor.nome} incluído`,
        depois: { agrupador: v.valor.nome, contas: await classificacoes(tx, v.valor.contaIds) },
      });
      return ok({ id: criado!.id });
    });
  } catch (e) {
    const f = traduzir(e, v.valor.nome);
    if (f) return f;
    throw e;
  }
}

/** Renomeia o agrupador e troca as contas, com a versão (cad.plano_contas:executar). */
export async function alterarAgrupador(
  ctx: ContextoRequisicao,
  id: string,
  versao: number,
  dados: EntradaAgrupador,
  deps: Deps = {},
): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.plano_contas', 'executar');
  if (!UUID.test(id) || !Number.isInteger(versao) || versao < 1) return falha([{ campo: '_', mensagem: 'Agrupador ou versão inválidos. Recarregue a tela.' }]);
  const v = validarAgrupador(dados);
  if (!v.ok) return v;
  try {
    return await (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
      const antes = await tx.agrupadorConta.findUnique({ where: { id }, select: { nome: true, versao: true, itens: { select: { contaId: true } } } });
      if (!antes) return falha([{ campo: '_', mensagem: 'Agrupador não encontrado. Recarregue a tela.' }]);
      if (antes.versao !== versao) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
      const tinha = new Set(antes.itens.map((i) => i.contaId));
      const quer = new Set(v.valor.contaIds);
      const sair = [...tinha].filter((c) => !quer.has(c));
      const entrar = [...quer].filter((c) => !tinha.has(c));
      if (antes.nome === v.valor.nome && sair.length === 0 && entrar.length === 0) return ok({ versao });
      // A versão sobe primeiro: trava o agrupador, e duas edições não trocam as contas ao mesmo tempo.
      const r = await tx.agrupadorConta.updateMany({ where: { id, versao }, data: { nome: v.valor.nome, versao: { increment: 1 }, atualizadoEm: new Date() } });
      if (r.count === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
      if (sair.length > 0) await tx.agrupadorContaItem.deleteMany({ where: { agrupadorId: id, contaId: { in: sair } } });
      await incluirItens(tx, id, entrar);
      await conferirMinimo(tx);
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.plano_contas',
        tipo: 'ALTERACAO',
        registroId: id,
        descricao: `Agrupador ${v.valor.nome} alterado`,
        antes: { agrupador: antes.nome, contas: await classificacoes(tx, [...tinha]) },
        depois: { agrupador: v.valor.nome, contas: await classificacoes(tx, v.valor.contaIds) },
      });
      return ok({ versao: versao + 1 });
    });
  } catch (e) {
    const f = traduzir(e, v.valor.nome);
    if (f) return f;
    throw e;
  }
}

/** Exclui o agrupador e as vinculações (cad.plano_contas:executar); recusada se houver referência (RN_PLA_010). */
export async function excluirAgrupador(ctx: ContextoRequisicao, id: string, versao: number, deps: Deps = {}): Promise<Resultado<{ excluido: true }>> {
  exigir(ctx, 'cad.plano_contas', 'executar');
  if (!UUID.test(id) || !Number.isInteger(versao) || versao < 1) return falha([{ campo: '_', mensagem: 'Agrupador ou versão inválidos. Recarregue a tela.' }]);
  try {
    return await (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
      const antes = await tx.agrupadorConta.findUnique({ where: { id }, select: { nome: true, versao: true, itens: { select: { contaId: true } } } });
      if (!antes) return falha([{ campo: '_', mensagem: 'Agrupador não encontrado. Recarregue a tela.' }]);
      const contas = await classificacoes(tx, antes.itens.map((i) => i.contaId));
      const r = await tx.agrupadorConta.deleteMany({ where: { id, versao } });
      if (r.count === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.plano_contas',
        tipo: 'EXCLUSAO',
        registroId: id,
        descricao: `Agrupador ${antes.nome} excluído`,
        antes: { agrupador: antes.nome, contas },
      });
      return ok({ excluido: true as const });
    });
  } catch (e) {
    // Documento orçamentário que referencie o agrupador (FK RESTRICT, quando existir) barra a exclusão.
    if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') || (e instanceof Error && /\b23503\b|violates foreign key/.test(e.message))) {
      return falha([{ campo: '_', mensagem: MSG_REFERENCIADO }]);
    }
    throw e;
  }
}
