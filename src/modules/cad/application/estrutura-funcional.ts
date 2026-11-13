import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import {
  montarArvoreFuncional,
  ROTULO_TIPO,
  validarNomeUnidade,
  validarNovaUnidade,
  type NoUnidade,
  type TipoUnidade,
} from '../domain/estrutura-funcional';
import { MSG_CONCORRENCIA } from '../infrastructure/parametro-sistema';

// Estrutura funcional (US-048; UC03.18, RN_EST_02 e RN_EST_04). Consultar, incluir e alterar com
// cad.estrutura_funcional; a inativação é uma alteração. A hierarquia e a inativação com carga viva
// também são barradas no banco (trigger da migration); aqui elas viram mensagem por campo.

type Deps = { cliente?: PrismaClient };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

/** Violação de índice único (nome repetido entre as ativas do mesmo superior): P2002 ou 23505 no texto. */
const ehNomeRepetido = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || (e instanceof Error && /\b23505\b|unidade_funcional_nome_ativa_key/.test(e.message));
const MSG_NOME_REPETIDO = 'Já existe uma unidade ativa com esse nome sob a mesma unidade superior.';

// Regras do trigger (check_violation) que a conferência do caso de uso não pegou, por corrida entre
// dois usuários: viram mensagem, sem nada gravado.
const REGRAS_DO_BANCO: readonly [RegExp, string][] = [
  [/Unidade com cargos ativos vinculados/, 'A unidade passou a ter cargo ativo vinculado. Recarregue a tela.'],
  [/Unidade com unidades ativas abaixo/, 'A unidade passou a ter unidade ativa abaixo. Recarregue a tela.'],
  [/A unidade superior está inativa/, 'A unidade superior foi inativada. Recarregue a tela.'],
  [/A unidade superior não existe/, 'A unidade superior não existe. Recarregue a tela.'],
  [/Vínculo hierárquico inválido/, 'Vínculo hierárquico inválido. Recarregue a tela.'],
];
// O texto do RAISE identifica a regra (o adapter nem sempre traz o código 23514).
function regraDoBanco(e: unknown): string | null {
  const texto = e instanceof Error ? e.message : '';
  return REGRAS_DO_BANCO.find(([re]) => re.test(texto))?.[1] ?? null;
}

export type CargoOcupante = Readonly<{ id: string; codigo: string; nome: string }>;
export type TelaEstruturaFuncional = Readonly<{
  arvore: readonly NoUnidade[];
  /** Painel de ocupação (REQ_EST_003): cargos ativos de cada unidade analítica, por id da unidade. */
  ocupacao: Readonly<Record<string, readonly CargoOcupante[]>>;
}>;

export async function obterTelaEstruturaFuncional(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaEstruturaFuncional> {
  exigir(ctx, 'cad.estrutura_funcional', 'consultar');
  const cliente = deps.cliente ?? prisma;
  const [unidades, cargos] = await Promise.all([
    cliente.unidadeFuncional.findMany({ select: { id: true, nome: true, tipo: true, superiorId: true, ativa: true, versao: true } }),
    cliente.cargo.findMany({
      where: { ativo: true, vinculoFuncionalId: { not: null } },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nomeOficial: true, nomeMercado: true, vinculoFuncionalId: true },
    }),
  ]);
  const ocupacao: Record<string, CargoOcupante[]> = {};
  for (const c of cargos) {
    (ocupacao[c.vinculoFuncionalId!] ??= []).push({ id: c.id, codigo: c.codigo, nome: c.nomeMercado?.trim() || c.nomeOficial });
  }
  return { arvore: montarArvoreFuncional(unidades), ocupacao };
}

/** Inclui uma unidade (cad.estrutura_funcional:incluir). Devolve o id. */
export async function incluirUnidade(
  ctx: ContextoRequisicao,
  dados: { nome: string; tipo: string; superiorId: string | null },
  deps: Deps = {},
): Promise<Resultado<{ id: string }>> {
  exigir(ctx, 'cad.estrutura_funcional', 'incluir');
  if (dados.superiorId !== null && !UUID.test(dados.superiorId)) return falha([{ campo: 'superiorId', mensagem: 'Escolha a unidade superior.' }]);
  const cliente = deps.cliente ?? prisma;
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      const superior =
        dados.superiorId === null
          ? null
          : await tx.unidadeFuncional.findUnique({ where: { id: dados.superiorId }, select: { tipo: true, ativa: true, nome: true } });
      if (dados.superiorId !== null && !superior) return falha([{ campo: 'superiorId', mensagem: 'A unidade superior não existe. Recarregue a tela.' }]);
      const v = validarNovaUnidade({ nome: dados.nome, tipo: dados.tipo, superior: superior ? { tipo: superior.tipo as TipoUnidade, ativa: superior.ativa } : null });
      if (!v.ok) return v;
      // SQL explícito: o sgo_app só insere nome, tipo e superior (o Prisma mandaria os defaults).
      const [criada] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "unidade_funcional" ("nome", "tipo", "superior_id")
        VALUES (${v.valor.nome}, ${v.valor.tipo}::"TipoUnidadeFuncional", ${dados.superiorId}::uuid) RETURNING "id"`;
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.estrutura_funcional',
        tipo: 'INSERCAO',
        registroId: criada!.id,
        descricao: `${ROTULO_TIPO[v.valor.tipo]} "${v.valor.nome}" incluída${superior ? ` sob "${superior.nome}"` : ''}`,
        depois: { nome: v.valor.nome, tipo: v.valor.tipo, superiorId: dados.superiorId },
      });
      return ok({ id: criada!.id });
    });
  } catch (e) {
    if (ehNomeRepetido(e)) return falha([{ campo: 'nome', mensagem: MSG_NOME_REPETIDO }]);
    const regra = regraDoBanco(e);
    if (regra) return falha([{ campo: '_', mensagem: regra }]);
    throw e;
  }
}

/** Renomeia a unidade (cad.estrutura_funcional:alterar), com a versão contra escrita concorrente. */
export async function renomearUnidade(ctx: ContextoRequisicao, id: string, versao: number, nome: string, deps: Deps = {}): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.estrutura_funcional', 'alterar');
  if (!UUID.test(id) || !Number.isInteger(versao) || versao < 1) return falha([{ campo: '_', mensagem: 'Unidade ou versão inválidas. Recarregue a tela.' }]);
  const v = validarNomeUnidade(nome);
  if (!v.ok) return v;
  const cliente = deps.cliente ?? prisma;
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      const antes = await tx.unidadeFuncional.findUnique({ where: { id }, select: { nome: true } });
      if (!antes) return falha([{ campo: '_', mensagem: 'Unidade não encontrada. Recarregue a tela.' }]);
      if (antes.nome === v.valor) return ok({ versao });
      const r = await tx.unidadeFuncional.updateMany({ where: { id, versao }, data: { nome: v.valor, versao: { increment: 1 } } });
      if (r.count === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.estrutura_funcional',
        tipo: 'ALTERACAO',
        registroId: id,
        descricao: `Unidade "${antes.nome}" renomeada para "${v.valor}"`,
        antes: { nome: antes.nome },
        depois: { nome: v.valor },
      });
      return ok({ versao: versao + 1 });
    });
  } catch (e) {
    if (ehNomeRepetido(e)) return falha([{ campo: 'nome', mensagem: MSG_NOME_REPETIDO }]);
    const regra = regraDoBanco(e);
    if (regra) return falha([{ campo: '_', mensagem: regra }]);
    throw e;
  }
}

/**
 * Inativa ou reativa a unidade (cad.estrutura_funcional:alterar). RN_EST_04 (E3): não inativa com
 * cargo ativo vinculado nem com unidade ativa abaixo; não reativa com a superior inativa.
 */
export async function definirSituacaoUnidade(
  ctx: ContextoRequisicao,
  id: string,
  versao: number,
  ativa: boolean,
  deps: Deps = {},
): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.estrutura_funcional', 'alterar');
  if (!UUID.test(id) || !Number.isInteger(versao) || versao < 1) return falha([{ campo: '_', mensagem: 'Unidade ou versão inválidas. Recarregue a tela.' }]);
  const cliente = deps.cliente ?? prisma;
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      const u = await tx.unidadeFuncional.findUnique({
        where: { id },
        select: { nome: true, tipo: true, ativa: true, superior: { select: { ativa: true, nome: true } } },
      });
      if (!u) return falha([{ campo: '_', mensagem: 'Unidade não encontrada. Recarregue a tela.' }]);
      if (u.ativa === ativa) return ok({ versao });
      if (!ativa) {
        const cargos = await tx.cargo.count({ where: { vinculoFuncionalId: id, ativo: true } });
        if (cargos > 0) return falha([{ campo: '_', mensagem: `A unidade "${u.nome}" tem ${cargos} cargo(s) ativo(s) vinculado(s). Vincule-os a outra unidade antes de inativar.` }]);
        const abaixo = await tx.unidadeFuncional.count({ where: { superiorId: id, ativa: true } });
        if (abaixo > 0) return falha([{ campo: '_', mensagem: `A unidade "${u.nome}" tem ${abaixo} unidade(s) ativa(s) abaixo. Inative-as antes.` }]);
      } else if (u.superior && !u.superior.ativa) {
        return falha([{ campo: '_', mensagem: `A unidade superior "${u.superior.nome}" está inativa. Reative-a antes.` }]);
      }
      const r = await tx.unidadeFuncional.updateMany({ where: { id, versao }, data: { ativa, versao: { increment: 1 } } });
      if (r.count === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.estrutura_funcional',
        tipo: 'ALTERACAO',
        registroId: id,
        descricao: `${ROTULO_TIPO[u.tipo as TipoUnidade]} "${u.nome}" ${ativa ? 'reativada' : 'inativada'}`,
        antes: { ativa: u.ativa },
        depois: { ativa },
      });
      return ok({ versao: versao + 1 });
    });
  } catch (e) {
    // Reativação com o nome já usado por outra ativa do mesmo superior.
    if (ehNomeRepetido(e)) return falha([{ campo: '_', mensagem: MSG_NOME_REPETIDO }]);
    const regra = regraDoBanco(e);
    if (regra) return falha([{ campo: '_', mensagem: regra }]);
    throw e;
  }
}
