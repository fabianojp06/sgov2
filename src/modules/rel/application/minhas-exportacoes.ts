import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { ehFormatoArquivo, type FormatoArquivo } from '@/modules/ger';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';

// Minhas exportações (US-024, RF_IMP_003): os pedidos de exportação em segundo plano da própria pessoa,
// dos últimos 7 dias [PROVISÓRIO, decisão da frente B em 10/11], e o download do arquivo pronto.
// Baixar exige, além de ser o dono, o exportar da listagem de origem ainda valer: permissão retirada
// depois do pedido corta o download. O Histórico já registrou a exportação quando o worker gerou o
// arquivo, com o mesmo rastreio.
export const DIAS_DISPONIVEL = 7;
const FUNCIONALIDADE = 'rel.exportacoes';
type Deps = { cliente?: PrismaClient; agora?: Date };

export type SituacaoPedido = 'PENDENTE' | 'PRONTA' | 'FALHOU';
export type PedidoTela = {
  id: string;
  titulo: string;
  formato: string;
  situacao: SituacaoPedido;
  registros: number | null;
  erro: string | null;
  criadoEm: string;
  concluidoEm: string | null;
};
export type ArquivoPedido = { nome: string; formato: FormatoArquivo; bytes: Uint8Array };

const desde = (agora: Date) => new Date(agora.getTime() - DIAS_DISPONIVEL * 24 * 60 * 60 * 1000);

export async function listarMinhasExportacoes(ctx: ContextoRequisicao, deps: Deps = {}): Promise<PedidoTela[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const pedidos = await (deps.cliente ?? prisma).exportacaoPedido.findMany({
    where: { usuarioId: ctx.usuarioId, criadoEm: { gte: desde(deps.agora ?? new Date()) } },
    select: { id: true, titulo: true, formato: true, situacao: true, registros: true, erro: true, criadoEm: true, concluidoEm: true },
    orderBy: { criadoEm: 'desc' },
    take: 100,
  });
  return pedidos.map((p) => ({ ...p, criadoEm: p.criadoEm.toISOString(), concluidoEm: p.concluidoEm?.toISOString() ?? null }));
}

/** O arquivo pronto, ou null quando não existe para esta pessoa (alheio, vencido, pendente ou com falha). */
export async function baixarExportacao(ctx: ContextoRequisicao, id: string, deps: Deps = {}): Promise<ArquivoPedido | null> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const p = await (deps.cliente ?? prisma).exportacaoPedido.findFirst({
    where: { id, usuarioId: ctx.usuarioId, situacao: 'PRONTA', criadoEm: { gte: desde(deps.agora ?? new Date()) } },
    select: { funcionalidade: true, formato: true, nomeArquivo: true, conteudo: true },
  });
  if (!p || !p.conteudo || !p.nomeArquivo || !ehFormatoArquivo(p.formato)) return null;
  exigir(ctx, p.funcionalidade, 'exportar');
  return { nome: p.nomeArquivo, formato: p.formato, bytes: new Uint8Array(p.conteudo) };
}
