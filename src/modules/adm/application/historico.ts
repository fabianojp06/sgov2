import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { auditar, type TipoOperacao } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { exportarXlsx } from '@/modules/ger/servidor';
import { LIMITE_EXPORTACAO_SINCRONA } from '@/modules/ger';
import { prisma } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { carregarPermissoes } from './login';

// Consulta do Histórico de Operações (US-040, UC02.24; REQ00100 a REQ00103): só leitura, com filtro
// e paginação no banco. O Administrador vê tudo; os outros perfis veem só as funcionalidades do
// próprio perfil (RN0099), nunca os registros fora do catálogo (RN0100). O `ate` é um instante: quem
// monta o filtro pela tela leva-o até o fim do dia (Task 7). A unidade (TP) não recorta: hoje só o
// Administrador e o Auditor, perfis globais, têm adm.historico; o recorte por TP fica para a US-007
// nas tabelas de TP (pendência registrada). Só os campos da listagem
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
export const MENSAGEM_USUARIO_FILTRO = 'O filtro de usuário pode ter no máximo 120 caracteres.';
const MAXIMO_USUARIO = 120;

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
  if (Number.isNaN(f.de.getTime()) || Number.isNaN(f.ate.getTime())) return false;
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
  if ((f.usuario?.length ?? 0) > MAXIMO_USUARIO) return falha([{ campo: 'usuario', mensagem: MENSAGEM_USUARIO_FILTRO }]);
  // Página fora do número (NaN, Infinity) vira a primeira, sem chegar ao banco.
  const pagina = Number.isFinite(f.pagina) ? Math.min(Math.max(1, Math.trunc(f.pagina)), 1_000_000) : 1;
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

// [PROVISÓRIO] (D-P8-11): a exportação assíncrona e o PDF são da US-024.
export const MENSAGEM_EXPORTACAO_LIMITE = 'A exportação passa de 5.000 linhas. Reduza o período ou os filtros.';
const HORA_BRASILIA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const contexto = (ctx: ContextoRequisicao) => ({ usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null });

// Exportar (UC0.05; RN_LOG_EXP): XLSX até o limite síncrono, com os filtros na primeira linha (RN0011),
// e um EXPORTACAO no Histórico com a quantidade e os filtros.
export async function exportarHistorico(
  ctx: ContextoRequisicao,
  f: Omit<FiltroHistorico, 'pagina'>,
  deps: Partial<DepsHistorico> = {},
): Promise<Resultado<{ bytes: Uint8Array; nome: string }>> {
  exigir(ctx, FUNCIONALIDADE_HISTORICO, 'exportar');
  const cliente = deps.cliente ?? prisma;
  if (!periodoValido(f)) return falha([{ campo: 'de', mensagem: MENSAGEM_PERIODO }]);
  if ((f.usuario?.length ?? 0) > MAXIMO_USUARIO) return falha([{ campo: 'usuario', mensagem: MENSAGEM_USUARIO_FILTRO }]);
  const where = await filtroDoHistorico(ctx, { ...f, pagina: 1 }, cliente);
  return cliente.$transaction(async (tx) => {
    const total = await tx.historicoOperacao.count({ where });
    if (total > LIMITE_EXPORTACAO_SINCRONA) return falha([{ campo: '_', mensagem: MENSAGEM_EXPORTACAO_LIMITE }]);
    const linhas = await tx.historicoOperacao.findMany({
      where,
      orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
      select: { descricao: true, usuarioRotulo: true, funcionalidade: true, ocorridoEm: true, tipoOperacao: true },
    });
    const filtros = descreverFiltros(f);
    const arquivo = await exportarXlsx([
      {
        nome: 'Histórico de Operações',
        colunas: [
          { titulo: 'Data da Operação', tipo: 'texto', largura: 18 },
          { titulo: 'Usuário', tipo: 'texto', largura: 24 },
          { titulo: 'Funcionalidade', tipo: 'texto', largura: 24 },
          { titulo: 'Tipo de Operação', tipo: 'texto', largura: 16 },
          { titulo: 'Descrição', tipo: 'texto', largura: 80 },
        ],
        linhas: [
          [`Filtros: ${filtros}`, null, null, null, null],
          ...linhas.map((l) => [HORA_BRASILIA.format(l.ocorridoEm), l.usuarioRotulo, l.funcionalidade, l.tipoOperacao, l.descricao]),
        ],
      },
    ]);
    if (!arquivo.ok) return arquivo;
    await auditar(tx, {
      contexto: contexto(ctx),
      funcionalidade: FUNCIONALIDADE_HISTORICO,
      tipo: 'EXPORTACAO',
      descricao: `Exportou ${linhas.length} registro(s) do Histórico: ${filtros}`,
    });
    return ok({ bytes: arquivo.valor, nome: `historico-${f.de.toISOString().slice(0, 10)}-a-${f.ate.toISOString().slice(0, 10)}.xlsx` });
  });
}

// Imprimir (UC0.05): a impressão é a do navegador; o servidor só registra o IMPRESSAO com os filtros.
export async function registrarImpressao(ctx: ContextoRequisicao, f: Omit<FiltroHistorico, 'pagina'>, deps: Partial<DepsHistorico> = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE_HISTORICO, 'imprimir');
  if (!periodoValido(f)) return falha([{ campo: 'de', mensagem: MENSAGEM_PERIODO }]);
  await (deps.cliente ?? prisma).$transaction((tx) =>
    auditar(tx, { contexto: contexto(ctx), funcionalidade: FUNCIONALIDADE_HISTORICO, tipo: 'IMPRESSAO', descricao: `Imprimiu o Histórico: ${descreverFiltros(f)}` }),
  );
  return ok(undefined);
}
