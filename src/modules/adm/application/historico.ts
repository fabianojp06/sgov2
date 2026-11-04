import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { auditar, type TipoOperacao } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { carregarPermissoes } from './login';

// Consulta do Histórico de Operações (US-040, UC02.24; REQ00100 a REQ00103): só leitura, com filtro
// e paginação no banco. O Administrador vê tudo; os outros perfis veem só as funcionalidades do
// próprio perfil (RN0099), nunca os registros fora do catálogo (RN0100). Só os campos da listagem
// do UC02.24: sem antes/depois, que ainda não têm a máscara por perfil (D-P8-10). A consulta tem
// nível Avançado (§5) e grava um CONSULTA com os filtros.
export type DepsHistorico = { cliente: PrismaClient };

export type FiltroHistorico = { usuario?: string; funcionalidade?: string; tipo?: TipoOperacao; de: Date; ate: Date; pagina: number };
export type LinhaHistorico = { id: string; descricao: string; usuario: string; funcionalidade: string; ocorridoEm: Date; tipo: TipoOperacao };
export type PaginaHistorico = { linhas: LinhaHistorico[]; total: number; pagina: number; porPagina: number };

export const FUNCIONALIDADE_HISTORICO = 'adm.historico';
export const POR_PAGINA = 50;
const PERIODO_MAXIMO_MS = 366 * 24 * 60 * 60 * 1000;
// [PROVISÓRIO]
export const MENSAGEM_PERIODO = 'O período pode ter no máximo 366 dias, com a data inicial antes da final.';

const escaparLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function ehAdministrador(cliente: PrismaClient, usuarioId: string): Promise<boolean> {
  return (await cliente.usuarioPerfil.count({ where: { usuarioId, perfil: { codigo: 'ADMINISTRADOR', ativo: true } } })) > 0;
}

// O `where` da consulta e da exportação (US-040, Task 7).
export async function filtroDoHistorico(ctx: ContextoRequisicao, f: FiltroHistorico, cliente: PrismaClient): Promise<Prisma.HistoricoOperacaoWhereInput> {
  const alcance = (await ehAdministrador(cliente, ctx.usuarioId))
    ? {}
    : { funcionalidade: { in: [...new Set([...(await carregarPermissoes(cliente, ctx.usuarioId))].map((p) => p.split(':')[0]!))] } };
  return {
    AND: [
      alcance,
      { ocorridoEm: { gte: f.de, lte: f.ate } },
      ...(f.funcionalidade ? [{ funcionalidade: f.funcionalidade }] : []),
      ...(f.tipo ? [{ tipoOperacao: f.tipo }] : []),
      ...(f.usuario ? [{ usuarioRotulo: { contains: escaparLike(f.usuario), mode: 'insensitive' as const } }] : []),
    ],
  };
}

export function periodoValido(f: Pick<FiltroHistorico, 'de' | 'ate'>): boolean {
  return f.de.getTime() <= f.ate.getTime() && f.ate.getTime() - f.de.getTime() <= PERIODO_MAXIMO_MS;
}

export const descreverFiltros = (f: Omit<FiltroHistorico, 'pagina'>) =>
  [
    `período ${f.de.toISOString().slice(0, 10)} a ${f.ate.toISOString().slice(0, 10)}`,
    ...(f.usuario ? [`usuário "${f.usuario}"`] : []),
    ...(f.funcionalidade ? [`funcionalidade ${f.funcionalidade}`] : []),
    ...(f.tipo ? [`tipo ${f.tipo}`] : []),
  ].join(', ');

export async function consultarHistorico(ctx: ContextoRequisicao, f: FiltroHistorico, deps: Partial<DepsHistorico> = {}): Promise<Resultado<PaginaHistorico>> {
  exigir(ctx, FUNCIONALIDADE_HISTORICO, 'consultar');
  const cliente = deps.cliente ?? prisma;
  if (!periodoValido(f)) return falha([{ campo: 'de', mensagem: MENSAGEM_PERIODO }]);
  const pagina = Math.max(1, Math.trunc(f.pagina));
  const where = await filtroDoHistorico(ctx, f, cliente);
  return cliente.$transaction(async (tx) => {
    const [linhas, total] = await Promise.all([
      tx.historicoOperacao.findMany({
        where,
        orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
        select: { id: true, descricao: true, usuarioRotulo: true, funcionalidade: true, ocorridoEm: true, tipoOperacao: true },
      }),
      tx.historicoOperacao.count({ where }),
    ]);
    await auditar(tx, {
      contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
      funcionalidade: FUNCIONALIDADE_HISTORICO,
      tipo: 'CONSULTA',
      descricao: `Consultou o Histórico: ${descreverFiltros(f)}, página ${pagina}`,
    });
    return ok({
      linhas: linhas.map((l) => ({ id: l.id.toString(), descricao: l.descricao, usuario: l.usuarioRotulo, funcionalidade: l.funcionalidade, ocorridoEm: l.ocorridoEm, tipo: l.tipoOperacao })),
      total,
      pagina,
      porPagina: POR_PAGINA,
    });
  });
}
