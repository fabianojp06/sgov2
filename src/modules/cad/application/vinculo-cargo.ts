import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { ehAnalitica, ROTULO_TIPO, type TipoUnidade } from '../domain/estrutura-funcional';
import { MSG_CONCORRENCIA } from '../infrastructure/parametro-sistema';

// Vínculo 1:1 do cargo com uma unidade analítica ativa da estrutura funcional (US-048 parte 2;
// RN_CAR_08, RN_EST_01/02, C2). Campo manual do cargo: cad.cargos:alterar. Não exige ver salários (o
// vínculo não mexe neles). A concorrência é pelo vínculo anterior, e não pela versão do cargo: os
// outros formulários da página do cargo seguem a versão, e um vínculo salvo não pode dar a eles um
// falso aviso de concorrência. O trigger da migration também barra unidade sintética ou inativa (com
// FOR SHARE, contra a inativação ao mesmo tempo).

type Deps = { cliente?: PrismaClient };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

export type UnidadeParaVinculo = Readonly<{ id: string; rotulo: string }>;

/** Unidades analíticas ativas, em ordem de rótulo, para o seletor do vínculo do cargo. */
export async function listarUnidadesParaVinculo(ctx: ContextoRequisicao, deps: Deps = {}): Promise<readonly UnidadeParaVinculo[]> {
  exigir(ctx, 'cad.cargos', 'consultar');
  const unidades = await (deps.cliente ?? prisma).unidadeFuncional.findMany({
    where: { ativa: true, tipo: { in: ['ASSESSORIA', 'COORDENADORIA', 'SETOR'] } },
    select: { id: true, nome: true, superior: { select: { nome: true } } },
  });
  return unidades
    // O nome costuma trazer o tipo ("Setor de Compras"); a superior desfaz nomes iguais em gerências diferentes.
    .map((u) => ({ id: u.id, rotulo: `${u.nome}${u.superior ? ` (${u.superior.nome})` : ''}` }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/** Vincula o cargo à unidade (ou desvincula com null). `anterior` é o vínculo que a tela mostrava. */
export async function vincularCargo(
  ctx: ContextoRequisicao,
  cargoId: string,
  anterior: string | null,
  unidadeId: string | null,
  deps: Deps = {},
): Promise<Resultado<{ unidadeId: string | null }>> {
  exigir(ctx, 'cad.cargos', 'alterar');
  if (!UUID.test(cargoId) || (anterior !== null && !UUID.test(anterior))) return falha([{ campo: '_', mensagem: 'Cargo inválido. Recarregue a tela.' }]);
  if (unidadeId !== null && !UUID.test(unidadeId)) return falha([{ campo: 'unidadeId', mensagem: 'Escolha uma unidade da lista.' }]);
  const cliente = deps.cliente ?? prisma;
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      // FOR UPDATE: duas abas não passam as duas pela conferência do vínculo anterior.
      const [linha] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "cargo" WHERE "id" = ${cargoId}::uuid FOR UPDATE`;
      if (!linha) return falha([{ campo: '_', mensagem: 'Cargo não encontrado. Recarregue a tela.' }]);
      const cargo = (await tx.cargo.findUnique({
        where: { id: cargoId },
        select: { codigo: true, vinculoFuncional: { select: { id: true, nome: true } } },
      }))!;
      if ((cargo.vinculoFuncional?.id ?? null) !== anterior) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
      let destino: { nome: string; tipo: TipoUnidade } | null = null;
      if (unidadeId !== null) {
        const u = await tx.unidadeFuncional.findUnique({ where: { id: unidadeId }, select: { nome: true, tipo: true, ativa: true } });
        if (!u || !u.ativa || !ehAnalitica(u.tipo as TipoUnidade)) {
          return falha([{ campo: 'unidadeId', mensagem: 'O cargo só se vincula a uma Assessoria, Coordenadoria ou Setor ativo.' }]);
        }
        destino = { nome: u.nome, tipo: u.tipo as TipoUnidade };
      }
      if (anterior === unidadeId) return ok({ unidadeId });
      await tx.cargo.update({ where: { id: cargoId }, data: { vinculoFuncionalId: unidadeId } });
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.cargos',
        tipo: 'ALTERACAO',
        registroId: cargo.codigo,
        descricao: destino
          ? `Cargo ${cargo.codigo} vinculado a ${ROTULO_TIPO[destino.tipo]} "${destino.nome}"`
          : `Cargo ${cargo.codigo} desvinculado da estrutura funcional`,
        antes: { vinculoFuncional: cargo.vinculoFuncional ? { id: cargo.vinculoFuncional.id, nome: cargo.vinculoFuncional.nome } : null },
        depois: { vinculoFuncional: destino ? { id: unidadeId, nome: destino.nome } : null },
      });
      return ok({ unidadeId });
    });
  } catch (e) {
    // Corrida com a inativação da unidade: o trigger recusa.
    if (e instanceof Error && /Cargo só se vincula a unidade analítica ativa/.test(e.message)) {
      return falha([{ campo: 'unidadeId', mensagem: 'A unidade foi inativada. Recarregue a tela.' }]);
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      return falha([{ campo: 'unidadeId', mensagem: 'A unidade não existe. Recarregue a tela.' }]);
    }
    throw e;
  }
}
