import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ALCADA, ROTULO_FLUXO, validarAlcada, validarAprovadores, type FluxoAprovacao } from '../domain/alcada';

// Casos de uso das alçadas de aprovação (US-042, §11.4; exclusivo do Administrador). Cada um chama
// exigir primeiro e roda numa transação, com o Histórico. Trocar um aprovador inativa a linha e cria
// outra (D-P8-7), e excluir só inativa: fica preservado quem aprovava em cada período.
export type DepsAlcadas = { cliente: PrismaClient; agora: () => Date };

const FUNCIONALIDADE = 'adm.alcadas';

const resolver = (deps: Partial<DepsAlcadas>): DepsAlcadas => ({ cliente: deps.cliente ?? prisma, agora: deps.agora ?? (() => new Date()) });

// A alçada não é por TP: o Histórico sai sem unidade.
const contextoAuditoria = (ctx: ContextoRequisicao): ContextoAuditoria => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

export type LinhaAlcada = {
  id: string;
  fluxo: FluxoAprovacao;
  rotuloFluxo: string;
  titular: { id: string; nome: string; ativo: boolean };
  substituto: { id: string; nome: string; ativo: boolean };
  ativa: boolean;
  inativadaEm: Date | null;
  versao: number;
};

const idValido = (id: string) => z.uuid().safeParse(id).success;
const inexistente = () => new ErroDominio('adm.alcada_inexistente', MENSAGENS_ALCADA.INEXISTENTE);
const alterado = () => falha([{ campo: '_', mensagem: MENSAGENS_ALCADA.ALTERADO }]);
const duplicada = () => falha([{ campo: 'fluxo', mensagem: MENSAGENS_ALCADA.DUPLICADA }]);
const ehDuplicada = (erro: unknown) => erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
const retrato = (a: { fluxo: string; titularId: string; substitutoId: string }) => ({ fluxo: a.fluxo, titularId: a.titularId, substitutoId: a.substitutoId });

// Os dois aprovadores precisam existir e estar ativos (§11.4), conferidos sob a trava das linhas.
async function conferirAtivos(tx: TxCliente, a: { titularId: string; substitutoId: string }): Promise<Resultado<void>> {
  const ativos = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM usuario WHERE id IN (${a.titularId}::uuid, ${a.substitutoId}::uuid) AND ativo FOR SHARE`;
  const ids = new Set(ativos.map((u) => u.id));
  const erros = [
    ...(ids.has(a.titularId) ? [] : [{ campo: 'titularId', mensagem: MENSAGENS_ALCADA.DIFERENTES }]),
    ...(ids.has(a.substitutoId) ? [] : [{ campo: 'substitutoId', mensagem: MENSAGENS_ALCADA.DIFERENTES }]),
  ];
  return erros.length > 0 ? falha(erros) : ok(undefined);
}

async function criarLinha(tx: TxCliente, ctx: ContextoRequisicao, agora: Date, a: { fluxo: FluxoAprovacao; titularId: string; substitutoId: string }) {
  const criada = await tx.alcadaAprovacao.create({ data: { ...a, criadaEm: agora }, select: { id: true } });
  await auditar(tx, {
    contexto: contextoAuditoria(ctx),
    funcionalidade: FUNCIONALIDADE,
    tipo: 'INSERCAO',
    registroId: criada.id,
    descricao: `Cadastrou a alçada de ${ROTULO_FLUXO[a.fluxo]} (${a.fluxo})`,
    depois: retrato(a),
  });
  return criada.id;
}

async function inativarLinha(tx: TxCliente, id: string, versao: number, agora: Date): Promise<boolean> {
  const { count } = await tx.alcadaAprovacao.updateMany({ where: { id, versao, ativa: true }, data: { ativa: false, inativadaEm: agora, versao: { increment: 1 } } });
  return count === 1;
}

export async function cadastrarAlcada(ctx: ContextoRequisicao, entrada: unknown, deps: Partial<DepsAlcadas> = {}): Promise<Resultado<{ id: string }>> {
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const { cliente, agora } = resolver(deps);
  const v = validarAlcada(entrada);
  if (!v.ok) return v;
  try {
    return await cliente.$transaction(async (tx) => {
      const ativos = await conferirAtivos(tx, v.valor);
      if (!ativos.ok) return ativos;
      return ok({ id: await criarLinha(tx, ctx, agora(), v.valor) });
    });
  } catch (erro) {
    if (ehDuplicada(erro)) return duplicada();
    throw erro;
  }
}

// Trocar titular ou substituto: a linha atual é inativada e nasce outra para o mesmo fluxo.
export async function alterarAlcada(
  ctx: ContextoRequisicao,
  id: string,
  versao: number,
  entrada: unknown,
  deps: Partial<DepsAlcadas> = {},
): Promise<Resultado<{ id: string }>> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const { cliente, agora } = resolver(deps);
  if (!idValido(id)) throw inexistente();
  const v = validarAprovadores(entrada);
  if (!v.ok) return v;
  return cliente.$transaction(async (tx) => {
    const atual = await tx.alcadaAprovacao.findUnique({ where: { id } });
    if (!atual) throw inexistente();
    if (atual.versao !== versao) return alterado();
    if (!atual.ativa) return falha([{ campo: '_', mensagem: MENSAGENS_ALCADA.INATIVA }]);
    // Salvar sem mudança não grava nem audita.
    if (atual.titularId === v.valor.titularId && atual.substitutoId === v.valor.substitutoId) return ok({ id });
    const ativos = await conferirAtivos(tx, v.valor);
    if (!ativos.ok) return ativos;
    const instante = agora();
    if (!(await inativarLinha(tx, id, versao, instante))) return alterado();
    const fluxo = atual.fluxo as FluxoAprovacao;
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Trocou os aprovadores da alçada de ${ROTULO_FLUXO[fluxo]} (${fluxo})`,
      antes: retrato(atual),
      depois: retrato({ fluxo, ...v.valor }),
    });
    return ok({ id: await criarLinha(tx, ctx, instante, { fluxo, ...v.valor }) });
  });
}

// Excluir: soft delete (§11.4).
export async function inativarAlcada(ctx: ContextoRequisicao, id: string, versao: number, deps: Partial<DepsAlcadas> = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const { cliente, agora } = resolver(deps);
  if (!idValido(id)) throw inexistente();
  return cliente.$transaction(async (tx) => {
    const atual = await tx.alcadaAprovacao.findUnique({ where: { id } });
    if (!atual) throw inexistente();
    if (atual.versao !== versao) return alterado();
    if (!atual.ativa) return falha([{ campo: '_', mensagem: MENSAGENS_ALCADA.INATIVA }]);
    if (!(await inativarLinha(tx, id, versao, agora()))) return alterado();
    const fluxo = atual.fluxo as FluxoAprovacao;
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId: id,
      descricao: `Excluiu a alçada de ${ROTULO_FLUXO[fluxo]} (${fluxo})`,
      antes: retrato(atual),
    });
    return ok(undefined);
  });
}

export async function obterAlcada(ctx: ContextoRequisicao, id: string, deps: Partial<DepsAlcadas> = {}): Promise<LinhaAlcada | null> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!idValido(id)) return null;
  return (await listarAlcadas(ctx, deps, { id })).at(0) ?? null;
}

// Opções do formulário: só usuários ativos (§11.4), por nome.
export async function listarAprovadoresPossiveis(ctx: ContextoRequisicao, deps: Partial<DepsAlcadas> = {}): Promise<{ id: string; nome: string }[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  return resolver(deps).cliente.usuario.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } });
}

// Ativas primeiro, por fluxo; depois as inativas, da mais recente para a mais antiga.
export async function listarAlcadas(ctx: ContextoRequisicao, deps: Partial<DepsAlcadas> = {}, filtro: { id?: string } = {}): Promise<LinhaAlcada[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const { cliente } = resolver(deps);
  const usuario = { select: { id: true, nome: true, ativo: true } } as const;
  const linhas = await cliente.alcadaAprovacao.findMany({
    where: filtro.id ? { id: filtro.id } : {},
    include: { titular: usuario, substituto: usuario },
    orderBy: [{ ativa: 'desc' }, { fluxo: 'asc' }, { criadaEm: 'desc' }],
  });
  return linhas.map((l) => ({
    id: l.id,
    fluxo: l.fluxo as FluxoAprovacao,
    rotuloFluxo: ROTULO_FLUXO[l.fluxo as FluxoAprovacao],
    titular: l.titular,
    substituto: l.substituto,
    ativa: l.ativa,
    inativadaEm: l.inativadaEm,
    versao: l.versao,
  }));
}
