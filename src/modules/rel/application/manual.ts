import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { listarCatalogoDoMenu } from '@/modules/adm';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { montarManual, roteiroTreinamento, type ModuloManual, type PassoTreinamento } from '../domain/manual';

// Manual do usuário e roteiro de treinamento (US-118): do catálogo ativo do menu e das permissões da
// pessoa. Quem entra no sistema lê o próprio manual (a mesma permissão da tela principal).

type Deps = { cliente?: PrismaClient };
export type TelaManual = Readonly<{ manual: readonly ModuloManual[]; roteiro: readonly PassoTreinamento[] }>;

export async function obterManual(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaManual> {
  exigir(ctx, 'aut.tela_principal', 'consultar');
  const manual = await manualDoPerfil(ctx, deps.cliente ?? prisma);
  return { manual, roteiro: roteiroTreinamento(manual) };
}

/** O manual das permissões da pessoa, sem conferir permissão: quem chama confere (a tela ou a ajuda da IA). */
export async function manualDoPerfil(ctx: ContextoRequisicao, cliente: PrismaClient): Promise<readonly ModuloManual[]> {
  const catalogo = await cliente.$transaction((tx: TxCliente) => listarCatalogoDoMenu(tx));
  return montarManual(catalogo, ctx.permissoes);
}
